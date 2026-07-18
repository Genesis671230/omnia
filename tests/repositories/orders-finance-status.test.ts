import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFinanceStatuses } from "@/lib/orders-finance-status";

function order(overrides: Partial<{ order_number: string; gateway: string; payout_status: string }> = {}) {
  return { order_number: "1001", gateway: "Stripe", payout_status: "awaiting", ...overrides };
}

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
