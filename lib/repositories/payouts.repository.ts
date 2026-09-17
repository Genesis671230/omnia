import { randomUUID } from "node:crypto";
import { supabase, selectAllPages } from "@/lib/supabase";
import type { ParsedPayout, PayoutTransactionShare } from "@/lib/parsers/payouts";
import { resolvePayoutId, type ExistingPayoutIdentity } from "@/lib/finance/payout-identity";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

// Factory (not just a plain method) so the delete-order contract —
// payout_transactions before payouts, both scoped to id — is testable
// against a fake client without a live database. PayoutsRepository.
// deletePayout below is this, wired to the real supabase client.
export function makeDeletePayout(client: typeof supabase) {
  return async function deletePayout(id: string): Promise<void> {
    const { error: txErr } = await client.from("payout_transactions").delete().eq("payout_id", id);
    if (txErr) throw new Error(`payout_transactions delete failed: ${txErr.message}`);
    const { error } = await client.from("payouts").delete().eq("id", id);
    if (error) throw new Error(`payouts delete failed: ${error.message}`);
  };
}

/** Decide which primary key each incoming payout should claim.
 *
 *  Tabby reuses one statement number for every store it pays on a date, so a
 *  second store's report used to overwrite the first. For each parsed payout we
 *  load the payouts already holding that statement number (plus their order
 *  refs, which is how a genuine re-upload is told apart from a different store)
 *  and let resolvePayoutId pick a free, deterministic id. Payouts resolved
 *  earlier in the same batch are folded in, so one upload carrying several
 *  stores cannot collide with itself. */
async function resolvePayoutIdentities(payouts: ParsedPayout[]): Promise<Map<string, string>> {
  const statementNos = [...new Set(payouts.map((p) => p.statementNo ?? p.id))];

  // Rows whose id equals a statement number are pre-disambiguation payouts that
  // predate the statement_no column, so match on either.
  const { data: rows, error } = await supabase
    .from("payouts")
    .select("id, statement_no, merchant_code, store")
    .or(`statement_no.in.(${statementNos.map((s) => `"${s}"`).join(",")}),id.in.(${statementNos.map((s) => `"${s}"`).join(",")})`);
  if (error) throw new Error(`payouts identity lookup failed: ${error.message}`);

  const claimed = (rows ?? []).map((r) => r.id);
  const refsByPayout = new Map<string, string[]>();
  if (claimed.length > 0) {
    const { data: txs, error: txErr } = await supabase
      .from("payout_transactions")
      .select("payout_id, order_ref")
      .in("payout_id", claimed);
    if (txErr) throw new Error(`payout identity refs lookup failed: ${txErr.message}`);
    for (const t of txs ?? []) {
      const list = refsByPayout.get(t.payout_id) ?? [];
      list.push(t.order_ref);
      refsByPayout.set(t.payout_id, list);
    }
  }

  const existing: ExistingPayoutIdentity[] = (rows ?? []).map((r) => ({
    id: r.id,
    statementNo: r.statement_no ?? r.id,
    merchantCode: r.merchant_code ?? null,
    store: r.store ?? null,
    orderRefs: refsByPayout.get(r.id) ?? [],
  }));

  const resolved = new Map<string, string>();
  for (const p of payouts) {
    const id = resolvePayoutId({
      statementNo: p.statementNo ?? p.id,
      merchantCode: p.merchantCode,
      merchantName: p.store,
      orderRefs: p.orderRefs,
      existing,
    });
    resolved.set(p.id, id);
    existing.push({
      id,
      statementNo: p.statementNo ?? p.id,
      merchantCode: p.merchantCode ?? null,
      store: p.store ?? null,
      orderRefs: p.orderRefs,
    });
  }
  return resolved;
}

