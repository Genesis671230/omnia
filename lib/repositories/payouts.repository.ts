import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/supabase";
import type { ParsedPayout, PayoutTransactionShare } from "@/lib/parsers/payouts";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export const PayoutsRepository = {
  async upsertPayouts(payouts: ParsedPayout[]): Promise<number> {
    if (payouts.length === 0) return 0;

    const rows = payouts.map((p) => ({
      id: p.id, // payout id doubles as pk — one file, one payout
      tenant_id: TENANT,
      gateway: p.provider,
      payout_id: p.id,
      currency: "AED",
      // gross/fees aren't always in the source file (e.g. Telr's xls has no
      // gross column) — gross_amount/fee_amount are NOT NULL, so fall back
      // to net (fee unknown ⇒ assume 0) rather than fail the whole upload.
      gross_amount: p.gross ?? p.net,
      fee_amount: p.fees ?? 0,
      net_amount: p.net,
      txn_count: p.orderRefs.length,
      status: "uploaded",
      source: p.source,
      original_currency: p.originalCurrency ?? null,
      net_original: p.netOriginal ?? null,
    }));
    const { error } = await supabase.from("payouts").upsert(rows, { onConflict: "id" });
    if (error) throw new Error(`payouts upsert failed: ${error.message}`);

    // per-order refs — replace on re-upload
    for (const p of payouts) {
      const { error: delErr } = await supabase
        .from("payout_transactions")
        .delete()
        .eq("payout_id", p.id);
      if (delErr) throw new Error(`payout_transactions clear failed: ${delErr.message}`);
      if (p.orderRefs.length === 0) continue;

      // When the parser gave us a per-transaction breakdown (Stripe, live API
      // + CSV uploads), persist the real net/gross/fee share and is_refund/
      // quality per ref. Older parsers (Telr/Tamara/Tabby/generic) only total
      // the whole file — 0/false/null there are honest placeholders, not a
      // guess, since that granularity was never computed.
      const sharesByRef = new Map<string, PayoutTransactionShare>();
      for (const t of p.transactions ?? []) sharesByRef.set(t.ref, t);

      const txRows = p.orderRefs.map((ref) => {
        const share = sharesByRef.get(ref);
        return {
          id: randomUUID(),
          tenant_id: TENANT,
          payout_id: p.id,
          order_ref: ref,
          gross_aed: share?.grossShare ?? 0,
          fee_aed: share?.feeShare ?? 0,
          net_aed: share?.netShare ?? 0,
          is_refund: share?.isRefund ?? false,
          quality: share?.quality ?? null,
          gross_original: share?.grossOriginal ?? null,
          fee_original: share?.feeOriginal ?? null,
          net_original: share?.netOriginal ?? null,
        };
      });
      const { error: insErr } = await supabase.from("payout_transactions").insert(txRows);
      if (insErr) throw new Error(`payout_transactions insert failed: ${insErr.message}`);
    }
    return payouts.length;
  },

  async listWithRefs(): Promise<
    {
      id: string; gateway: string; net_amount: number; gross_amount: number | null; fee_amount: number | null;
      source: string | null; status: string; order_refs: string[];
      original_currency: string | null; net_original: number | null;
      transactions: {
        order_ref: string; is_refund: boolean; quality: string | null;
        net_aed: number; gross_aed: number; fee_aed: number;
        net_original: number | null; gross_original: number | null; fee_original: number | null;
      }[];
    }[]
  > {
    const { data: payouts, error } = await supabase
      .from("payouts")
      .select("id, gateway, net_amount, gross_amount, fee_amount, source, status, original_currency, net_original");
    if (error) throw new Error(`payouts select failed: ${error.message}`);

    const { data: txs, error: txErr } = await supabase
      .from("payout_transactions")
      .select("payout_id, order_ref, is_refund, quality, net_aed, gross_aed, fee_aed, net_original, gross_original, fee_original");
    if (txErr) throw new Error(`payout_transactions select failed: ${txErr.message}`);

    const refsByPayout = new Map<string, string[]>();
    const transactionsByPayout = new Map<
      string,
      {
        order_ref: string; is_refund: boolean; quality: string | null;
        net_aed: number; gross_aed: number; fee_aed: number;
        net_original: number | null; gross_original: number | null; fee_original: number | null;
      }[]
    >();
    for (const t of txs ?? []) {
      const refs = refsByPayout.get(t.payout_id) ?? [];
      refs.push(t.order_ref);
      refsByPayout.set(t.payout_id, refs);

      const list = transactionsByPayout.get(t.payout_id) ?? [];
      list.push({
        order_ref: t.order_ref, is_refund: Boolean(t.is_refund), quality: t.quality,
        net_aed: Number(t.net_aed || 0),
        gross_aed: Number(t.gross_aed || 0),
        fee_aed: Number(t.fee_aed || 0),
        net_original: t.net_original != null ? Number(t.net_original) : null,
        gross_original: t.gross_original != null ? Number(t.gross_original) : null,
        fee_original: t.fee_original != null ? Number(t.fee_original) : null,
      });
      transactionsByPayout.set(t.payout_id, list);
    }
    return (payouts ?? []).map((p) => ({
      ...p,
      order_refs: refsByPayout.get(p.id) ?? [],
      transactions: transactionsByPayout.get(p.id) ?? [],
    }));
  },
};
