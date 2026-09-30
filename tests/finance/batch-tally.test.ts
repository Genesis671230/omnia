import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBatchTally } from "@/lib/finance/batch-tally";
import type { ReconLine, ReconTransactionShare } from "@/lib/reconciliation/engine";
import type { SettlementRecord } from "@/lib/repositories/settlements.repository";

const share = (ref: string, gross: number, fee: number, extra: Partial<ReconTransactionShare> = {}): ReconTransactionShare => ({
  ref, orderNumber: ref, grossShare: gross, feeShare: fee, netShare: +(gross - fee).toFixed(2), isRefund: false, quality: "clean",
  netOriginal: null, grossOriginal: null, feeOriginal: null, ...extra,
});
const line = (bank: number, net: number, transactions: ReconTransactionShare[], deliveryCharges: { ref: string; amount: number }[] = []) => ({
  id: "B", date: "2026-09-23", narration: "", reference: "FT1", provider: "COD", confidence: "keyword", bankAmount: bank,
  payout: { id: "P", net, source: null, currency: null, fxRate: null, fxSource: null,
    deliveryCharges: deliveryCharges.map((c) => ({ ...c, exVat: 0, vat: 0, isReturn: false, voucherNo: "1", status: "" })) },
  transactions, confirmedBy: "founder",
}) as unknown as ReconLine;
const rec = (order: string, extra: Partial<SettlementRecord>) => ({ order_number: order, ...extra }) as SettlementRecord;

// CP17192 shape: 2 of 3 COD orders booked, 1,165 courier charges pending,
// and the bank credited 2.50 less than the voucher.
test("COD voucher: booked, pending by kind, and the unexplained bank gap", () => {
  const t = buildBatchTally({
    line: line(544, 546.5, [share("OS3746", 849, 30), share("WA55811", 922.5, 30), share("OS3728", 30, 30)], [{ ref: "OS3757", amount: 1165 }]),
    settlements: [
      rec("OS3746", { zoho_payment_id: "1", zoho_invoice_number: "INV-005181", zoho_invoice_total: 849 }),
      rec("WA55811", { force_payment_id: "2", zoho_invoice_number: "INV-005180", zoho_invoice_total: 922.5 }),
      rec("OS3728", { zoho_post_error: "No Zoho invoice found" }),
    ],
    refunds: [], deliveryDocsBooked: 0, deliveryFullyBooked: false,
  });
  assert.equal(t.bookedAed, 1711.5);
  assert.deepEqual(t.pending, { orders: 0, refunds: 0, deliveryCharges: 1165 });
  assert.equal(t.unexplainedAed, -2.5);
  assert.equal(t.bankGap, -2.5);
  assert.equal(t.counts.ordersBooked, 2);
  assert.equal(t.counts.ordersWithError, 1);
});

test("a PENDING write is not booked; a gap over AED 1 needs a decision", () => {
  const t = buildBatchTally({
    line: line(1000, 1000, [share("WA1", 1050, 50)]),
    settlements: [rec("WA1", { zoho_payment_id: "PENDING:x", zoho_invoice_number: "MNS-1", zoho_invoice_total: 1090 })],
    refunds: [], deliveryDocsBooked: 0, deliveryFullyBooked: true,
  });
  assert.equal(t.orders[0].paymentBooked, false);
  assert.equal(t.orders[0].invoiceGap, 40);
  assert.equal(t.needsDecisionAed, 1000);
  assert.equal(t.unexplainedAed, 0);
});

test("fully booked batch leaves nothing pending or unexplained", () => {
  const t = buildBatchTally({
    line: line(819, 819, [share("OS1", 849, 30)]),
    settlements: [rec("OS1", { zoho_payment_id: "9", zoho_fee_expense_id: "10", zoho_invoice_number: "INV-1", zoho_invoice_total: 849 })],
    refunds: [], deliveryDocsBooked: 0, deliveryFullyBooked: true,
  });
  assert.equal(t.pendingAed, 0);
  assert.equal(t.unexplainedAed, 0);
});
