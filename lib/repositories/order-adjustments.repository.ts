// order_adjustments — one row per order the founder cancelled / returned /
// refunded / exchanged from the app, with the Zoho documents it created.
// orders.ops_status mirrors the posted kind so every sales view honours it.

import { currentTenant } from "@/lib/tenant";
import { supabase } from "@/lib/supabase";
import type { AdjustmentKind } from "@/lib/orders/order-adjustment";

const TENANT = currentTenant();

export type OrderAdjustmentRow = {
  /** postedFor only: the "received" close posted before this credit adjustment. */
  receivedAlso?: OrderAdjustmentRow | null;
  id: string;
  order_uid: string;
  order_number: string;
  store_id: string;
  kind: AdjustmentKind;
  adjustment_date: string;
  zoho_connection_id: string;
  zoho_invoice_id: string | null;
  zoho_invoice_number: string;
  invoice_total: number;
  returned_lines: unknown[];
  damage_aed: number;
  credit_aed: number;
  zoho_creditnote_id: string | null;
  zoho_creditnote_number: string;
  applied_to_invoice_aed: number;
  exchange_lines: unknown[];
  exchange_total: number;
  zoho_exchange_invoice_id: string | null;
  zoho_exchange_invoice_number: string;
  applied_to_exchange_aed: number;
  customer_owes_aed: number;
  refund_due_aed: number;
  mark_only: boolean;
  note: string;
  received_aed: number;
  received_via: string;
  deposit_account_id: string;
  deposit_account_name: string;
  zoho_payment_id: string | null;
  status: "draft" | "posted" | "error";
  error: string | null;
  created_by: string;
  created_at: string;
  posted_at: string | null;
};

const num = (r: Record<string, unknown>, k: string) => Number(r[k] ?? 0);
const fromDb = (r: Record<string, unknown>): OrderAdjustmentRow => ({
  ...(r as OrderAdjustmentRow),
  invoice_total: num(r, "invoice_total"), damage_aed: num(r, "damage_aed"), credit_aed: num(r, "credit_aed"),
  applied_to_invoice_aed: num(r, "applied_to_invoice_aed"), exchange_total: num(r, "exchange_total"),
  applied_to_exchange_aed: num(r, "applied_to_exchange_aed"), customer_owes_aed: num(r, "customer_owes_aed"), refund_due_aed: num(r, "refund_due_aed"),
  received_aed: num(r, "received_aed"),
});

export const OrderAdjustmentsRepository = {
  async forOrder(uid: string): Promise<OrderAdjustmentRow[]> {
    const { data, error } = await supabase.from("order_adjustments").select("*").eq("tenant_id", TENANT).eq("order_uid", uid).order("created_at");
    if (error) throw new Error(`order_adjustments read failed: ${error.message}`);
    return (data ?? []).map(fromDb);
  },

  /** Posted adjustments for these order numbers (sales ledger, management report). */
  async postedFor(orderNumbers: string[]): Promise<Map<string, OrderAdjustmentRow>> {
    const out = new Map<string, OrderAdjustmentRow>();
    for (let i = 0; i < orderNumbers.length; i += 300) {
      const { data, error } = await supabase.from("order_adjustments").select("*").eq("tenant_id", TENANT).eq("status", "posted")
        .in("order_number", orderNumbers.slice(i, i + 300));
      if (error) throw new Error(`order_adjustments read failed: ${error.message}`);
      // An order can be closed as received and later refunded / returned:
      // the credit adjustment is the one that describes it, with the
      // received close kept on it (receivedAlso) so the money still counts.
      for (const r of (data ?? []).map(fromDb)) {
        const prev = out.get(r.order_number);
        if (!prev) { out.set(r.order_number, r); continue; }
        const [credit, recv] = prev.kind === "received" ? [r, prev] : r.kind === "received" ? [prev, r] : [r, null];
        out.set(r.order_number, recv && credit.kind !== "received" ? { ...credit, receivedAlso: recv } : credit);
      }
    }
    return out;
  },

  async insert(row: Partial<OrderAdjustmentRow>): Promise<OrderAdjustmentRow> {
    const { data, error } = await supabase.from("order_adjustments").insert({ tenant_id: TENANT, ...row }).select("*").single();
    if (error) throw new Error(`order_adjustments insert failed: ${error.message}`);
    return fromDb(data);
  },

  async update(id: string, patch: Partial<OrderAdjustmentRow>): Promise<void> {
    const { error } = await supabase.from("order_adjustments").update(patch).eq("tenant_id", TENANT).eq("id", id);
    if (error) throw new Error(`order_adjustments update failed: ${error.message}`);
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("order_adjustments").delete().eq("tenant_id", TENANT).eq("id", id);
    if (error) throw new Error(`order_adjustments delete failed: ${error.message}`);
  },

  /** Mirror the outcome onto the order row (null clears it). */
  async setOrderOps(uid: string, ops: { kind: AdjustmentKind; creditAed: number } | null): Promise<void> {
    const { error } = await supabase.from("orders").update({ ops_status: ops?.kind ?? null, ops_credit_aed: ops?.creditAed ?? null }).eq("uid", uid);
    if (error) throw new Error(`orders ops_status update failed: ${error.message}`);
  },
};
