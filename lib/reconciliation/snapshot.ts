// Reconciliation snapshot: read the last computed bank → payout → orders
// result instead of recomputing the whole book on every request.
//
// A full runReconciliation() loads every order, re-stamps settlements and
// checks Stripe evidence — tens of seconds. Pages poll /api/reconcile every
// minute from five views, so recomputing per read made the whole app crawl.
//
// Rules:
//   - Every runReconciliation() saves its result here (memory + recon_snapshots).
//   - A write that changes the inputs (upload, confirm, flag, ref link, delete
//     payout) calls markReconDirty(): the next read WAITS for a fresh run, so a
//     person always sees the effect of what they just did.
//   - Otherwise a read older than STALE_MS is served instantly and refreshed in
//     the background (orders sync every 2 minutes; waiting on that is pointless).
//   - One refresh at a time (single flight); concurrent readers share it.
//
// This module must not import engine.ts statically — engine imports it.

import { supabase } from "@/lib/supabase";
import type { ReconLine, UnmatchedPayoutRow } from "@/lib/reconciliation/engine";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";
const STALE_MS = Number(process.env.RECON_SNAPSHOT_STALE_MS ?? 120_000);

export type ReconExtras = { unmatchedPayouts: UnmatchedPayoutRow[]; payoutGateways: string[] };
export type ReconSnapshot = { lines: ReconLine[]; extras: ReconExtras; computedAt: string; durationMs: number | null };

let memory: ReconSnapshot | null = null;
let dirty = false;
let inFlight: Promise<ReconSnapshot> | null = null;

/** Called by runReconciliation() after every successful run. */
export async function saveReconSnapshot(lines: ReconLine[], durationMs: number, extras: ReconExtras): Promise<void> {
  const snap: ReconSnapshot = { lines, extras, computedAt: new Date().toISOString(), durationMs };
  memory = snap;
  dirty = false;
  const { error } = await supabase.from("recon_snapshots").upsert({
    id: TENANT, payload: { lines, extras }, computed_at: snap.computedAt, duration_ms: durationMs, dirty: false, dirty_at: null,
  });
  if (error) console.error("[recon-snapshot] save failed:", error.message);
}

/** Inputs changed: the next read recomputes before answering. */
export async function markReconDirty(reason: string): Promise<void> {
  dirty = true;
  const { error } = await supabase.from("recon_snapshots").update({ dirty: true, dirty_at: new Date().toISOString() }).eq("id", TENANT);
  if (error) console.error("[recon-snapshot] mark dirty failed:", error.message, reason);
}

async function loadPersisted(): Promise<{ snap: ReconSnapshot; dirty: boolean } | null> {
  const { data, error } = await supabase.from("recon_snapshots").select("payload, computed_at, duration_ms, dirty").eq("id", TENANT).maybeSingle();
  if (error || !data) return null;
  const payload = data.payload as { lines?: ReconLine[]; extras?: ReconExtras };
  return {
    snap: { lines: payload.lines ?? [], extras: payload.extras ?? { unmatchedPayouts: [], payoutGateways: [] }, computedAt: data.computed_at, durationMs: data.duration_ms },
    dirty: !!data.dirty,
  };
}

/** Run the reconciler once, however many callers ask at the same moment. */
export function refreshReconSnapshot(): Promise<ReconSnapshot> {
  if (!inFlight) {
    inFlight = (async () => {
      const { runReconciliation } = await import("@/lib/reconciliation/engine");
      await runReconciliation(); // saves the snapshot itself
      return memory!;
    })().finally(() => { inFlight = null; });
  }
  return inFlight;
}

export type ReconRead = ReconSnapshot & { stale: boolean; refreshing: boolean };

/**
 * The reconciliation lines for a read path.
 * `fresh: true` forces a recompute (actions that must see the exact current state).
 */
export async function getReconLines(opts: { fresh?: boolean } = {}): Promise<ReconRead> {
  if (opts.fresh) return { ...(await refreshReconSnapshot()), stale: false, refreshing: false };

  // Another server process may have written a newer snapshot or raised dirty:
  // check the row's two small columns, and download the payload only if newer.
  if (!memory) {
    const persisted = await loadPersisted();
    if (persisted) { memory = persisted.snap; if (persisted.dirty) dirty = true; }
  } else if (!dirty) {
    const { data } = await supabase.from("recon_snapshots").select("computed_at, dirty").eq("id", TENANT).maybeSingle();
    if (data?.dirty) dirty = true;
    else if (data && Date.parse(data.computed_at) > Date.parse(memory.computedAt)) {
      const persisted = await loadPersisted();
      if (persisted) memory = persisted.snap;
    }
  }

  if (!memory || dirty) return { ...(await refreshReconSnapshot()), stale: false, refreshing: false };

  const age = Date.now() - Date.parse(memory.computedAt);
  if (age > STALE_MS) {
    refreshReconSnapshot().catch((e) => console.error("[recon-snapshot] background refresh failed:", (e as Error).message));
    return { ...memory, stale: true, refreshing: true };
  }
  return { ...memory, stale: false, refreshing: !!inFlight };
}
