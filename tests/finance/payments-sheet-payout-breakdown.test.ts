import { test } from "node:test";
import assert from "node:assert/strict";
import { computePayoutBreakdown, parsePaymentBatchTotal } from "@/lib/finance/payments-sheet-insights";
import type { PaymentSheetRow } from "@/lib/finance/payments-sheet-insights";

function row(overrides: Partial<PaymentSheetRow>): PaymentSheetRow {
  return {
    tab: "smsa", rowNumber: 1, orderNumber: "O1", date: "2026-09-02",
    party: { raw: "tabby", canonical: "Tabby", isSplit: false }, saleType: "Paid", isExchange: false,
    currency: "SAR", region: "KSA", gatewayLabel: "Tabby KSA", actualPaymentStatus: "Payment Received",
    paymentReceivedRaw: "Payment Received on 05.09.2026 (25,794.83)", paymentReceivedDate: "2026-09-05",
    paymentBatchTotalAed: 25794.83,
    amountAed: 1000, cancelledAmount: 0, isDuplicateFlagged: false,
    gatewayGrossAed: null, feeDeductedAed: 0, netAfterFeeAed: null, feePercentRaw: null,
    ...overrides,
  };
}

test("parsePaymentBatchTotal pulls the parenthesised payout total out of the note", () => {
  assert.equal(parsePaymentBatchTotal("Payment Received on 05.09.2026 (25,794.83)"), 25794.83);
  assert.equal(parsePaymentBatchTotal("Payment Received on 03.08.2026 ( 1,616.09 )"), 1616.09);
  assert.equal(parsePaymentBatchTotal("Payment Received on 03.08.2026"), null);
  assert.equal(parsePaymentBatchTotal(""), null);
  assert.equal(parsePaymentBatchTotal(null), null);
});

test("computePayoutBreakdown splits one Tabby batch across the order-months it contains", () => {
  const rows: PaymentSheetRow[] = [
    // Same settlement batch (identical Payment Received note) — 2 Aug orders + 1 Sep order.
    row({ orderNumber: "A1", date: "2026-08-20", amountAed: 6000 }),
    row({ orderNumber: "A2", date: "2026-08-28", amountAed: 3220.10 }),
    row({ orderNumber: "S1", date: "2026-09-01", amountAed: 16574.73 }),
  ];

  const groups = computePayoutBreakdown(rows, null, null);
  assert.equal(groups.length, 1);

  const g = groups[0];
  assert.equal(g.gatewayLabel, "Tabby KSA");
  assert.equal(g.settlementDate, "2026-09-05");
  assert.equal(g.declaredTotalAed, 25794.83);
  assert.equal(g.orderCount, 3);
  // matched = 6000 + 3220.10 + 16574.73 = 25794.83, foots exactly to the declared total
  assert.equal(g.matchedTotalAed, 25794.83);
  assert.equal(g.varianceAed, 0);

  assert.deepEqual(
    g.byOrderMonth.map((m) => [m.monthKey, m.amountAed, m.orderCount]),
    [
      ["2026-08", 9220.10, 2],
      ["2026-09", 16574.73, 1],
    ],
  );
});

test("computePayoutBreakdown: separate batches (different notes) stay separate; windowed on the payout date", () => {
  const rows: PaymentSheetRow[] = [
    row({ orderNumber: "A1", date: "2026-08-20", amountAed: 500,
      paymentReceivedRaw: "Payment Received on 28.08.2026 (500.00)", paymentReceivedDate: "2026-08-28", paymentBatchTotalAed: 500 }),
    row({ orderNumber: "S1", date: "2026-09-01", amountAed: 900 }), // the default 05.09 batch
  ];

  // Window to September payouts only — the August settlement drops out.
  const sept = computePayoutBreakdown(rows, "2026-09-01", "2026-09-30");
  assert.equal(sept.length, 1);
  assert.equal(sept[0].settlementDate, "2026-09-05");
  assert.equal(sept[0].matchedTotalAed, 900);

  const all = computePayoutBreakdown(rows, null, null);
  assert.equal(all.length, 2);
  // newest settlement first
  assert.deepEqual(all.map((g) => g.settlementDate), ["2026-09-05", "2026-08-28"]);
});

test("computePayoutBreakdown ignores rows with no confirmed payment date", () => {
  const rows: PaymentSheetRow[] = [
    row({ orderNumber: "P1", actualPaymentStatus: "", paymentReceivedRaw: "", paymentReceivedDate: null, paymentBatchTotalAed: null }),
    row({ orderNumber: "S1", amountAed: 1200 }),
  ];
  const groups = computePayoutBreakdown(rows, null, null);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].orderCount, 1);
  assert.equal(groups[0].matchedTotalAed, 1200);
});

test("computePayoutBreakdown: variance is null when the batch total wasn't recorded", () => {
  const rows: PaymentSheetRow[] = [
    row({ orderNumber: "S1", amountAed: 1200,
      paymentReceivedRaw: "Payment Received on 05.09.2026", paymentBatchTotalAed: null }),
  ];
  const groups = computePayoutBreakdown(rows, null, null);
  assert.equal(groups[0].declaredTotalAed, null);
  assert.equal(groups[0].varianceAed, null);
});
