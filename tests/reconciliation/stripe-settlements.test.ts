import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStripeSettlementRows, type StripeSettlementOrder } from "@/lib/reconciliation/stripe-settlements";
import type { PayoutTransactionShare } from "@/lib/parsers/payouts";

const order = (over: Partial<StripeSettlementOrder>): StripeSettlementOrder => ({
  uid: "UAE_1",
  order_number: "3347",
  store_id: "UAE",
  customer_name: "mohammad alshamsi",
  customer_email: "m@example.com",
  order_date: "2026-07-10T09:00:00Z",
  gross_aed: 199,
  ...over,
});

const tx = (ref: string, over: Partial<PayoutTransactionShare> = {}): PayoutTransactionShare => ({
  ref, netShare: 190, grossShare: 199, feeShare: 9, isRefund: false, quality: "clean", ...over,
});

test("builds an evidence-confirmed settlement row from a paid Stripe payout", () => {
  const rows = buildStripeSettlementRows({
    payoutId: "STRIPE-po_1",
    arrivalDate: "2026-07-15",
    transactions: [tx("3347")],
    orders: [order({})],
    existing: [],
  });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.id, "UAE_1_STRIPE-po_1");
  assert.equal(r.order_uid, "UAE_1");
  assert.equal(r.settlement_date, "2026-07-15");
  assert.equal(r.gateway, "Stripe");
  assert.equal(r.gross_aed, 199);
  assert.equal(r.bank_line_id, "STRIPE-API:po_1");
  assert.equal(r.payout_id, "STRIPE-po_1");
  assert.equal(r.evidence_type, "stripe_api");
  assert.equal(r.evidence_confirmed, true);
  assert.equal(r.evidence_confirmed_by, "stripe-api");
  assert.equal(r.zoho_payment_id, null);
});

test("a refund transaction disqualifies its ref entirely", () => {
  const rows = buildStripeSettlementRows({
    payoutId: "STRIPE-po_1",
    arrivalDate: "2026-07-15",
    transactions: [tx("3347"), tx("3347", { isRefund: true, netShare: -190 })],
    orders: [order({})],
    existing: [],
  });
  assert.equal(rows.length, 0);
});

test("store-prefixed ref picks the right store's order", () => {
  const rows = buildStripeSettlementRows({
    payoutId: "STRIPE-po_2",
    arrivalDate: null,
    transactions: [tx("UAE3347")],
    orders: [order({ uid: "UAE_1", store_id: "UAE" }), order({ uid: "KSA_9", store_id: "KSA" })],
    existing: [],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].order_uid, "UAE_1");
});

test("bare ref matching orders in two stores is ambiguous — skipped", () => {
  const rows = buildStripeSettlementRows({
    payoutId: "STRIPE-po_2",
    arrivalDate: null,
    transactions: [tx("3347")],
    orders: [order({ uid: "UAE_1", store_id: "UAE" }), order({ uid: "KSA_9", store_id: "KSA" })],
    existing: [],
  });
  assert.equal(rows.length, 0);
});

test("order with an existing settlement record under a different id is skipped", () => {
  const rows = buildStripeSettlementRows({
    payoutId: "STRIPE-po_3",
    arrivalDate: null,
    transactions: [tx("3347")],
    orders: [order({})],
    existing: [{ id: "UAE_1_bank-line-77", order_uid: "UAE_1" }],
  });
  assert.equal(rows.length, 0);
});

test("re-running the same payout is idempotent — same-id existing record is kept", () => {
  const rows = buildStripeSettlementRows({
    payoutId: "STRIPE-po_3",
    arrivalDate: null,
    transactions: [tx("3347")],
    orders: [order({})],
    existing: [{ id: "UAE_1_STRIPE-po_3", order_uid: "UAE_1" }],
  });
  assert.equal(rows.length, 1);
});
