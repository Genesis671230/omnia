import { supabase } from "@/lib/supabase";
import type { OrderRow } from "@/lib/normalize/order";

export const OrdersRepository = {
  // Upsert synced orders WITHOUT touching settlement fields — payout_id /
  // payout_status belong to the reconciler, and a re-sync must never
  // un-settle an order.
  async upsertMany(rows: OrderRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const syncRows = rows.map(({ payout_status: _p, ...rest }) => rest);
    const { error } = await supabase.from("orders").upsert(syncRows, { onConflict: "uid" });
    if (error) throw new Error(`orders upsert failed: ${error.message}`);

    const { error: fillErr } = await supabase
      .from("orders")
      .update({ payout_status: "awaiting" })
      .is("payout_status", null);
    if (fillErr) throw new Error(`payout_status backfill failed: ${fillErr.message}`);
    return rows.length;
  },

  // Supabase caps a select at 1000 rows — page through everything so the
  // ledger and the reconciler always see the full order book.
  async listAll() {
    const PAGE = 1000;
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "uid, store_id, order_number, order_date, customer_name, customer_email, customer_phone, city, country, currency, gross_original, gross_aed, gateway, gateway_raw, financial_status, fulfillment_status, telr_cartid, telr_tranref, payout_id, payout_status, line_items, courier, tracking_number, tracking_url, fulfillment_stage, fulfillment_stage_updated_at",
        )
        .order("order_date", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`orders select failed: ${error.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    return rows as {
      uid: string; store_id: string; order_number: string; order_date: string | null;
      customer_name: string; customer_email: string; customer_phone: string; city: string; country: string;
      currency: string; gross_original: number; gross_aed: number; gateway: string;
      gateway_raw: string; financial_status: string; fulfillment_status: string;
      telr_cartid: string; telr_tranref: string; payout_id: string | null;
      payout_status: string;
      line_items: { title: string; sku: string; qty: number; total_aed: number; image_url?: string; stock?: number | null }[];
      courier: string; tracking_number: string; tracking_url: string;
      fulfillment_stage: string; fulfillment_stage_updated_at: string | null;
    }[];
  },

  async getByUid(uid: string) {
    const { data, error } = await supabase
      .from("orders")
      .select(
        "uid, store_id, order_number, order_date, customer_name, customer_email, customer_phone, city, country, currency, gross_original, gross_aed, gateway, gateway_raw, financial_status, fulfillment_status, payout_id, payout_status, line_items, courier, tracking_number, tracking_url, fulfillment_stage, fulfillment_stage_updated_at",
      )
      .eq("uid", uid)
      .single();
    if (error) return null;
    return data;
  },

  async markSettled(orderNumbers: string[], payoutId: string) {
    if (orderNumbers.length === 0) return;
    const { error } = await supabase
      .from("orders")
      .update({ payout_id: payoutId, payout_status: "settled" })
      .in("order_number", orderNumbers);
    if (error) throw new Error(`orders settle stamp failed: ${error.message}`);
  },

  async setFulfillmentStage(uid: string, stage: string, updatedBy: string) {
    const { data, error } = await supabase
      .from("orders")
      .update({ fulfillment_stage: stage, fulfillment_stage_updated_at: new Date().toISOString(), fulfillment_stage_updated_by: updatedBy })
      .eq("uid", uid)
      .select("uid, fulfillment_stage, fulfillment_stage_updated_at")
      .single();
    if (error) throw new Error(`fulfillment stage update failed: ${error.message}`);
    return data;
  },
};
