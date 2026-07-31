// lib/sync-diff.ts
import { supabase } from "@/lib/supabase";
import { logStockEvent, type StockEventSource } from "@/lib/stock-events";

type Snapshot = { sku: string; quantity: number | null; product_status?: string | null };

/**
 * Called at the END of a sync from any source. Reads what we had before,
 * compares to what we just wrote, emits stock_events rows for every delta.
 * This is what makes the live ticker feel live without webhooks — the
 * ticker doesn't know or care whether events came from a webhook or a
 * scheduled poll. Same table, same UI.
 */
export async function emitDiffEvents(opts: {
  source: StockEventSource;              // 'zoho' | 'shopify_uae' | ...
  before: Map<string, Snapshot>;          // sku -> prev snapshot
  after: Map<string, Snapshot>;           // sku -> new snapshot
  syncRunId: string;
}) {
  const now = new Date();
  const events: Promise<void>[] = [];

  for (const [sku, next] of after) {
    const prev = opts.before.get(sku);
    const prevQty = prev?.quantity ?? null;
    const nextQty = next.quantity ?? null;

    // First-time seen — snapshot the initial value.
    if (!prev) {
      events.push(logStockEvent({
        sku, source: opts.source, event_type: "snapshot",
        new_qty: nextQty, correlation: opts.syncRunId,
        occurred_at: now, raw: { reason: "first_seen" },
      }));
      continue;
    }

    // Quantity moved.
    if (prevQty !== nextQty) {
      events.push(logStockEvent({
        sku, source: opts.source, event_type: "snapshot",
        delta: (nextQty ?? 0) - (prevQty ?? 0),
        new_qty: nextQty, correlation: opts.syncRunId,
        occurred_at: now,
        raw: { prev_qty: prevQty, next_qty: nextQty, detected_via: "poll_diff" },
      }));
    }

    // Product status flipped — active↔draft, published↔delisted.
    if (prev.product_status && next.product_status
        && prev.product_status !== next.product_status) {
      events.push(logStockEvent({
        sku, source: opts.source, event_type: "snapshot",
        correlation: opts.syncRunId, occurred_at: now,
        raw: { status_change: `${prev.product_status}→${next.product_status}` },
      }));
    }
  }

  // Delisted — was in the last snapshot, gone from this one.
  for (const [sku, prev] of opts.before) {
    if (!opts.after.has(sku)) {
      events.push(logStockEvent({
        sku, source: opts.source, event_type: "webhook_reject",
        correlation: opts.syncRunId, occurred_at: now,
        raw: { reason: "delisted", last_qty: prev.quantity },
      }));
    }
  }

  // Fire-and-forget in parallel. logStockEvent doesn't throw.
  await Promise.all(events);
}