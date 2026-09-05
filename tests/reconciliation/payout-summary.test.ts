import { test } from "node:test";
import assert from "node:assert/strict";
import { computePayoutSummary } from "@/lib/reconciliation/payout-summary";

test("computePayoutSummary: sums gross/fees/refunds from transactions, net from payouts, awaiting from bank amount", () => {
  const totals = computePayoutSummary([
    {
      state: "SETTLED", bankAmount: 190,
      payout: { net: 190 },
      transactions: [
        { grossShare: 200, feeShare: 10, netShare: 190, isRefund: false },
      ],
    },
    {
      state: "SETTLED", bankAmount: 45,
      payout: { net: 45 },
      transactions: [
        { grossShare: 50, feeShare: 5, netShare: -45, isRefund: true },
      ],
    },
    {
      state: "AWAITING_PAYOUT", bankAmount: 300,
      payout: null,
      transactions: [],
    },
  ]);

  // hand-computed: gross = 200 + 50 = 250; net = 190 + 45 = 235;
  // fees = 10 + 5 = 15; refunds = |-45| = 45; awaiting = 300
  assert.equal(totals.grossAed, 250);
  assert.equal(totals.netAed, 235);
  assert.equal(totals.feesAed, 15);
  assert.equal(totals.refundsAed, 45);
  assert.equal(totals.awaitingAed, 300);
});

test("computePayoutSummary: empty input is all zeros, not NaN or undefined", () => {
  const totals = computePayoutSummary([]);
  assert.deepEqual(totals, { grossAed: 0, netAed: 0, awaitingAed: 0, feesAed: 0, refundsAed: 0 });
});
