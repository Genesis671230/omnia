import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReconLines, isBankFxVariance, isConfirmable, isForceBooked, type ForceBook } from "@/lib/reconciliation/engine";
import { planWireResidual } from "@/lib/finance/settlement-posting";

// The live case: Tabby payout AED 3,120.35, bank credited AED 3,072.44 — a
// AED 47.91 shortfall (1.56%), past the 1% a bank's own cut may be. It sat in
// PAYOUT_VARIANCE with no way to close its invoices until a founder can book it.
const credit = { id: "C1", statement_date: "2026-09-02", description: "TABBY FZ LLC", reference: "FT1", amount: 3072.44, gateway_guess: "Tabby", confidence: "keyword" };
const payout = {
  id: "TABBY-1", gateway: "Tabby", net_amount: 3120.35, gross_amount: 3200, fee_amount: 79.65,
  source: "tabby.csv", status: "uploaded", order_refs: ["5001", "5002"], bank_line_id: "C1",
  original_currency: null, net_original: null, transactions: [],
};
const force: ForceBook = { by: "founder", at: "2026-09-22T10:00:00Z", note: "Tabby deducted a dispute", accountId: "ACC-BANK-FEES", accountName: "Bank Fees and Charges" };

const run = (forceBooks?: Map<string, ForceBook>) =>
  computeReconLines({
    credits: [credit], payouts: [payout] as never, orders: [{ order_number: "5001" }, { order_number: "5002" }],
    confirmations: new Map(), forceBooks,
  })[0];

test("a 1.56% variance is not bookable on its own", () => {
  const l = run();
  assert.equal(l.state, "PAYOUT_VARIANCE");
  assert.equal(l.variance, -47.91);
  assert.equal(isBankFxVariance(l), false);
  assert.equal(isConfirmable(l), false);
  assert.equal(isForceBooked(l), false);
});

test("force-booked, it becomes confirmable and still shows as a variance", () => {
  const l = run(new Map([["C1", force]]));
  assert.equal(l.state, "PAYOUT_VARIANCE"); // the gap is never hidden
  assert.deepEqual(l.forceBook, force);
  assert.equal(isForceBooked(l), true);
  assert.equal(isConfirmable(l), true);
  assert.deepEqual(l.resolvedOrders, ["5001", "5002"]);
});

test("the gap books once as the wire residual — the 47.91, not spread over orders", () => {
  const r = planWireResidual({ crossBorder: false, bankAmount: 3072.44, payoutNet: 3120.35, sharesAtBankRate: false });
  assert.deepEqual(r, { amount: 47.91, needed: true });
});

test("a variance with no matched order cannot be force-booked — there is no invoice to close", () => {
  const l = computeReconLines({
    credits: [credit], payouts: [{ ...payout, order_refs: ["9999"] }] as never, orders: [],
    confirmations: new Map(), forceBooks: new Map([["C1", force]]),
  })[0];
  assert.equal(isForceBooked(l), false);
  assert.equal(isConfirmable(l), false);
});
