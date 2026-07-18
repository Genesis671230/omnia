import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFinanceStatuses, type OrderSettlementInfo } from "@/lib/orders-finance-status";

function order(overrides: Partial<{ uid: string; order_number: string; gateway: string; payout_status: string }> = {}) {
  return { uid: "UAE_1", order_number: "1001", gateway: "Stripe", payout_status: "awaiting", ...overrides };
}

const settlement = (over: Partial<OrderSettlementInfo> = {}): OrderSettlementInfo => ({
  settlement_id: "UAE_1_STRIPE-po_1",
  evidence_type: "stripe_api",
  evidence_confirmed: true,
  zoho_payment_id: null,
  zoho_published_at: null,
  ...over,
});

test("computeFinanceStatuses: settled order is SETTLED regardless of payout file", () => {
  const [o] = computeFinanceStatuses([order({ payout_status: "settled" })], []);
  assert.equal(o.finance_status, "SETTLED");
  assert.equal(o.in_payout_file, true);
});

test("computeFinanceStatuses: unsettled order whose ref appears in a payout file is AWAITING_BANK", () => {
  const [o] = computeFinanceStatuses([order({ order_number: "1001" })], [{ order_refs: ["1001"] }]);
  assert.equal(o.finance_status, "AWAITING_BANK");
  assert.equal(o.in_payout_file, true);
});

test("computeFinanceStatuses: unsettled order with no ref anywhere is MISSING_PAYOUT", () => {
  const [o] = computeFinanceStatuses([order({ order_number: "9999" })], [{ order_refs: ["1001"] }]);
  assert.equal(o.finance_status, "MISSING_PAYOUT");
  assert.equal(o.in_payout_file, false);
});

test("computeFinanceStatuses: COD gateway is always COD_PENDING, even if seen in a payout file", () => {
  const [o] = computeFinanceStatuses([order({ gateway: "COD", order_number: "1001" })], [{ order_refs: ["1001"] }]);
  assert.equal(o.finance_status, "COD_PENDING");
});

test("computeFinanceStatuses: store-prefix stripping matches a ref like 'WA1001' against order_number '1001'", () => {
  const [o] = computeFinanceStatuses([order({ order_number: "1001" })], [{ order_refs: ["WA1001"] }]);
  assert.equal(o.finance_status, "AWAITING_BANK");
});

test("stripe_api-evidenced settlement makes an unsettled order STRIPE_SETTLED and Zoho-ready", () => {
  const [o] = computeFinanceStatuses([order()], [{ order_refs: ["1001"] }], new Map([["UAE_1", settlement()]]));
  assert.equal(o.finance_status, "STRIPE_SETTLED");
  assert.equal(o.zoho_ready, true);
  assert.equal(o.settlement_id, "UAE_1_STRIPE-po_1");
  assert.equal(o.zoho_payment_id, null);
});

test("bank settlement still wins: payout_status settled stays SETTLED even with stripe evidence", () => {
  const [o] = computeFinanceStatuses(
    [order({ payout_status: "settled" })], [], new Map([["UAE_1", settlement()]]),
  );
  assert.equal(o.finance_status, "SETTLED");
});

test("published settlement exposes zoho_payment_id and is no longer Zoho-ready", () => {
  const [o] = computeFinanceStatuses(
    [order()], [], new Map([["UAE_1", settlement({ zoho_payment_id: "zp_123", zoho_published_at: "2026-07-18T10:00:00Z" })]]),
  );
  assert.equal(o.zoho_payment_id, "zp_123");
  assert.equal(o.zoho_ready, false);
});

test("a mid-flight CLAIMED: publish shows as neither published nor ready", () => {
  const [o] = computeFinanceStatuses(
    [order()], [], new Map([["UAE_1", settlement({ zoho_payment_id: "CLAIMED:abc" })]]),
  );
  assert.equal(o.zoho_payment_id, null);
  assert.equal(o.zoho_ready, false);
});

test("an unconfirmed document settlement changes nothing", () => {
  const [o] = computeFinanceStatuses(
    [order({ order_number: "9999" })], [], new Map([["UAE_1", settlement({ evidence_type: "document", evidence_confirmed: false })]]),
  );
  assert.equal(o.finance_status, "MISSING_PAYOUT");
  assert.equal(o.zoho_ready, false);
});
