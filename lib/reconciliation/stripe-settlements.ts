// Settlement records straight from a PAID Stripe API payout — Stripe itself
// reporting the transfer has gone out to the bank. These rows are born
// evidence-confirmed (evidence_type "stripe_api"), which makes their orders
// "ready to record on Zoho" without waiting for the bank statement upload;
// the later bank credit still reconciles normally, it just won't create a
// second settlement record for the same order (see the dedup below and the
// mirror check in engine.ts).

import type { PayoutTransactionShare } from "@/lib/parsers/payouts";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { SettlementsRepository, type SettlementRecord, type ExistingSettlementRecord } from "@/lib/repositories/settlements.repository";

export type StripeSettlementOrder = {
  uid: string;
  order_number: string;
  store_id: string;
  customer_name: string;
  customer_email: string;
  order_date: string | null;
  gross_aed: number;
};

export type PaidStripePayout = {
  id: string; // "STRIPE-po_…" — the parsed/persisted payout id
  arrivalDate: string | null; // "YYYY-MM-DD"
  transactions: PayoutTransactionShare[];
};

const PREFIX_STORE: Record<string, string> = { WA: "WA", UAE: "UAE", KSA: "KSA", SA: "KSA", WOO: "WOO" };
const PREFIX_RE = /^(WA|UAE|KSA|WOO|SA)(.+)$/i;

// Same prefix handling as the engine's refCandidates(): payout refs may carry
// a store prefix while orders store bare numbers. A prefixed ref also names
// the store, so use it to disambiguate; a bare ref that matches orders in two
// stores is ambiguous and gets skipped — never guess with real money.
function matchOrder(ref: string, byNumber: Map<string, StripeSettlementOrder[]>): StripeSettlementOrder | null {
  const m = PREFIX_RE.exec(ref);
  const store = m ? PREFIX_STORE[m[1].toUpperCase()] : null;
  const numbers = m ? [ref, m[2]] : [ref];
  let candidates = numbers.flatMap((n) => byNumber.get(n) ?? []);
  if (store) candidates = candidates.filter((o) => o.store_id === store);
  return candidates.length === 1 ? candidates[0] : null;
}

export function buildStripeSettlementRows(opts: {
  payoutId: string;
  arrivalDate: string | null;
  transactions: PayoutTransactionShare[];
  orders: StripeSettlementOrder[];
  existing: Pick<ExistingSettlementRecord, "id" | "order_uid" | "zoho_payment_id" | "zoho_published_at">[];
}): Omit<SettlementRecord, "recorded_at">[] {
  const { payoutId, arrivalDate, transactions, orders, existing } = opts;

  const refunded = new Set(transactions.filter((t) => t.isRefund).map((t) => t.ref));
  const refs = [...new Set(transactions.map((t) => t.ref))].filter((r) => !refunded.has(r));

  const byNumber = new Map<string, StripeSettlementOrder[]>();
  for (const o of orders) {
    const list = byNumber.get(o.order_number) ?? [];
    list.push(o);
    byNumber.set(o.order_number, list);
  }

  const foreignRecordUids = new Set<string>();
  const existingById = new Map(existing.map((e) => [e.id, e]));
  for (const e of existing) {
    if (e.id !== `${e.order_uid}_${payoutId}`) foreignRecordUids.add(e.order_uid);
  }

  const confirmedAt = new Date().toISOString();
  const rows: Omit<SettlementRecord, "recorded_at">[] = [];
  const seenUids = new Set<string>();
  for (const ref of refs) {
    const order = matchOrder(ref, byNumber);
    if (!order || seenUids.has(order.uid) || foreignRecordUids.has(order.uid)) continue;
    seenUids.add(order.uid);
    const id = `${order.uid}_${payoutId}`;
    // Evidence fields are always re-asserted true/stripe_api here — that's
    // this row's whole point, so no data loss there. But a later Zoho
    // publish sets zoho_payment_id on this same id, and this function reruns
    // on every payout-sync poll: without carrying it forward, the next poll
    // would silently wipe a real payment_id back to null, making the row
    // look unpublished and risking a duplicate Zoho Customer Payment.
    const prior = existingById.get(id);
    rows.push({
      id,
      order_uid: order.uid,
      order_number: order.order_number,
      store_id: order.store_id,
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      order_date: order.order_date,
      settlement_date: arrivalDate,
      gateway: "Stripe",
      currency: "AED",
      gross_aed: Number(order.gross_aed || 0),
      bank_line_id: `STRIPE-API:${payoutId.replace(/^STRIPE-/, "")}`,
      payout_id: payoutId,
      bank_reference: payoutId.replace(/^STRIPE-/, ""),
      evidence_type: "stripe_api",
      evidence_confirmed: true,
      evidence_confirmed_by: "stripe-api",
      evidence_confirmed_at: confirmedAt,
      evidence_document_id: null,
      zoho_payment_id: prior?.zoho_payment_id ?? null,
      zoho_published_at: prior?.zoho_published_at ?? null,
    });
  }
  return rows;
}

// IO wrapper used by the payout sync: resolve refs → orders, dedup against
// existing settlement records, upsert. Returns how many records were written.
export async function persistStripeApiSettlements(paid: PaidStripePayout[]): Promise<number> {
  if (paid.length === 0) return 0;

  const numbers = new Set<string>();
  for (const p of paid) {
    for (const t of p.transactions) {
      numbers.add(t.ref);
      const m = PREFIX_RE.exec(t.ref);
      if (m) numbers.add(m[2]);
    }
  }
  if (numbers.size === 0) return 0;

  const orders = await OrdersRepository.getByOrderNumbers([...numbers]);
  if (orders.length === 0) return 0;
  const existing = await SettlementsRepository.listExistingByOrderUids(orders.map((o) => o.uid));

  const rows = paid.flatMap((p) =>
    buildStripeSettlementRows({
      payoutId: p.id,
      arrivalDate: p.arrivalDate,
      transactions: p.transactions,
      orders,
      existing,
    }),
  );
  if (rows.length > 0) await SettlementsRepository.upsertMany(rows);
  return rows.length;
}
