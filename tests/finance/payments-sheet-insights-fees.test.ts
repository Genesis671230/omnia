import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGatewayBreakdown, bestWorstGatewayByFeePercent, computeSheetInsights } from "@/lib/finance/payments-sheet-insights";
import type { PaymentSheetRow } from "@/lib/finance/payments-sheet-insights";

function row(overrides: Partial<PaymentSheetRow>): PaymentSheetRow {
  return {
    tab: "smsa", rowNumber: 1, orderNumber: "O1", date: "2026-09-02",
    party: { raw: "telr", canonical: "Telr", isSplit: false }, saleType: "Paid", isExchange: false,
    currency: "AED", region: "UAE", gatewayLabel: "Telr", actualPaymentStatus: "Payment Received",
    paymentReceivedRaw: "", paymentReceivedDate: null,
    amountAed: 1000, cancelledAmount: 0, isDuplicateFlagged: false,
    gatewayGrossAed: null, feeDeductedAed: 0, netAfterFeeAed: null, feePercentRaw: null,
    ...overrides,
  };
}

test("computeSheetInsights: gross falls back to amountAed when gatewayGrossAed is null, net derives when netAfterFeeAed is null", () => {
  const insights = computeSheetInsights([row({ amountAed: 1000, feeDeductedAed: 40 })], "s1");
  // hand-computed: gross = amountAed (no gatewayGrossAed) = 1000; net = 1000 - 40 = 960
  assert.equal(insights.periods.allTime.grossAed, 1000);
  assert.equal(insights.periods.allTime.feesAed, 40);
  assert.equal(insights.periods.allTime.netAed, 960);
});

test("computeSheetInsights: trusts the sheet's own netAfterFeeAed exactly when present, not the derived figure", () => {
  const insights = computeSheetInsights(
    [row({ gatewayGrossAed: 1682.20, feeDeductedAed: 66.11, netAfterFeeAed: 1616.09 })],
    "s1",
  );
  assert.equal(insights.periods.allTime.grossAed, 1682.20);
  assert.equal(insights.periods.allTime.netAed, 1616.09);
});

test("bestWorstGatewayByFeePercent: picks the highest and lowest fee% among gateways with real gross, ignoring zero-gross gateways", () => {
  const breakdown = computeGatewayBreakdown(
    [
      row({ gatewayLabel: "Telr", gatewayGrossAed: 1000, feeDeductedAed: 50 }),   // 5%
      row({ gatewayLabel: "Stripe", gatewayGrossAed: 1000, feeDeductedAed: 25 }), // 2.5%
      row({ gatewayLabel: "COD", gatewayGrossAed: 0, feeDeductedAed: 0, amountAed: 0 }), // zero gross — must be ignored
    ],
    null, null,
  );
  const ranking = bestWorstGatewayByFeePercent(breakdown);
  assert.equal(ranking.worst!.gatewayLabel, "Telr");   // highest fee% = worst for the founder
  assert.equal(ranking.worst!.feePercent, 5);
  assert.equal(ranking.best!.gatewayLabel, "Stripe");  // lowest fee% = best
  assert.equal(ranking.best!.feePercent, 2.5);
});

test("bestWorstGatewayByFeePercent: both null when no gateway has any gross", () => {
  const breakdown = computeGatewayBreakdown([row({ gatewayGrossAed: 0, amountAed: 0 })], null, null);
  const ranking = bestWorstGatewayByFeePercent(breakdown);
  assert.equal(ranking.best, null);
  assert.equal(ranking.worst, null);
});
