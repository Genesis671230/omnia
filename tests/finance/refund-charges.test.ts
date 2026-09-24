import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRefundChargeReversalJournal, planRefundLine } from "@/lib/finance/settlement-posting";

// Live refund rows (payout_transactions, is_refund = true).
test("Tabby hands its fee back: credit note for the full 773.72, +36.56 charge reversal", () => {
  assert.deepEqual(planRefundLine({ grossShare: -773.72, netShare: -737.16 }), { refundAmount: 773.72, charge: 36.56 });
});

test("Telr charges extra on a refund: credit note 885.75, −1.05 charge", () => {
  assert.deepEqual(planRefundLine({ grossShare: -885.75, netShare: -886.8 }), { refundAmount: 885.75, charge: -1.05 });
});

test("Tamara / Checkout fee-only line: no credit note, the whole net is a charge", () => {
  assert.deepEqual(planRefundLine({ grossShare: 0, netShare: -67.31 }), { refundAmount: 0, charge: -67.31 });
});

test("Stripe refund with no fee: credit note only", () => {
  assert.deepEqual(planRefundLine({ grossShare: -1843.14, netShare: -1843.14 }), { refundAmount: 1843.14, charge: 0 });
});

test("cross-border shares are scaled to the bank's AED", () => {
  assert.deepEqual(planRefundLine({ grossShare: -100, netShare: -95 }, 0.98), { refundAmount: 98, charge: 4.9 });
});

test("fee handed back: Dr clearing, Cr charges ex-VAT, Cr input VAT — balanced", () => {
  const j = buildRefundChargeReversalJournal({
    amount: 36.56, depositAccountId: "CLR", feeAccountId: "FEES", inputVatAccountId: "IVAT",
    date: "2026-09-14", reference: "FT1/804809/RFC", description: "Tabby fee handed back",
  });
  const dr = j.line_items.filter((l) => l.debit_or_credit === "debit").reduce((s, l) => s + l.amount, 0);
  const cr = j.line_items.filter((l) => l.debit_or_credit === "credit").reduce((s, l) => s + l.amount, 0);
  assert.equal(Math.round(dr * 100), Math.round(cr * 100));
  assert.deepEqual(j.line_items.map((l) => [l.account_id, l.debit_or_credit, l.amount]),
    [["CLR", "debit", 36.56], ["FEES", "credit", 34.82], ["IVAT", "credit", 1.74]]);
});

test("no input VAT account (cross-border payout) → the whole amount credits charges", () => {
  const j = buildRefundChargeReversalJournal({ amount: 36.57, depositAccountId: "CLR", feeAccountId: "FEES", date: "2026-08-03", reference: "r", description: "d" });
  assert.equal(j.line_items.length, 2);
  assert.equal(j.line_items[1].amount, 36.57);
});

import { returnedFeeVat } from "@/lib/finance/settlement-posting";

test("returned fee VAT follows the order's original fee: 804809 fee 59.71 incl. 2.84 VAT → 36.56 returned carries 1.74", () => {
  assert.deepEqual(returnedFeeVat({ returned: 36.56, original: { fee: 59.71, vat: 2.84 }, payoutVatInclusive: false }), { vat: 1.74, basis: "original_fee" });
});

test("original fee booked without VAT → no VAT line, even on an AED payout", () => {
  assert.deepEqual(returnedFeeVat({ returned: 36.57, original: { fee: 40, vat: 0 }, payoutVatInclusive: true }), { vat: 0, basis: "original_fee" });
});

test("no record of the original fee → the payout decides (AED + VAT tax → ÷105×5; else none)", () => {
  assert.deepEqual(returnedFeeVat({ returned: 38.63, original: null, payoutVatInclusive: true }), { vat: 1.84, basis: "payout" });
  assert.deepEqual(returnedFeeVat({ returned: 38.63, original: null, payoutVatInclusive: false }), { vat: 0, basis: "none" });
});

test("journal with explicit VAT: Dr clearing 38.63 / Cr charges 36.79 / Cr Input VAT 1.84 — balanced", () => {
  const j = buildRefundChargeReversalJournal({
    amount: 38.63, vatAmount: 1.84, depositAccountId: "TABBY", feeAccountId: "PGC", inputVatAccountId: "IVAT",
    date: "2026-09-14", reference: "FT26257YSTBJ/803120/RFD", description: "Tabby fee returned on refund",
  });
  assert.deepEqual(j.line_items.map((l) => [l.account_id, l.debit_or_credit, l.amount]),
    [["TABBY", "debit", 38.63], ["PGC", "credit", 36.79], ["IVAT", "credit", 1.84]]);
});

test("VAT 0 → two lines only, nothing to the VAT ledger", () => {
  const j = buildRefundChargeReversalJournal({ amount: 38.63, vatAmount: 0, depositAccountId: "TABBY", feeAccountId: "PGC", inputVatAccountId: "IVAT", date: "d", reference: "r", description: "x" });
  assert.equal(j.line_items.length, 2);
  assert.equal(j.line_items[1].amount, 38.63);
});
