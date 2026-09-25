// The audit trail: one immutable row per order the moment its bank credit is
// confirmed SETTLED. This is what a founder points an accountant — or Zoho
// Books — at, independent of whatever the live orders/payouts tables say
// later. Written by the reconciliation engine, never by hand.

import { supabase } from "@/lib/supabase";
import type { OrderSettlementInfo } from "@/lib/orders-finance-status";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type SettlementRecord = {
  id: string;
  order_uid: string;
  order_number: string;
  store_id: string;
  customer_name: string;
  customer_email: string;
  order_date: string | null;
  settlement_date: string | null;
  gateway: string;
  /** The unit of gross_aed. Always AED — not what the customer was charged. */
  currency: string;
  /** What the customer was actually charged in (SAR, QAR, AED...). Decides
   *  whether an invoice-vs-gateway gap is an exchange difference; see
   *  isFxOrder() in lib/finance/settlement-posting.ts. */
  order_currency?: string | null;
  gross_aed: number;
  bank_line_id: string;
  payout_id: string | null;
  bank_reference: string;
  recorded_at: string;
  // stripe_api: Stripe itself reported the payout as PAID (born confirmed).
  // document: a countersigned settlement document was uploaded and confirmed.
  // bank_confirmed: a human confirmed the reconciled bank credit in the
  //   reconciliation workspace — the path every non-Stripe gateway takes.
  evidence_type: "stripe_api" | "document" | "bank_confirmed" | null;
  evidence_confirmed: boolean;
  evidence_confirmed_by: string | null;
  evidence_confirmed_at: string | null;
  evidence_document_id: string | null;
  zoho_payment_id: string | null;
  zoho_published_at: string | null;
  // Gateway fee / VAT / FX booking — see lib/finance/settlement-posting.ts.
  // The three id columns hold a Zoho id, or PENDING:<attempt> mid-write.
  zoho_claimed_at?: string | null;
  zoho_invoice_id?: string | null;
  zoho_fee_expense_id?: string | null;
  zoho_fx_journal_id?: string | null;
  fee_aed?: number | null;
  fee_vat_aed?: number | null;
  fx_difference_aed?: number | null;
  zoho_post_error?: string | null;
  // What Zoho said about the invoice the last time anything read it. Kept so
  // the proof panel can show the invoice amount and exchange difference
  // without re-searching Zoho once per order every time it opens.
  zoho_invoice_number?: string | null;
  zoho_invoice_status?: string | null;
  /** The balance still owed when we looked — what the payment closes. */
  zoho_invoice_balance?: number | null;
  zoho_invoice_total?: number | null;
  zoho_invoice_checked_at?: string | null;
  /** Founder's per-order override: which invoice(s) the payment closes and
   *  how much goes to each. See publishSettlements(). */
  force_allocations?: ForceAllocation[] | null;
  force_note?: string | null;
  force_by?: string | null;
  force_at?: string | null;
  force_payment_id?: string | null;
  force_payment_amount?: number | null;
};

export type ForceAllocation = { invoice_id: string; invoice_number: string; amount: number };

export type SettlementPostingColumns = Partial<
  Pick<
    SettlementRecord,
    | "zoho_payment_id"
    | "zoho_published_at"
    | "zoho_invoice_id"
    | "zoho_fee_expense_id"
    | "zoho_fx_journal_id"
    | "fee_aed"
    | "fee_vat_aed"
    | "fx_difference_aed"
    | "zoho_post_error"
    | "zoho_invoice_number"
    | "zoho_invoice_status"
    | "zoho_invoice_balance"
    | "zoho_invoice_total"
    | "zoho_invoice_checked_at"
    | "force_allocations"
    | "force_note"
    | "force_by"
    | "force_at"
    | "force_payment_id"
    | "force_payment_amount"
  >
>;

/** A Zoho id column that doesn't yet point at a real document: empty, or a
 *  marker left by a claim / an in-flight write. */
export function isUnsettledZohoId(v: string | null | undefined): boolean {
  return !v || v.startsWith("CLAIMED:") || v.startsWith("PENDING:");
}

