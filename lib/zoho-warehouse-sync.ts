// Warehouse sync — pulls Zoho's warehouse list and per-item-per-warehouse
// stock into supabase. See lib/integrations/zoho-warehouses.ts for the
// fetcher layer.
//
// Two production behaviors that took a re-hit-the-wall to get right:
//   - Backfill is resumable. It queries the DB for the set of item_ids
//     already saved, subtracts them from the Zoho catalog, and only
//     detail-fetches what's left. Kill it, restart it — no wasted work.
//   - Supabase upserts retry on transient network errors ("fetch failed").
//     A 30-minute run at DETAIL_CONCURRENCY=5 is virtually guaranteed to
//     see at least one transient blip; without retries, a single hiccup
//     nukes an hour of progress.

import { getAccessToken } from "@/lib/integrations/zoho";
import {
  fetchZohoWarehouses,
  fetchZohoItemDetail,
  fetchZohoItemChangesSince,
  type ZohoItemDetail,
} from "@/lib/integrations/zoho-warehouses";
import {
  ZohoWarehousesRepository,
  ZohoItemWarehouseStockRepository,
} from "@/lib/repositories/zoho-warehouses.repository";
import { supabase } from "@/lib/supabase";

const DETAIL_CONCURRENCY = 5;
const SAVE_BATCH = 100;

// Number of times to retry a supabase upsert on a transient error.
// "fetch failed" is a network-layer error (DNS, TCP RST, edge blip), not a
// data error — retrying almost always succeeds. Data errors (constraint
// violations, missing columns) are NOT retried; those are surfaced.
const SAVE_MAX_RETRIES = 5;

export async function syncZohoWarehouses(): Promise<{ fetched: number; saved: number }> {
  const warehouses = await fetchZohoWarehouses();
  const saved = await withRetry(() => ZohoWarehousesRepository.upsertMany(warehouses));
  return { fetched: warehouses.length, saved };
}

/* ── delta sync: safe to run from an HTTP route ────────────────────────── */

export async function syncItemWarehouseStockDelta(): Promise<{
  changedCount: number;
  savedRows: number;
  cursor: string | null;
  newCursor: string | null;
}> {
  const cursor = await ZohoItemWarehouseStockRepository.getMaxLastModifiedTime();
  const token = await getAccessToken();
  const changes = await fetchZohoItemChangesSince(cursor, token);

  if (changes.length === 0) {
    return { changedCount: 0, savedRows: 0, cursor, newCursor: cursor };
  }

  const details = await fetchDetailsConcurrent(
    changes.map((c) => c.item_id),
    token,
    DETAIL_CONCURRENCY,
  );

  const savedRows = await withRetry(() => ZohoItemWarehouseStockRepository.saveMany(details));
  const newCursor = details
    .map((d) => d.last_modified_time)
    .filter(Boolean)
    .sort()
    .at(-1) ?? cursor;

  return { changedCount: changes.length, savedRows, cursor, newCursor };
}

/* ── full backfill: RESUMABLE, streams progress ────────────────────────── */

