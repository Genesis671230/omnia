import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMonthlyReconciliation } from "@/lib/finance/payments-sheet-insights";
import type { PaymentSheetRow } from "@/lib/finance/payments-sheet-insights";

function row(overrides: Partial<PaymentSheetRow>): PaymentSheetRow {
  return {
    tab: "smsa", rowNumber: 1, orderNumber: "O1", date: "2026-08-15",
    party: { raw: "tabby", canonical: "Tabby", isSplit: false }, saleType: "Paid", isExchange: false,
    currency: "SAR", region: "KSA", gatewayLabel: "Tabby KSA", actualPaymentStatus: "Payment Received",
    paymentReceivedRaw: "Payment Received on 20.08.2026 (0.00)", paymentReceivedDate: "2026-08-20",
    paymentBatchTotalAed: null,
    amountAed: 1000, cancelledAmount: 0, isDuplicateFlagged: false,
    gatewayGrossAed: null, feeDeductedAed: 0, netAfterFeeAed: null, feePercentRaw: null,
    ...overrides,
  };
}

// The founder's own August 2026 scenario, scaled to the exact figures given.
test("August close: dispatched, settled-later, carried-in, and cash-received all foot", () => {
  const rows: PaymentSheetRow[] = [
    // August International orders settled WITHIN August
    row({ tab: "smsa", orderNumber: "SA-IN", date: "2026-08-05", paymentReceivedDate: "2026-08-25",
      amountAed: 619859.75 - 143099.08 }),
    // August International orders settled in SEPTEMBER
    row({ tab: "smsa", orderNumber: "SA-LATE", date: "2026-08-28", paymentReceivedDate: "2026-09-05",
      amountAed: 143099.08 }),
    // August Local orders settled WITHIN August
    row({ tab: "local", orderNumber: "AE-IN", date: "2026-08-06", paymentReceivedDate: "2026-08-26",
      amountAed: 789694.83 - 133239.97 }),
    // August Local orders settled in SEPTEMBER
    row({ tab: "local", orderNumber: "AE-LATE", date: "2026-08-29", paymentReceivedDate: "2026-09-06",
      amountAed: 133239.97 }),
    // July International order settled in AUGUST — carried into August's cash
    row({ tab: "smsa", orderNumber: "SA-JUL", date: "2026-07-30", paymentReceivedDate: "2026-08-10",
      amountAed: 50000, feeDeductedAed: 1500, gatewayGrossAed: 50000, netAfterFeeAed: 48500 }),
  ];

  const months = computeMonthlyReconciliation(rows);
  const aug = months.find((m) => m.monthKey === "2026-08")!;

  // Dispatched = every order PLACED in August, split Intl / Local
  assert.equal(aug.dispatched.intlAed, 619859.75);
  assert.equal(aug.dispatched.localAed, 789694.83);
  assert.equal(aug.dispatched.totalAed, 1409554.58);

  // August sales whose payment was received in September (the subtraction line)
  assert.equal(aug.settledLater.intlAed, 143099.08);
  assert.equal(aug.settledLater.localAed, 133239.97);
  assert.equal(aug.settledLater.totalAed, 276339.05);
  assert.equal(aug.settledLater.byMonth[0].monthKey, "2026-09");
  assert.equal(aug.settledLater.byMonth[0].totalAed, 276339.05);

  // Dispatched − settled-later − awaiting = settled within August
  assert.equal(aug.awaiting.totalAed, 0);
  assert.equal(aug.settledWithin.totalAed, 1409554.58 - 276339.05); // 1,133,215.53

  // Cash that actually LANDED in August = August's own (settled within) + July carried in
  assert.equal(aug.carriedIn.totalAed, 50000);
  assert.equal(aug.carriedIn.byMonth[0].monthKey, "2026-07");
  assert.equal(aug.carriedIn.byMonth[0].intlAed, 50000);
  assert.equal(aug.cashReceived.totalAed, +(1133215.53 + 50000).toFixed(2));
  assert.equal(aug.cashReceivedFeesAed, 1500);
  assert.equal(aug.cashReceivedNetAed, +(1133215.53 + 48500).toFixed(2));

  // September owns the 276,339.05 of August sales it collected
  const sep = months.find((m) => m.monthKey === "2026-09")!;
  assert.equal(sep.cashReceived.totalAed, 276339.05);
  assert.equal(sep.carriedIn.totalAed, 276339.05); // all of it is earlier-month (August) orders
  assert.equal(sep.dispatched.totalAed, 0); // no orders were PLACED in September in this fixture
});

test("window filters the statement months but keeps the cross-month detail", () => {
  const rows: PaymentSheetRow[] = [
    row({ date: "2026-07-30", paymentReceivedDate: "2026-08-10", amountAed: 100 }),
    row({ date: "2026-08-30", paymentReceivedDate: "2026-09-10", amountAed: 200 }),
  ];
  const augOnly = computeMonthlyReconciliation(rows, { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(augOnly.map((m) => m.monthKey), ["2026-08"]);
  assert.equal(augOnly[0].carriedIn.byMonth[0].monthKey, "2026-07"); // July detail still shown
  assert.equal(augOnly[0].settledLater.byMonth[0].monthKey, "2026-09");
});

test("received row with an unreadable settlement date is isolated, not misfiled", () => {
  const rows: PaymentSheetRow[] = [
    row({ date: "2026-08-10", paymentReceivedRaw: "Payment Received", paymentReceivedDate: null, amountAed: 750 }),
  ];
  const aug = computeMonthlyReconciliation(rows).find((m) => m.monthKey === "2026-08")!;
  assert.equal(aug.dispatched.totalAed, 750);
  assert.equal(aug.unreadableSettlement.totalAed, 750);
  assert.equal(aug.settledWithin.totalAed, 0);
  assert.equal(aug.awaiting.totalAed, 0);
  assert.equal(aug.cashReceived.totalAed, 0);
});
