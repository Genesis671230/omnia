import { supabase } from "@/lib/supabase";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type RefundPostingRow = {
  id: string;
  bank_line_id: string;
  payout_id: string;
  order_number: string;
  amount_aed: number;
  zoho_invoice_id: string | null;
  zoho_creditnote_id: string | null;
  creditnote_reused: boolean;
  zoho_refund_id: string | null;
  error: string | null;
  claimed_at: string | null;
  posted_at: string | null;
  /** net − gross of the refund line, AED. + = fee handed back, − = extra charge. */
  charge_amount_aed?: number | null;
  zoho_charge_id?: string | null;
  /** cn_refund: fee part refunded against the credit note; expense: extra charge. */
  charge_kind?: "journal" | "expense" | "cn_refund" | null;
};

export const refundPostingId = (payoutId: string, orderNumber: string) => `${payoutId}|${orderNumber}`;

// One row per refund a gateway netted out of a payout: the Zoho credit note
// and the refund of it. See lib/finance/publish-refunds.ts.
export const RefundPostingsRepository = {
  async listByBankLine(bankLineId: string): Promise<RefundPostingRow[]> {
    const { data, error } = await supabase.from("refund_postings").select("*").eq("bank_line_id", bankLineId);
    if (error) throw new Error(`refund_postings select failed: ${error.message}`);
    return (data ?? []) as RefundPostingRow[];
  },

  async ensure(row: Pick<RefundPostingRow, "bank_line_id" | "payout_id" | "order_number" | "amount_aed">): Promise<RefundPostingRow> {
    const id = refundPostingId(row.payout_id, row.order_number);
    const { data: existing } = await supabase.from("refund_postings").select("*").eq("id", id).maybeSingle();
    if (existing) {
      if (Number(existing.amount_aed) !== row.amount_aed && !existing.zoho_refund_id) {
        await supabase.from("refund_postings").update({ amount_aed: row.amount_aed }).eq("id", id);
        existing.amount_aed = row.amount_aed;
      }
      return existing as RefundPostingRow;
    }
    const insert = { id, tenant_id: TENANT, ...row };
    const { data, error } = await supabase.from("refund_postings").insert(insert).select("*").single();
    if (error) throw new Error(`refund_postings insert failed: ${error.message}`);
    return data as RefundPostingRow;
  },

  async lease(id: string, leaseMinutes = 5): Promise<boolean> {
    const staleBefore = new Date(Date.now() - leaseMinutes * 60_000).toISOString();
    const { data, error } = await supabase
      .from("refund_postings")
      .update({ claimed_at: new Date().toISOString() })
      .eq("id", id)
      .or(`claimed_at.is.null,claimed_at.lt.${staleBefore}`)
      .select("id");
    if (error) throw new Error(`refund_postings lease failed: ${error.message}`);
    return (data ?? []).length === 1;
  },

  async release(id: string): Promise<void> {
    await supabase.from("refund_postings").update({ claimed_at: null }).eq("id", id);
  },

  async update(id: string, patch: Partial<RefundPostingRow>): Promise<void> {
    const { error } = await supabase.from("refund_postings").update(patch).eq("id", id);
    if (error) throw new Error(`refund_postings update failed: ${error.message}`);
  },
};