export type ExistingSettlementRecord = Pick<
  SettlementRecord,
  | "id"
  | "order_uid"
  | "evidence_type"
  | "evidence_confirmed"
  | "evidence_confirmed_by"
  | "evidence_confirmed_at"
  | "evidence_document_id"
  | "zoho_payment_id"
  | "zoho_published_at"
  // Which bank credit this record belongs to. Needed to tell a record that is
  // still live from one orphaned by a payout reassignment — see persistResults.
  | "bank_line_id"
>;

export const SettlementsRepository = {
  async upsertMany(rows: Omit<SettlementRecord, "recorded_at">[]): Promise<void> {
    if (rows.length === 0) return;
    const withTenant = rows.map((r) => ({ ...r, tenant_id: TENANT }));
    const { error } = await supabase.from("settlement_records").upsert(withTenant, { onConflict: "id" });
    if (error) throw new Error(`settlement_records upsert failed: ${error.message}`);
  },

  async listByDate(date: string): Promise<SettlementRecord[]> {
    const { data, error } = await supabase
      .from("settlement_records")
      .select("*")
      .eq("settlement_date", date)
      .order("gateway", { ascending: true });
    if (error) throw new Error(`settlement_records select failed: ${error.message}`);
    return (data ?? []) as SettlementRecord[];
  },

  async listRange(fromDate: string, toDate: string): Promise<SettlementRecord[]> {
    const { data, error } = await supabase
      .from("settlement_records")
      .select("*")
      .gte("settlement_date", fromDate)
      .lte("settlement_date", toDate)
      .order("settlement_date", { ascending: false });
    if (error) throw new Error(`settlement_records select failed: ${error.message}`);
    return (data ?? []) as SettlementRecord[];
  },

  async listDatesWithCounts(): Promise<{ date: string; count: number; total: number }[]> {
    const { data, error } = await supabase
      .from("settlement_records")
      .select("settlement_date, gross_aed")
      .order("settlement_date", { ascending: false })
      .limit(5000);
    if (error) throw new Error(`settlement_records select failed: ${error.message}`);
    const byDate = new Map<string, { count: number; total: number }>();
    for (const r of data ?? []) {
      if (!r.settlement_date) continue;
      const v = byDate.get(r.settlement_date) ?? { count: 0, total: 0 };
      v.count += 1;
      v.total += Number(r.gross_aed || 0);
      byDate.set(r.settlement_date, v);
    }
    return [...byDate.entries()]
      .map(([date, v]) => ({ date, count: v.count, total: +v.total.toFixed(2) }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  },

  // Which of these orders already have a settlement record, under what id,
  // and with what evidence/publish state — both the engine and the
  // Stripe-API path check the id before writing, so one order can never
  // accumulate two publishable records (= two Zoho Customer Payments); the
  // engine also uses the evidence/zoho fields to carry forward a row's prior
  // confirmation and publish state on recompute (see persistResults in
  // lib/reconciliation/engine.ts) instead of resetting it to blank every
  // time reconciliation re-runs. Chunked for .in() URL length.
  async listExistingByOrderUids(orderUids: string[]): Promise<ExistingSettlementRecord[]> {
    const out: ExistingSettlementRecord[] = [];
    for (let i = 0; i < orderUids.length; i += 200) {
      const { data, error } = await supabase
        .from("settlement_records")
        .select(
          "id, order_uid, bank_line_id, evidence_type, evidence_confirmed, evidence_confirmed_by, evidence_confirmed_at, evidence_document_id, zoho_payment_id, zoho_published_at",
        )
        .in("order_uid", orderUids.slice(i, i + 200));
      if (error) throw new Error(`settlement_records existing select failed: ${error.message}`);
      out.push(...(data ?? []));
    }
    return out;
  },

  /** Settlement state per order uid, shaped for computeFinanceStatuses.
   *
   *  This is what lets an order page say "the gateway confirms it paid this"
   *  and "this is ready to book in Zoho" — without it every order read as
   *  AWAITING_BANK no matter how much evidence its settlement record carried. */
  async settlementInfoByOrderUid(orderUids: string[]): Promise<Map<string, OrderSettlementInfo>> {
    const rows = await this.listExistingByOrderUids(orderUids);
    return new Map(
      rows.map((r) => [
        r.order_uid,
        {
          settlement_id: r.id,
          evidence_type: r.evidence_type,
          evidence_confirmed: Boolean(r.evidence_confirmed),
          zoho_payment_id: r.zoho_payment_id,
          zoho_published_at: r.zoho_published_at,
        },
      ]),
    );
  },

  /** Drop settlement records that a reassignment has orphaned.
   *
   *  A record's id is `${order_uid}_${bank_line_id}`, so when the reconciler
   *  moves an order to the credit that actually paid it, the old row can never
   *  be reached again — and while it exists, the "one settlement record per
   *  order" guard blocks the correct row from being written at all. Callers
   *  must never pass a record that carries a zoho_payment_id: a booked payment
   *  is history, not something to relocate. */
  async deleteOrphanedByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    let removed = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data, error } = await supabase
        .from("settlement_records")
        .delete()
        .in("id", chunk)
        .is("zoho_payment_id", null) // belt and braces: never delete a booked row
        .select("id");
      if (error) throw new Error(`settlement_records orphan delete failed: ${error.message}`);
      removed += (data ?? []).length;
    }
    return removed;
  },

  /** Which of these settlement ids already carry this evidence type. */
  async idsWithEvidence(ids: string[], evidenceType: string): Promise<Set<string>> {
    const out = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase.from("settlement_records").select("id").in("id", ids.slice(i, i + 200)).eq("evidence_type", evidenceType);
      if (error) throw new Error(`settlement_records evidence lookup failed: ${error.message}`);
      for (const r of data ?? []) out.add(r.id as string);
    }
    return out;
  },

  async markStripeEvidence(settlementIds: string[]): Promise<void> {
    if (settlementIds.length === 0) return;
    const { error } = await supabase
      .from("settlement_records")
      .update({
        evidence_type: "stripe_api",
        evidence_confirmed: true,
        evidence_confirmed_by: "stripe-api",
        evidence_confirmed_at: new Date().toISOString(),
      })
      .in("id", settlementIds);
    if (error) throw new Error(`settlement_records evidence update failed: ${error.message}`);
  },

  async listUnconfirmed(): Promise<SettlementRecord[]> {
    const { data, error } = await supabase
      .from("settlement_records")
      .select("*")
      .eq("evidence_confirmed", false)
      .order("settlement_date", { ascending: false })
      .limit(500);
    if (error) throw new Error(`settlement_records select failed: ${error.message}`);
    return (data ?? []) as SettlementRecord[];
  },

  async listReadyToPublish(): Promise<SettlementRecord[]> {
    const { data, error } = await supabase
      .from("settlement_records")
      .select("*")
      .eq("evidence_confirmed", true)
      .is("zoho_payment_id", null)
      .order("settlement_date", { ascending: false })
      .limit(500);
    if (error) throw new Error(`settlement_records select failed: ${error.message}`);
    return (data ?? []) as SettlementRecord[];
  },

  // Atomically claims a settlement for publishing — the fix for the
  // duplicate-payment race (two concurrent /publish calls, or a retry,
  // both passing a "not yet published" check before either writes).
  // Postgres serializes concurrent UPDATEs to the same row: if two calls
  // race, the loser's WHERE no longer matches once the winner commits
  // (zoho_payment_id is no longer null), so it gets zero rows back. Returns
  // true iff THIS call won the race.
  async claimForPublish(id: string, attemptId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from("settlement_records")
      .update({ zoho_payment_id: `CLAIMED:${attemptId}` })
      .eq("id", id)
      .eq("evidence_confirmed", true)
      .is("zoho_payment_id", null)
      .select("id");
    if (error) throw new Error(`settlement_records claim failed: ${error.message}`);
    return (data ?? []).length === 1;
  },

  // Releases a claim on a clean (non-ambiguous) Zoho failure so the
  // settlement can be retried. Only clears OUR claim — never clobbers a
  // completed publish or a different in-flight attempt.
  async releaseClaim(id: string, attemptId: string): Promise<void> {
    const { error } = await supabase
      .from("settlement_records")
      .update({ zoho_payment_id: null })
      .eq("id", id)
      .eq("zoho_payment_id", `CLAIMED:${attemptId}`);
    if (error) throw new Error(`settlement_records release failed: ${error.message}`);
  },

  // A human confirmed the reconciled bank credit, so every settlement record
  // that credit produced becomes evidence-confirmed and therefore publishable
  // to Zoho. This is the non-Stripe counterpart to a PAID Stripe payout:
  // Stripe's own API is the evidence there, a person is the evidence here.
  //
  // Deliberately narrow: only rows still awaiting evidence are touched, so
  // re-confirming can never overwrite stronger stripe_api/document evidence,
  // reopen an already-published row, or reassign who confirmed it.
  async confirmEvidenceForBankLine(bankLineId: string, actor: string): Promise<number> {
    const { data, error } = await supabase
      .from("settlement_records")
      .update({
        evidence_type: "bank_confirmed",
        evidence_confirmed: true,
        evidence_confirmed_by: actor,
        evidence_confirmed_at: new Date().toISOString(),
      })
      .eq("bank_line_id", bankLineId)
      .eq("evidence_confirmed", false)
      .is("zoho_payment_id", null)
      .select("id");
    if (error) throw new Error(`settlement_records confirm failed: ${error.message}`);
    return (data ?? []).length;
  },

  async markPublished(id: string, zohoPaymentId: string): Promise<void> {
    const { error } = await supabase
      .from("settlement_records")
      .update({ zoho_payment_id: zohoPaymentId, zoho_published_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`settlement_records publish update failed: ${error.message}`);
  },

  // Short row lease for the fee/VAT/FX booking flow. Unlike claimForPublish
  // (which parks a marker in zoho_payment_id forever if the process dies),
  // this expires on its own, so a crashed publish never strands an order —
  // the per-document PENDING markers are what make the retry safe.
  async leaseForPosting(id: string, leaseMinutes = 5): Promise<boolean> {
    const staleBefore = new Date(Date.now() - leaseMinutes * 60_000).toISOString();
    const { data, error } = await supabase
      .from("settlement_records")
      .update({ zoho_claimed_at: new Date().toISOString() })
      .eq("id", id)
      .or(`zoho_claimed_at.is.null,zoho_claimed_at.lt.${staleBefore}`)
      .select("id");
    if (error) throw new Error(`settlement_records lease failed: ${error.message}`);
    return (data ?? []).length === 1;
  },

  async releasePostingLease(id: string): Promise<void> {
    const { error } = await supabase
      .from("settlement_records")
      .update({ zoho_claimed_at: null })
      .eq("id", id);
    if (error) throw new Error(`settlement_records lease release failed: ${error.message}`);
  },

  /** Remember what Zoho said about each order's invoice, so the proof panel
   *  can render the invoice amount and exchange difference without paying for
   *  a `customer_name_startswith` search per order every time it opens.
   *  Matched on order_number within one bank credit; a miss is simply skipped. */
  async saveInvoiceSnapshots(
    bankLineId: string,
    rows: {
      orderNumber: string;
      zoho_invoice_number: string | null;
      zoho_invoice_status: string;
      zoho_invoice_balance: number;
      zoho_invoice_total: number | null;
    }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const checkedAt = new Date().toISOString();
    // One round trip each, but in parallel — serially awaiting 14 updates
    // inside a GET was adding seconds to a request that should be instant.
    // Never upsert here: these rows carry booking state, and a partial upsert
    // would null every column this patch omits.
    await Promise.all(
      rows.map(async ({ orderNumber, ...cols }) => {
        const { error } = await supabase
          .from("settlement_records")
          .update({ ...cols, zoho_invoice_checked_at: checkedAt })
          .eq("bank_line_id", bankLineId)
          .eq("order_number", orderNumber);
        if (error) throw new Error(`settlement_records invoice snapshot failed: ${error.message}`);
      }),
    );
  },

  /** The order's original gateway fee as this app booked it (the sale's
   *  settlement, not a refund) — decides whether a returned fee carries VAT. */
  async originalFee(orderNumber: string): Promise<{ fee: number; vat: number } | null> {
    const { data, error } = await supabase
      .from("settlement_records")
      .select("fee_aed, fee_vat_aed")
      .eq("order_number", orderNumber)
      .not("fee_aed", "is", null)
      .gt("fee_aed", 0)
      .limit(1);
    if (error) throw new Error(`settlement_records fee lookup failed: ${error.message}`);
    const r = data?.[0];
    return r ? { fee: Number(r.fee_aed), vat: Number(r.fee_vat_aed ?? 0) } : null;
  },

  async getById(id: string): Promise<SettlementRecord | null> {
    const { data, error } = await supabase.from("settlement_records").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`settlement_records read failed: ${error.message}`);
    return (data as SettlementRecord) ?? null;
  },

  /** Save (or, with null, clear) the founder's invoice allocation for one order. */
  async setForceAllocations(
    id: string,
    force: { allocations: ForceAllocation[]; note: string; by: string } | null,
  ): Promise<void> {
    const { error } = await supabase.from("settlement_records").update(
      force
        ? { force_allocations: force.allocations, force_note: force.note, force_by: force.by, force_at: new Date().toISOString(), zoho_post_error: null }
        : { force_allocations: null, force_note: null, force_by: null, force_at: null },
    ).eq("id", id);
    if (error) throw new Error(`settlement_records force update failed: ${error.message}`);
  },

  async updatePosting(id: string, patch: SettlementPostingColumns): Promise<void> {
    const { error } = await supabase.from("settlement_records").update(patch).eq("id", id);
    if (error) throw new Error(`settlement_records posting update failed: ${error.message}`);
  },

  /** Whether any order on this bank credit already had its gateway fee or FX
   *  difference booked individually — the payout-level transfer must then
   *  move only the net, or the fee would be expensed twice. */
  async hasOrderLevelFeeBooking(bankLineId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from("settlement_records")
      .select("id")
      .eq("bank_line_id", bankLineId)
      .or("zoho_fee_expense_id.not.is.null,zoho_fx_journal_id.not.is.null")
      .limit(1);
    if (error) throw new Error(`settlement_records fee-booking check failed: ${error.message}`);
    return (data ?? []).length > 0;
  },

  async listByIds(ids: string[]): Promise<SettlementRecord[]> {
    if (ids.length === 0) return [];
    const { data, error } = await supabase.from("settlement_records").select("*").in("id", ids);
    if (error) throw new Error(`settlement_records select failed: ${error.message}`);
    return (data ?? []) as SettlementRecord[];
  },

  // Powers both the Record Payments dialog (preview: which orders in this
  // payout are ready/already posted) and /api/settlements/publish's
  // bankLineId mode.
  //
  // A payout's settlement_records can be split across two bank_line_ids:
  // stripe-settlements.ts writes evidence-confirmed rows under a synthetic
  // "STRIPE-API:po_<id>" id the moment Stripe's own API reports a payout
  // PAID, before any bank statement exists; when the real bank credit is
  // later matched (a different bank_line_id), engine.ts's persistResults()
  // only writes rows for the orders Stripe hadn't already claimed. So a
  // single bank_line_id's own rows can be a strict subset of the payout's
  // orders — pull in same-payout_id siblings filed under other bank_line_ids
  // too, matching what the proof table already shows (it reads the payout
  // directly, not settlement_records).
  async listByBankLineId(bankLineId: string): Promise<SettlementRecord[]> {
    const { data, error } = await supabase
      .from("settlement_records")
      .select("*")
      .eq("bank_line_id", bankLineId);
    if (error) throw new Error(`settlement_records select failed: ${error.message}`);
    const own = (data ?? []) as SettlementRecord[];

    const payoutId = own.find((r) => r.payout_id)?.payout_id;
    let siblings: SettlementRecord[] = [];
    if (payoutId) {
      const { data: sibData, error: sibErr } = await supabase
        .from("settlement_records")
        .select("*")
        .eq("payout_id", payoutId)
        .neq("bank_line_id", bankLineId);
      if (sibErr) throw new Error(`settlement_records sibling select failed: ${sibErr.message}`);
      siblings = (sibData ?? []) as SettlementRecord[];
    }
    return [...own, ...siblings].sort((a, b) => a.order_number.localeCompare(b.order_number));
  },

  // For the order ledger's row-expand Settlement tracker — a single order
  // has at most one settlement_records row (id is order_uid + bank_line_id,
  // but an order settles via exactly one bank credit in practice).
  async getByOrderUid(orderUid: string): Promise<SettlementRecord | null> {
    const { data, error } = await supabase
      .from("settlement_records")
      .select("*")
      .eq("order_uid", orderUid)
      .order("settlement_date", { ascending: false })
      .limit(1);
    if (error) throw new Error(`settlement_records select failed: ${error.message}`);
    return (data && data[0]) as SettlementRecord | undefined ?? null;
  },
};
