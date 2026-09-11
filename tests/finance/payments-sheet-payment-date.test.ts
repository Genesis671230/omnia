import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePaymentReceivedNote, computePaymentDateAudit } from "@/lib/finance/payments-sheet-insights";
import type { PaymentSheetRow } from "@/lib/finance/payments-sheet-insights";

test("parsePaymentReceivedNote reads the hand-typed formats ops actually uses", () => {
  assert.equal(parsePaymentReceivedNote("Payment Received on 05.09.2026 (16,122.22)"), "2026-09-05");
  assert.equal(parsePaymentReceivedNote("Payment Received on 5.9.2026"), "2026-09-05");
  assert.equal(parsePaymentReceivedNote("Payment Received on 05/09/2026"), "2026-09-05");
  assert.equal(parsePaymentReceivedNote("Payment Received on 05-09-26"), "2026-09-05");
  assert.equal(parsePaymentReceivedNote("Payment Received on 05-Sep-2026"), "2026-09-05");
  assert.equal(parsePaymentReceivedNote("Payment Received on 5 September 2026"), "2026-09-05");
  assert.equal(parsePaymentReceivedNote("2026-09-05 settled"), "2026-09-05");
  // unambiguous month>12 gets swapped to day-first
  assert.equal(parsePaymentReceivedNote("Payment Received on 2026.09.05"), "2026-09-05");
});

test("parsePaymentReceivedNote returns null when there is no date, not a wrong date", () => {
  assert.equal(parsePaymentReceivedNote("Payment Received"), null);
  assert.equal(parsePaymentReceivedNote("Payment Received (25,794.83)"), null); // parens total is not a date
  assert.equal(parsePaymentReceivedNote(""), null);
  assert.equal(parsePaymentReceivedNote(null), null);
});

function row(overrides: Partial<PaymentSheetRow>): PaymentSheetRow {
  return {
    tab: "smsa", rowNumber: 7, orderNumber: "O1", date: "2026-08-20",
    party: { raw: "tabby", canonical: "Tabby", isSplit: false }, saleType: "Paid", isExchange: false,
    currency: "SAR", region: "KSA", gatewayLabel: "Tabby KSA", actualPaymentStatus: "Payment Received",
    paymentReceivedRaw: "Payment Received on 05.09.2026", paymentReceivedDate: "2026-09-05",
    paymentBatchTotalAed: null,
    amountAed: 1000, cancelledAmount: 0, isDuplicateFlagged: false,
    gatewayGrossAed: null, feeDeductedAed: 0, netAfterFeeAed: null, feePercentRaw: null,
    ...overrides,
  };
}

test("computePaymentDateAudit lists verified payments whose settlement date can't be read", () => {
  const rows: PaymentSheetRow[] = [
    row({ orderNumber: "GOOD", paymentReceivedDate: "2026-09-05" }),
    row({ orderNumber: "BAD1", paymentReceivedRaw: "Payment Received", paymentReceivedDate: null, amountAed: 250 }),
    row({ orderNumber: "BAD2", paymentReceivedRaw: "received", paymentReceivedDate: null, amountAed: 400 }),
    row({ orderNumber: "UNPAID", actualPaymentStatus: "", paymentReceivedDate: null, amountAed: 9999 }),
  ];
  const audit = computePaymentDateAudit(rows);
  assert.equal(audit.count, 2);
  assert.equal(audit.amountAed, 650);
  assert.deepEqual(audit.rows.map((r) => r.orderNumber), ["BAD1", "BAD2"]);
});
