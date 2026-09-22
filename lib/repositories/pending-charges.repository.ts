// Gateway charges that no payout has claimed yet (gateway_pending_charges).
// Written by the Shopify Payments sync, read by the sales ledger.

import { supabase, selectAllPages } from "@/lib/supabase";
import type { PendingChargeRow } from "@/lib/integrations/shopify-payments";

export const PendingChargesRepository = {
  /**
   * Make the table match what the gateway reports right now for this store.
   * Charges that got paid out since the last sync disappear here — they are
   * in payout_transactions now — so a clear-then-insert is the correct model.
   * Only rows inside the fetched window are cleared, so a short sync window
   * never wipes older pending charges it didn't look at.
   */
  async replaceForStore(store: string, sinceIso: string, rows: PendingChargeRow[]): Promise<number> {
    const { error: delErr } = await supabase
      .from("gateway_pending_charges")
      .delete()
      .eq("store", store)
      .gte("transaction_date", sinceIso);
    if (delErr) throw new Error(`gateway_pending_charges clear failed: ${delErr.message}`);
    if (rows.length === 0) return 0;
    const synced_at = new Date().toISOString();
    const { error } = await supabase
      .from("gateway_pending_charges")
      .upsert(rows.map((r) => ({ ...r, synced_at })), { onConflict: "id" });
    if (error) throw new Error(`gateway_pending_charges upsert failed: ${error.message}`);
    return rows.length;
  },

  /** Drop pending rows that a payout has since claimed (by order ref). */
  async removeOrderRefs(store: string, refs: string[]): Promise<void> {
    if (refs.length === 0) return;
    const { error } = await supabase.from("gateway_pending_charges").delete().eq("store", store).in("order_ref", refs);
    if (error) throw new Error(`gateway_pending_charges prune failed: ${error.message}`);
  },

  async listSince(fromIso: string): Promise<PendingChargeRow[]> {
    return selectAllPages<PendingChargeRow>((from, to) =>
      supabase
        .from("gateway_pending_charges")
        .select("*")
        .gte("transaction_date", fromIso)
        .order("transaction_date", { ascending: true })
        .range(from, to),
    );
  },
};