export async function fullBackfillItemWarehouseStock(opts: {
  onProgress?: (info: { done: number; total: number; savedRows: number; lastSku: string; alreadyDone: number }) => void;
  force?: boolean;      // if true, re-fetch even already-saved items
}): Promise<{ totalItems: number; totalRows: number; skipped: number }> {
  const token = await getAccessToken();
  const allChanges = await fetchZohoItemChangesSince(null, token);

  // Resume-from-crash: pull the set of item_ids already in the DB and skip
  // them, unless force=true. This is what makes the script safe to kill
  // and re-run — previously ~8K items got re-fetched on restart, burning
  // API quota and ~25 min for nothing.
  const alreadyDoneIds = opts.force ? new Set<string>() : await loadAlreadySavedItemIds();
  const todo = allChanges.filter((c) => !alreadyDoneIds.has(c.item_id));
  const total = todo.length;
  const alreadyDone = alreadyDoneIds.size;

  if (total === 0) {
    return { totalItems: 0, totalRows: 0, skipped: alreadyDone };
  }

  let done = 0;
  let totalRows = 0;
  const buffer: ZohoItemDetail[] = [];

  const queue = [...todo];
  async function worker() {
    for (;;) {
      const next = queue.shift();
      if (!next) return;

      let detail: ZohoItemDetail;
      try {
        detail = await withRetry(() => fetchZohoItemDetail(next.item_id, token));
      } catch (e) {
        console.error(`  ! item ${next.item_id} (sku=${next.sku}) permanently failed after retries: ${(e as Error).message}`);
        continue; // skip this one, keep going — resume will retry it next run
      }
      buffer.push(detail);
      done += 1;

      if (buffer.length >= SAVE_BATCH) {
        const toFlush = buffer.splice(0, buffer.length);
        try {
          totalRows += await withRetry(() => ZohoItemWarehouseStockRepository.saveMany(toFlush));
        } catch (e) {
          console.error(`  ! save batch permanently failed after retries — ${toFlush.length} items will retry next run: ${(e as Error).message}`);
        }
        opts.onProgress?.({ done, total, savedRows: totalRows, lastSku: detail.sku ?? "", alreadyDone });
      }
    }
  }

  await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, () => worker()));

  if (buffer.length > 0) {
    try {
      totalRows += await withRetry(() => ZohoItemWarehouseStockRepository.saveMany(buffer));
    } catch (e) {
      console.error(`  ! final save batch failed after retries: ${(e as Error).message}`);
    }
    opts.onProgress?.({ done, total, savedRows: totalRows, lastSku: buffer.at(-1)?.sku ?? "", alreadyDone });
  }

  return { totalItems: total, totalRows, skipped: alreadyDone };
}

/* ── helpers ───────────────────────────────────────────────────────────── */

// Paginated fetch of every item_id currently in zoho_item_warehouse_stock.
// Used only by the resume logic. Supabase caps a single select at 1000
// rows so paginate — 77K rows means ~77 round-trips, ~5 seconds total,
// negligible against the 30-min backfill.
async function loadAlreadySavedItemIds(): Promise<Set<string>> {
  const PAGE = 1000;
  const ids = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("zoho_item_warehouse_stock")
      .select("item_id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`resume-set query failed: ${error.message}`);
    for (const row of data ?? []) ids.add(row.item_id as string);
    if (!data || data.length < PAGE) break;
  }
  return ids;
}

// Retry wrapper for any operation whose failure mode is "transient network
// error." Distinguishes by inspecting the error string — supabase-js and
// undici surface these as bare `Error: fetch failed` or ECONNRESET/ETIMEDOUT.
// Data-shape errors ("column not found", "duplicate key", etc.) fall through
// unretried, since retrying those just repeats the same failure faster.
async function withRetry<T>(op: () => Promise<T>): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= SAVE_MAX_RETRIES; attempt++) {
    try {
      return await op();
    } catch (e) {
      lastError = e as Error;
      const msg = lastError.message || "";
      const isTransient =
        msg.includes("fetch failed") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("ENOTFOUND") ||
        msg.includes("EAI_AGAIN") ||
        msg.includes("socket hang up") ||
        msg.includes("network");
      if (!isTransient) throw e; // data-shape error → surface immediately

      const backoffMs = Math.min(2 ** attempt, 30) * 1000;
      console.warn(`  · transient error on attempt ${attempt}/${SAVE_MAX_RETRIES}, retrying in ${backoffMs / 1000}s: ${msg.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastError ?? new Error("retry loop exhausted with no error captured");
}

async function fetchDetailsConcurrent(
  itemIds: string[],
  token: string,
  concurrency: number,
): Promise<ZohoItemDetail[]> {
  const results: ZohoItemDetail[] = [];
  const queue = [...itemIds];
  async function worker() {
    for (;;) {
      const id = queue.shift();
      if (!id) return;
      try {
        results.push(await withRetry(() => fetchZohoItemDetail(id, token)));
      } catch (e) {
        console.error(`  ! item ${id} failed: ${(e as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}