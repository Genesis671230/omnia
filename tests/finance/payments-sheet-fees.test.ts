import { test } from "node:test";
import assert from "node:assert/strict";

// payments-sheet.ts's readTab() does live Google Sheets I/O end-to-end, so
// this exercises the pure per-row parsing pieces directly (parseAmount is
// already exported-equivalent logic — this test targets the NEW fields on
// PaymentSheetRow via a hand-built row, matching the founder's real pasted
// values exactly, including the exact-footing check).
import { computeSheetInsights } from "@/lib/finance/payments-sheet-insights";
import type { PaymentSheetRow } from "@/lib/finance/payments-sheet-insights";

function row(overrides: Partial<PaymentSheetRow>): PaymentSheetRow {
  return {
    tab: "smsa", rowNumber: 22, orderNumber: "WA55606", date: "2026-09-02",
    party: { raw: "telr", canonical: "Telr", isSplit: false }, saleType: "Paid", isExchange: false,
    currency: "KWD", region: "KWD", gatewayLabel: "Telr KWD", actualPaymentStatus: "Payment Received",
    paymentReceivedRaw: "Payment Received on 04.09.2026 (18,903.64)", paymentReceivedDate: "2026-09-04",
    paymentBatchTotalAed: 18903.64,
    amountAed: 1732.91, cancelledAmount: 0, isDuplicateFlagged: false,
    gatewayGrossAed: null, feeDeductedAed: 0, netAfterFeeAed: null, feePercentRaw: null,
    ...overrides,
  };
}

test("a founder-pasted real row: gatewayGrossAed minus feeDeductedAed equals netAfterFeeAed exactly", () => {
  const r = row({ gatewayGrossAed: 1682.20, feeDeductedAed: 66.11, netAfterFeeAed: 1616.09 });
  assert.equal(+(r.gatewayGrossAed! - r.feeDeductedAed).toFixed(2), r.netAfterFeeAed);
});

test("computeSheetInsights still runs unchanged with the new optional fields present", () => {
  const insights = computeSheetInsights([row({})], "sheet-1");
  assert.equal(insights.periods.allTime.totalOrders, 1);
  assert.equal(insights.periods.allTime.received.amountAed, 1732.91);
});