export const PayoutsRepository = {
  deletePayout: makeDeletePayout(supabase),

  /** Store a batch of parsed payouts, returning the id each one actually
   *  claimed keyed by the id its parser proposed. The two differ whenever a
   *  statement number was already held by a different store — see
   *  resolvePayoutIdentities. Callers that need to act on the stored row
   *  (pinning it to a bank credit, say) must use the returned id. */
  async upsertPayoutsWithIds(payouts: ParsedPayout[]): Promise<Map<string, string>> {
    if (payouts.length === 0) return new Map();
    const ids = await resolvePayoutIdentities(payouts);

    const rows = payouts.map((p) => ({
      id: ids.get(p.id) ?? p.id, // pk: the statement number, disambiguated on collision
      tenant_id: TENANT,
      gateway: p.provider,
      payout_id: ids.get(p.id) ?? p.id,
      currency: "AED",
      store: p.store ?? null,
      merchant_code: p.merchantCode ?? null,
      statement_no: p.statementNo ?? p.id,
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
      uploaded_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("payouts").upsert(rows, { onConflict: "id" });
    if (error) throw new Error(`payouts upsert failed: ${error.message}`);

    // per-order refs — replace on re-upload
    for (const p of payouts) {
      const payoutId = ids.get(p.id) ?? p.id;
      const { error: delErr } = await supabase
        .from("payout_transactions")
        .delete()
        .eq("payout_id", payoutId);
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
          payout_id: payoutId,
          order_ref: ref,
          gross_aed: share?.grossShare ?? 0,
          fee_aed: share?.feeShare ?? 0,
          net_aed: share?.netShare ?? 0,
          is_refund: share?.isRefund ?? false,
          quality: share?.quality ?? null,
          gross_original: share?.grossOriginal ?? null,
          fee_original: share?.feeOriginal ?? null,
          net_original: share?.netOriginal ?? null,
          vat_aed: share?.vatShare ?? null,
          vat_original: share?.vatOriginal ?? null,
        };
      });
      const { error: insErr } = await supabase.from("payout_transactions").insert(txRows);
      if (insErr) throw new Error(`payout_transactions insert failed: ${insErr.message}`);
    }
    return ids;
  },

  async upsertPayouts(payouts: ParsedPayout[]): Promise<number> {
    const ids = await this.upsertPayoutsWithIds(payouts);
    return ids.size;
  },

  /** Attach payouts to the bank credit they were uploaded from. Any other
   *  payout previously attached to that credit is released back to
   *  auto-matching (it stays uploaded and visible until deleted). */
  async pinToBankLine(payoutIds: string[], bankLineId: string): Promise<void> {
    if (payoutIds.length === 0) return;
    const { error: clearErr } = await supabase
      .from("payouts")
      .update({ bank_line_id: null })
      .eq("bank_line_id", bankLineId)
      .not("id", "in", `(${payoutIds.map((id) => `"${id}"`).join(",")})`);
    if (clearErr) throw new Error(`payouts unpin failed: ${clearErr.message}`);
    const { error } = await supabase.from("payouts").update({ bank_line_id: bankLineId }).in("id", payoutIds);
    if (error) throw new Error(`payouts pin failed: ${error.message}`);
  },

  async listWithRefs(): Promise<
    {
      id: string; gateway: string; net_amount: number; gross_amount: number | null; fee_amount: number | null;
      source: string | null; status: string; order_refs: string[];
      /** Pinned to this bank credit when uploaded from its panel; null = auto-match. */
      bank_line_id?: string | null;
      uploaded_at?: string | null;
      original_currency: string | null; net_original: number | null;
      transactions: {
        order_ref: string; is_refund: boolean; quality: string | null;
        net_aed: number; gross_aed: number; fee_aed: number;
        net_original: number | null; gross_original: number | null; fee_original: number | null;
        vat_aed: number | null; vat_original: number | null;
      }[];
    }[]
  > {
    // Both reads are whole-table and MUST page. PostgREST silently truncates an
    // unpaginated select at 1000 rows: once payout_transactions passed 1000, the
    // reconciler stopped seeing the refs of the newest payouts, so a freshly
    // uploaded file showed zero orders with no error anywhere on screen.
    const payouts = await selectAllPages<{
      id: string; gateway: string; net_amount: number; gross_amount: number | null; fee_amount: number | null;
      source: string | null; status: string; original_currency: string | null; net_original: number | null;
      bank_line_id: string | null; uploaded_at: string | null;
    }>(
      (from, to) =>
        supabase
          .from("payouts")
          .select("id, gateway, net_amount, gross_amount, fee_amount, source, status, original_currency, net_original, bank_line_id, uploaded_at")
          .range(from, to),
      "payouts select",
    );

    const txs = await selectAllPages<{
      payout_id: string; order_ref: string; is_refund: boolean; quality: string | null;
      net_aed: number; gross_aed: number; fee_aed: number;
      net_original: number | null; gross_original: number | null; fee_original: number | null;
      vat_aed: number | null; vat_original: number | null;
    }>(
      (from, to) =>
        supabase
          .from("payout_transactions")
          .select("payout_id, order_ref, is_refund, quality, net_aed, gross_aed, fee_aed, net_original, gross_original, fee_original, vat_aed, vat_original")
          .range(from, to),
      "payout_transactions select",
    );

    const refsByPayout = new Map<string, string[]>();
    const transactionsByPayout = new Map<
      string,
      {
        order_ref: string; is_refund: boolean; quality: string | null;
        net_aed: number; gross_aed: number; fee_aed: number;
        net_original: number | null; gross_original: number | null; fee_original: number | null;
        vat_aed: number | null; vat_original: number | null;
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
        vat_aed: t.vat_aed != null ? Number(t.vat_aed) : null,
        vat_original: t.vat_original != null ? Number(t.vat_original) : null,
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
