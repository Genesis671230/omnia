// The audit trail: one immutable row per order the moment its bank credit is
// confirmed SETTLED. This is what a founder points an accountant — or Zoho
// Books — at, independent of whatever the live orders/payouts tables say
// later. Written by the reconciliation engine, never by hand.

import { supabase } from "@/lib/supabase";

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
  currency: string;
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
};

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
          "id, order_uid, evidence_type, evidence_confirmed, evidence_confirmed_by, evidence_confirmed_at, evidence_document_id, zoho_payment_id, zoho_published_at",
        )
        .in("order_uid", orderUids.slice(i, i + 200));
      if (error) throw new Error(`settlement_records existing select failed: ${error.message}`);
      out.push(...(data ?? []));
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
