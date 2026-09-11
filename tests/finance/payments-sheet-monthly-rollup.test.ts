import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMonthlyRollup } from "@/lib/finance/payments-sheet-insights";
import type { PaymentSheetRow } from "@/lib/finance/payments-sheet-insights";

function row(overrides: Partial<PaymentSheetRow>): PaymentSheetRow {
  return {
    tab: "smsa", rowNumber: 1, orderNumber: "O1", date: "2026-08-20",
    party: { raw: "tabby", canonical: "Tabby", isSplit: false }, saleType: "Paid", isExchange: false,
    currency: "SAR", region: "KSA", gatewayLabel: "Tabby KSA", actualPaymentStatus: "Payment Received",
    paymentReceivedRaw: "Payment Received on 05.09.2026 (0.00)", paymentReceivedDate: "2026-09-05",
    paymentBatchTotalAed: null,
    amountAed: 1000, cancelledAmount: 0, isDuplicateFlagged: false,
    gatewayGrossAed: null, feeDeductedAed: 0, netAfterFeeAed: null, feePercentRaw: null,
    ...overrides,
  };
}

test("order basis: August owns August's orders; a July order in an August payout is NOT August", () => {
  const rows: PaymentSheetRow[] = [
    // July order, paid out in an early-August payout — belongs to JULY
    row({ orderNumber: "JUL1", date: "2026-07-28", paymentReceivedDate: "2026-08-03",
      gatewayGrossAed: 500, feeDeductedAed: 20, netAfterFeeAed: 480 }),
    // August order, paid out in September — belongs to AUGUST, joins it now
    row({ orderNumber: "AUG1", date: "2026-08-10", paymentReceivedDate: "2026-09-05",
      gatewayGrossAed: 1000, feeDeductedAed: 30, netAfterFeeAed: 970 }),
    // August order, still no payout — AUGUST gross + awaiting, not yet net
    row({ orderNumber: "AUG2", date: "2026-08-25", actualPaymentStatus: "", paymentReceivedDate: null,
      gatewayGrossAed: 400 }),
  ];

  const months = computeMonthlyRollup(rows, { basis: "order" });
  assert.deepEqual(months.map((m) => m.monthKey), ["2026-07", "2026-08"]);

  const jul = months[0];
  assert.equal(jul.grossAed, 500);
  assert.equal(jul.netAed, 480);

  const aug = months[1];
  assert.equal(aug.orderCount, 2);
  assert.equal(aug.grossAed, 1400);      // 1000 + 400
  assert.equal(aug.netAed, 970);          // only the paid one
  assert.equal(aug.awaitingAed, 400);     // AUG2's gross, will become net when its payout lands
  assert.equal(aug.awaitingCount, 1);
  assert.equal(aug.feesAed, 30);
  assert.equal(aug.feePercent, +((30 / 1000) * 100).toFixed(2));
});

test("payment basis: September owns cash that settled in September, split by earlier-month carry-in", () => {
  const rows: PaymentSheetRow[] = [
    row({ orderNumber: "AUG1", date: "2026-08-28", paymentReceivedDate: "2026-09-05",
      gatewayGrossAed: 1000, feeDeductedAed: 40, netAfterFeeAed: 960 }),
    row({ orderNumber: "SEP1", date: "2026-09-02", paymentReceivedDate: "2026-09-05",
      gatewayGrossAed: 2000, feeDeductedAed: 60, netAfterFeeAed: 1940 }),
  ];

  const months = computeMonthlyRollup(rows, { basis: "payment" });
  assert.equal(months.length, 1);
  const sep = months[0];
  assert.equal(sep.monthKey, "2026-09");
  assert.equal(sep.receivedCount, 2);
  assert.equal(sep.netAed, 2900);           // 960 + 1940
  assert.equal(sep.crossMonthInAed, 960);   // the August order's net — cash that belongs to August's sales
  assert.equal(sep.crossMonthInCount, 1);
});

test("payment basis: rows with no readable settlement date are excluded from the month buckets", () => {
  const rows: PaymentSheetRow[] = [
    row({ orderNumber: "OK", paymentReceivedDate: "2026-09-05", amountAed: 100 }),
    row({ orderNumber: "NODATE", paymentReceivedRaw: "Payment Received", paymentReceivedDate: null, amountAed: 999 }),
  ];
  const months = computeMonthlyRollup(rows, { basis: "payment" });
  assert.equal(months.length, 1);
  assert.equal(months[0].receivedCount, 1);
  assert.equal(months[0].receivedAed, 100);
});

test("order basis: the [from,to] window filters on the order date", () => {
  const rows: PaymentSheetRow[] = [
    row({ orderNumber: "A", date: "2026-08-20", gatewayGrossAed: 100 }),
    row({ orderNumber: "S", date: "2026-09-20", gatewayGrossAed: 200 }),
  ];
  const sept = computeMonthlyRollup(rows, { basis: "order", from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(sept.map((m) => [m.monthKey, m.grossAed]), [["2026-09", 200]]);
});
