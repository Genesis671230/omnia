import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bankScaleFor,
  buildCreditNoteRefundBody,
  buildRefundCreditNoteBody,
  pickInvoiceForRefund,
  refundReferences,
  buildDifferenceJournalBody,
  buildFeeExpenseBody,
  isCrossBorderCurrency,
  pickInvoiceForOrder,
  planOrderPosting,
  postingReferences,
  suggestPostingAccounts,
  vatInclusiveSplit,
} from "@/lib/finance/settlement-posting";

const ACCOUNTS = {
  depositAccountId: "TABBY_AED",
  feeAccountId: "GATEWAY_CHARGES",
  vatTaxId: "VAT5",
  differenceAccountId: "FX_GAIN_LOSS",
};

test("vatInclusiveSplit: fee ÷ 105 × 5 is the VAT, the rest is the charge", () => {
  // Tabby order 804928: total deduction 94.11
  assert.deepEqual(vatInclusiveSplit(94.11), { vat: 4.48, net: 89.63 });
  assert.deepEqual(vatInclusiveSplit(105), { vat: 5, net: 100 });
});

test("isCrossBorderCurrency: only non-AED currencies cross a border", () => {
  assert.equal(isCrossBorderCurrency("SAR"), true);
  assert.equal(isCrossBorderCurrency("kwd"), true);
  assert.equal(isCrossBorderCurrency("AED"), false);
  assert.equal(isCrossBorderCurrency(null), false);
});

test("bankScaleFor: AED payouts are never rescaled; cross-border scales to what the bank credited", () => {
  assert.equal(bankScaleFor({ crossBorder: false, bankAmount: 100, payoutNet: 101 }), 1);
  assert.equal(
    bankScaleFor({ crossBorder: true, bankAmount: 28036.36, payoutNet: 28492.32 }),
    28036.36 / 28492.32,
  );
  assert.equal(bankScaleFor({ crossBorder: true, bankAmount: 28036.36, payoutNet: 0 }), 1);
});

test("planOrderPosting: AED Tabby order closes the invoice in full and splits VAT out of the fee", () => {
  const plan = planOrderPosting({
    invoiceBalance: 1363.5, grossAed: 1363.5, feeAed: 94.11, netAed: 1269.39,
    bankScale: 1, crossBorder: false, feeVatInclusive: true,
  });
  assert.equal(plan.paymentAmount, 1363.5);
  assert.equal(plan.fee, 94.11);
  assert.equal(plan.feeVat, 4.48);
  assert.equal(plan.feeExVat, 89.63);
  assert.equal(plan.netReceived, 1269.39);
  assert.equal(plan.difference, 0);
  assert.equal(plan.differenceKind, "none");
  assert.equal(plan.review, null);
});

test("planOrderPosting: SAR order books fee without VAT at the bank's rate and the rest as FX", () => {
  // Real Tabby KSA payout: estimate net 28,492.32, bank credited 28,036.36.
  const plan = planOrderPosting({
    invoiceBalance: 1490.93, grossAed: 1458.19, feeAed: 95.75, netAed: 1362.45,
    bankScale: 28036.36 / 28492.32, crossBorder: true, feeVatInclusive: true,
  });
  assert.equal(plan.fee, 94.22);
  assert.equal(plan.feeVat, 0, "cross-border fees carry no UAE VAT even if a tax was picked");
  assert.equal(plan.netReceived, 1340.65);
  assert.equal(plan.difference, 56.06);
  assert.equal(plan.differenceKind, "fx");
  assert.equal(plan.review, null);
  // payment − fee − fx = exactly what landed
  assert.equal(+(plan.paymentAmount - plan.fee - plan.difference).toFixed(2), plan.netReceived);
});

test("planOrderPosting: an FX gain (received more than the invoice) is a negative difference", () => {
  const plan = planOrderPosting({
    invoiceBalance: 900, grossAed: 950, feeAed: 50, netAed: 900,
    bankScale: 1, crossBorder: true, feeVatInclusive: false,
  });
  assert.equal(plan.difference, -50);
  assert.equal(plan.differenceKind, "fx");
});

test("planOrderPosting: AED sub-dirham gap is rounding; a real gap is held for review", () => {
  const rounding = planOrderPosting({
    invoiceBalance: 100.5, grossAed: 100, feeAed: 5, netAed: 95,
    bankScale: 1, crossBorder: false, feeVatInclusive: true,
  });
  assert.equal(rounding.differenceKind, "rounding");
  assert.equal(rounding.review, null);

  const gap = planOrderPosting({
    invoiceBalance: 130, grossAed: 100, feeAed: 5, netAed: 95,
    bankScale: 1, crossBorder: false, feeVatInclusive: true,
  });
  assert.match(gap.review ?? "", /doesn't match/);
});

test("planOrderPosting: implausible FX difference and paid invoices are held for review", () => {
  const wild = planOrderPosting({
    invoiceBalance: 2000, grossAed: 1000, feeAed: 50, netAed: 950,
    bankScale: 1, crossBorder: true, feeVatInclusive: false,
  });
  assert.match(wild.review ?? "", /wrong invoice/);

  const paid = planOrderPosting({
    invoiceBalance: 0, grossAed: 1000, feeAed: 50, netAed: 950,
    bankScale: 1, crossBorder: false, feeVatInclusive: true,
  });
  assert.match(paid.review ?? "", /no balance/);
});

test("buildFeeExpenseBody: VAT-inclusive with tax id on AED, plain on cross-border", () => {
  const aed = planOrderPosting({
    invoiceBalance: 1363.5, grossAed: 1363.5, feeAed: 94.11, netAed: 1269.39,
    bankScale: 1, crossBorder: false, feeVatInclusive: true,
  });
  const body = buildFeeExpenseBody({ plan: aed, accounts: ACCOUNTS, date: "2026-09-10", reference: "R/1/FEE", description: "x" });
  assert.equal(body.account_id, "GATEWAY_CHARGES");
  assert.equal(body.paid_through_account_id, "TABBY_AED");
  assert.equal(body.amount, 94.11);
  assert.equal(body.is_inclusive_tax, true);
  assert.equal(body.tax_id, "VAT5");

  const sar = planOrderPosting({
    invoiceBalance: 1490.93, grossAed: 1458.19, feeAed: 95.75, netAed: 1362.45,
    bankScale: 28036.36 / 28492.32, crossBorder: true, feeVatInclusive: true,
  });
  const plain = buildFeeExpenseBody({ plan: sar, accounts: ACCOUNTS, date: "2026-07-11", reference: "R/2/FEE", description: "x" });
  assert.equal(plain.is_inclusive_tax, false);
  assert.equal("tax_id" in plain, false);
});

test("buildDifferenceJournalBody: loss debits FX and credits clearing; gain is the reverse", () => {
  const base = { accounts: ACCOUNTS, date: "2026-07-11", reference: "R/FX", description: "fx" };
  const loss = buildDifferenceJournalBody({ ...base, plan: { difference: 56.06 } as never });
  assert.deepEqual(
    loss.line_items.map((l) => [l.account_id, l.debit_or_credit, l.amount]),
    [["FX_GAIN_LOSS", "debit", 56.06], ["TABBY_AED", "credit", 56.06]],
  );
  const gain = buildDifferenceJournalBody({ ...base, plan: { difference: -50 } as never });
  assert.deepEqual(
    gain.line_items.map((l) => [l.account_id, l.debit_or_credit, l.amount]),
    [["TABBY_AED", "debit", 50], ["FX_GAIN_LOSS", "credit", 50]],
  );
});

test("postingReferences: stable and distinct per order and document", () => {
  const r = postingReferences("FT262509ZBLR", "804928");
  assert.deepEqual(r, { payment: "FT262509ZBLR", fee: "FT262509ZBLR/804928/FEE", difference: "FT262509ZBLR/804928/FX" });
});

// Names copied from the live Zoho org's chart of accounts.
const LIVE_OPTIONS = {
  depositAccounts: [
    { account_id: "SIB", account_name: "Sharjah Islamic Bank - 12043598001" },
    { account_id: "T_AED", account_name: "TABBY AED" },
    { account_id: "T_KSA", account_name: "TABBY KSA" },
    { account_id: "T_KWD", account_name: "TABBY KWD" },
    { account_id: "T_QTR", account_name: "TABBY QTR" },
    { account_id: "TM", account_name: "TAMARA" },
    { account_id: "TM_KSA", account_name: "TAMARA KSA" },
    { account_id: "CO_SAR", account_name: "Checkout - SAR" },
    { account_id: "CO_AED", account_name: "Checkout - AED" },
  ],
  feeAccounts: [
    { account_id: "BANKFEE", account_name: "Bank Fees and Charges" },
    { account_id: "PGC", account_name: "Payment Gateway Charges" },
  ],
  differenceAccounts: [
    { account_id: "FX_PURCHASE", account_name: "Exchange gain or loss (purchase)" },
    { account_id: "FX", account_name: "Exchange Gain or Loss" },
  ],
  taxes: [
    { tax_id: "KSA5", tax_name: "KSA 5% Tax", tax_percentage: 5 },
    { tax_id: "STD5", tax_name: "Standard Rate 5%", tax_percentage: 5 },
    { tax_id: "VAT5", tax_name: "VAT 5%", tax_percentage: 5 },
  ],
};

test("suggestPostingAccounts: picks the gateway's clearing account for the payout currency", () => {
  const aed = suggestPostingAccounts({ provider: "Tabby", currency: null }, LIVE_OPTIONS);
  assert.deepEqual(aed, { depositAccountId: "T_AED", feeAccountId: "PGC", differenceAccountId: "FX", vatTaxId: "STD5" });

  const sar = suggestPostingAccounts({ provider: "Tabby", currency: "SAR" }, LIVE_OPTIONS);
  assert.equal(sar.depositAccountId, "T_KSA");
  assert.equal(sar.vatTaxId, "", "no VAT default on a cross-border payout");

  assert.equal(suggestPostingAccounts({ provider: "Tabby", currency: "KWD" }, LIVE_OPTIONS).depositAccountId, "T_KWD");
  assert.equal(suggestPostingAccounts({ provider: "Tamara", currency: "AED" }, LIVE_OPTIONS).depositAccountId, "TM");
  assert.equal(suggestPostingAccounts({ provider: "Tamara", currency: "SAR" }, LIVE_OPTIONS).depositAccountId, "TM_KSA");
  assert.equal(suggestPostingAccounts({ provider: "Checkout", currency: "SAR" }, LIVE_OPTIONS).depositAccountId, "CO_SAR");
  assert.equal(suggestPostingAccounts({ provider: "COD", currency: null }, LIVE_OPTIONS).depositAccountId, "");
});

test("pickInvoiceForOrder: two open invoices — the one matching the gateway amount wins (order 804891)", () => {
  const candidates = [
    { invoice_id: "A", invoice_number: "MNS-053146", status: "overdue", total: 954, balance: 954 },
    { invoice_id: "B", invoice_number: "MNS-052917", status: "overdue", total: 1678.5, balance: 1678.5 },
  ];
  const r = pickInvoiceForOrder(candidates, { orderNumber: "804891", expectedAmount: 1678.5, crossBorder: false });
  assert.equal(r.invoice?.invoice_number, "MNS-052917");

  const none = pickInvoiceForOrder(candidates, { orderNumber: "804891", expectedAmount: 1200, crossBorder: false });
  assert.match(none.error ?? "", /none matches/);
});

test("pickInvoiceForOrder: already-booked invoice wins; void ignored; same-amount duplicates are refused", () => {
  const dupes = [
    { invoice_id: "A", invoice_number: "INV-1", status: "overdue", total: 500, balance: 500 },
    { invoice_id: "B", invoice_number: "INV-2", status: "overdue", total: 500, balance: 500 },
    { invoice_id: "C", invoice_number: "INV-3", status: "void", total: 500, balance: 0 },
  ];
  assert.equal(pickInvoiceForOrder(dupes, { orderNumber: "1", expectedAmount: 500, crossBorder: false, preferredInvoiceId: "B" }).invoice?.invoice_id, "B");
  assert.match(pickInvoiceForOrder(dupes, { orderNumber: "1", expectedAmount: 500, crossBorder: false }).error ?? "", /same AED 500.00/);
  // open beats already-paid at the same amount
  const paidAndOpen = [
    { invoice_id: "P", invoice_number: "INV-P", status: "paid", total: 500, balance: 0 },
    { invoice_id: "O", invoice_number: "INV-O", status: "overdue", total: 500, balance: 500 },
  ];
  assert.equal(pickInvoiceForOrder(paidAndOpen, { orderNumber: "1", expectedAmount: 500, crossBorder: false }).invoice?.invoice_id, "O");
});

test("pickInvoiceForOrder: cross-border takes the closest invoice within the FX limit", () => {
  const candidates = [
    { invoice_id: "A", invoice_number: "INV-A", status: "overdue", total: 1490.93, balance: 1490.93 },
    { invoice_id: "B", invoice_number: "INV-B", status: "overdue", total: 1600, balance: 1600 },
  ];
  const r = pickInvoiceForOrder(candidates, { orderNumber: "SA3544", expectedAmount: 1434.87, crossBorder: true });
  assert.equal(r.invoice?.invoice_id, "A");
});

test("small AED gap (order 804671): closest invoice is picked and the gap books as rounding", () => {
  const candidates = [
    { invoice_id: "A", invoice_number: "MNS-052891", status: "overdue", total: 976.5, balance: 976.5 },
    { invoice_id: "B", invoice_number: "MNS-052796", status: "overdue", total: 1792.57, balance: 1792.57 },
  ];
  assert.equal(pickInvoiceForOrder(candidates, { orderNumber: "804671", expectedAmount: 1794, crossBorder: false }).invoice?.invoice_id, "B");
  const plan = planOrderPosting({
    invoiceBalance: 1792.57, grossAed: 1794, feeAed: 123.6, netAed: 1670.4,
    bankScale: 1, crossBorder: false, feeVatInclusive: true,
  });
  assert.equal(plan.review, null);
  assert.equal(plan.differenceKind, "rounding");
  assert.equal(plan.difference, -1.43);
});

// Real Tamara AED statement P8498683AE260905 (bank ref FT262517PC8K).
test("planOrderPosting: Tamara AED — VAT is charged on top of Total Fees and the whole deduction is the expense", () => {
  const plan = planOrderPosting({
    invoiceBalance: 2662, grossAed: 2662, feeAed: 160.95, feeVatAed: 8.05, netAed: 2493,
    bankScale: 1, crossBorder: false, feeVatInclusive: true,
  });
  assert.equal(plan.fee, 169, "expense = Total Fees 160.95 + VAT 8.05");
  assert.equal(plan.feeVat, 8.05, "VAT is the statement's own column, i.e. 160.95 × 5%");
  assert.equal(plan.feeExVat, 160.95);
  assert.equal(plan.difference, 0);
  assert.equal(plan.review, null);
  // Zoho's inclusive split of 169.00 lands on the same VAT
  assert.equal(vatInclusiveSplit(169).vat, 8.05);
});

test("planOrderPosting: Tamara cross-border — fee and its VAT are cost at the bank's rate, rest is FX", () => {
  const plan = planOrderPosting({
    invoiceBalance: 1000, grossAed: 980, feeAed: 60, feeVatAed: 9, netAed: 911,
    bankScale: 0.98, crossBorder: true, feeVatInclusive: true,
  });
  assert.equal(plan.fee, 67.62);      // (60 + 9) × 0.98
  assert.equal(plan.feeVat, 0);
  assert.equal(plan.netReceived, 892.78); // 911 × 0.98
  assert.equal(plan.difference, 39.6);    // 1000 − 67.62 − 892.78
  assert.equal(plan.differenceKind, "fx");
});

// Real refund on Tamara statement P8498683AE260905: order 804047, invoice
// MNS-052459 (672.60, paid, 5% Standard Rate, Sales), refunded 592.42.
const INVOICE_804047 = {
  invoice_id: "INV", invoice_number: "MNS-052459", customer_id: "CUST",
  tax_treatment: "vat_not_registered", place_of_supply: "SH",
  line_items: [
    { tax_id: "STD5", account_id: "SALES" },
    { tax_id: "STD5", account_id: "SALES" },
  ],
};

test("buildRefundCreditNoteBody: one VAT-inclusive line for the refunded amount at the invoice's tax and account", () => {
  const body = buildRefundCreditNoteBody({
    invoice: INVOICE_804047, amount: -592.42, date: "2026-09-08",
    reference: refundReferences("FT262517PC8K", "804047").creditNote, orderNumber: "804047", gateway: "Tamara",
  });
  assert.equal(body.customer_id, "CUST");
  assert.equal(body.invoice_id, "INV");
  assert.equal(body.is_inclusive_tax, true);
  assert.equal(body.reference_number, "FT262517PC8K/804047/RFN");
  assert.equal(body.place_of_supply, "SH");
  assert.deepEqual(
    body.line_items.map((l) => [l.rate, l.quantity, l.tax_id, l.account_id, "item_id" in l]),
    [[592.42, 1, "STD5", "SALES", false]],
  );
});

test("buildCreditNoteRefundBody: refund leaves the gateway clearing account", () => {
  const body = buildCreditNoteRefundBody({ amount: -592.42, date: "2026-09-08", reference: "R/RFD", fromAccountId: "TAMARA", orderNumber: "804047", gateway: "Tamara" });
  assert.equal(body.amount, 592.42);
  assert.equal(body.from_account_id, "TAMARA");
});

test("pickInvoiceForRefund: the paid invoice that covers the refund", () => {
  const r = pickInvoiceForRefund(
    [
      { invoice_id: "A", invoice_number: "MNS-052459", status: "paid", total: 672.6, balance: 0 },
      { invoice_id: "B", invoice_number: "MNS-1", status: "overdue", total: 100, balance: 100 },
    ],
    { orderNumber: "804047", amount: -592.42 },
  );
  assert.equal(r.invoice?.invoice_id, "A");
  assert.match(pickInvoiceForRefund([{ invoice_id: "B", invoice_number: "MNS-1", status: "paid", total: 100, balance: 0 }], { orderNumber: "1", amount: 592.42 }).error ?? "", /larger than/);
});

/* ── The bank's wire charge belongs to the payout, not to the orders ─────────
 * Credit DSZ26252CHJHFHHK: 12,761.00 SAR at the bank's own quoted 0.958918 is
 * AED 12,236.75, but only AED 12,188.81 landed — the bank kept AED 47.94.
 *
 * Scaling every order down by 12,188.81/12,236.75 smeared that charge across
 * all 14 orders, inflating each order's exchange difference (order 804734 by
 * AED 3.58) and overstating Tabby's fee reduction. Tabby charged what it
 * charged; the bank's cut is one charge on one wire. So per-order figures stay
 * exactly as the payout file states them at the bank's quoted rate — the
 * difference is invoice − fee − net received — and the bank's cut books once.
 */
const TABBY_SAR_WIRE = { crossBorder: true, bankAmount: 12188.81, payoutNet: 12236.75 };

test("bankScaleFor: shares already at the bank's quoted rate are never rescaled again", () => {
  assert.equal(bankScaleFor({ ...TABBY_SAR_WIRE, sharesAtBankRate: true }), 1);
  // No quoted rate in the narration: the shares are still at our static
  // estimate, so scaling them to what landed is the best truth available.
  assert.equal(
    bankScaleFor({ ...TABBY_SAR_WIRE, sharesAtBankRate: false }),
    12188.81 / 12236.75,
  );
});

test("planOrderPosting: order 804734 — difference is invoice − fee − net, with no wire charge folded in", () => {
  const plan = planOrderPosting({
    invoiceBalance: 915, grossAed: 912.37, feeAed: 60.26, netAed: 852.11,
    bankScale: bankScaleFor({ ...TABBY_SAR_WIRE, sharesAtBankRate: true }),
    crossBorder: true, feeVatInclusive: false,
  });

  assert.equal(plan.fee, 60.26, "Tabby charged 60.26 — the bank's cut does not reduce it");
  assert.equal(plan.netReceived, 852.11);
  assert.equal(plan.difference, 2.63, "915.00 − 60.26 − 852.11");
  assert.equal(plan.differenceKind, "fx");
  // What the old smear produced for the same order, for the record.
  const smeared = planOrderPosting({
    invoiceBalance: 915, grossAed: 912.37, feeAed: 60.26, netAed: 852.11,
    bankScale: 12188.81 / 12236.75, crossBorder: true, feeVatInclusive: false,
  });
  assert.equal(smeared.difference, 6.21);
  assert.equal(+(smeared.difference - plan.difference).toFixed(2), 3.58, "the inflation this removes");
});

test("planWireResidual: the bank's cut is one charge on the wire, booked once", async () => {
  const { planWireResidual } = await import("@/lib/finance/settlement-posting");

  const residual = planWireResidual({ ...TABBY_SAR_WIRE, sharesAtBankRate: true });
  assert.equal(residual.amount, 47.94, "positive = the bank kept it, a loss");
  assert.equal(residual.needed, true);

  // Already folded into every order by the rescale — booking it again would
  // double-count it.
  assert.equal(planWireResidual({ ...TABBY_SAR_WIRE, sharesAtBankRate: false }).needed, false);
  // An AED payout has no wire conversion at all.
  assert.equal(
    planWireResidual({ crossBorder: false, bankAmount: 100, payoutNet: 101, sharesAtBankRate: true }).needed,
    false,
  );
  // Bank credited more than the quoted rate implies: a gain.
  const gain = planWireResidual({ crossBorder: true, bankAmount: 12250, payoutNet: 12236.75, sharesAtBankRate: true });
  assert.equal(gain.amount, -13.25);
  assert.equal(gain.needed, true);
  // Sub-cent noise is not a journal.
  assert.equal(
    planWireResidual({ crossBorder: true, bankAmount: 12236.75, payoutNet: 12236.75, sharesAtBankRate: true }).needed,
    false,
  );
});

test("buildResidualJournalBody: a loss debits exchange gain/loss and credits clearing", async () => {
  const { buildResidualJournalBody } = await import("@/lib/finance/settlement-posting");
  const body = buildResidualJournalBody({
    amount: 47.94, accounts: ACCOUNTS, date: "2026-09-09",
    reference: "DSZ26252CHJHFHHK/WIRE", description: "bank wire charge",
  });
  assert.equal(body.line_items[0].account_id, "FX_GAIN_LOSS");
  assert.equal(body.line_items[0].debit_or_credit, "debit");
  assert.equal(body.line_items[0].amount, 47.94);
  assert.equal(body.line_items[1].account_id, "TABBY_AED");
  assert.equal(body.line_items[1].debit_or_credit, "credit");

  const gain = buildResidualJournalBody({
    amount: -13.25, accounts: ACCOUNTS, date: "2026-09-09",
    reference: "X/WIRE", description: "bank paid more than quoted",
  });
  assert.equal(gain.line_items[0].account_id, "TABBY_AED", "a gain lands in clearing");
  assert.equal(gain.line_items[0].amount, 13.25);
});

test("planOrderPosting: a foreign-currency order inside an AED payout is FX, not a mismatch", () => {
  // Real Telr payout TELR-5650390 (AED-denominated, 18 orders). Order 804938
  // was placed in SAR 827.22. Zoho invoiced it at our 0.98 rate (AED 810.70);
  // Telr converted the same charge at its own 0.95900 (AED 793.30) and took
  // its 3.9% international-card fee. The 17.40 gap is that rate difference,
  // and it used to block on the AED branch's max(AED 1, 0.25%) tolerance.
  const plan = planOrderPosting({
    invoiceBalance: 810.7, grossAed: 793.3, feeAed: 31.04, netAed: 762.26,
    bankScale: 1, crossBorder: false, orderCurrency: "SAR", feeVatInclusive: true,
  });
  assert.equal(plan.review, null, "a rate difference is not a reason for a human to look");
  assert.equal(plan.differenceKind, "fx");
  assert.equal(plan.difference, 17.4);
  // The payout is AED, so UAE input VAT on the fee is still reclaimable —
  // the order's currency must not switch that off.
  assert.equal(plan.feeVat, 1.48);
  assert.equal(plan.feeExVat, 29.56);
  // Clearing empties to exactly what Telr paid.
  assert.equal(+(plan.paymentAmount - plan.fee - plan.difference).toFixed(2), plan.netReceived);
});

test("planOrderPosting: QAR order converted 1:1 books its FX difference too", () => {
  // Order 805020: QAR 1680.50 with no QAR entry in the rate table, so it was
  // invoiced 1:1. Telr settled it at 0.98470 → AED 1654.79.
  const plan = planOrderPosting({
    invoiceBalance: 1680.5, grossAed: 1654.79, feeAed: 63.61, netAed: 1591.18,
    bankScale: 1, crossBorder: false, orderCurrency: "QAR", feeVatInclusive: true,
  });
  assert.equal(plan.review, null);
  assert.equal(plan.differenceKind, "fx");
  assert.equal(plan.difference, 25.71);
  assert.equal(+(plan.paymentAmount - plan.fee - plan.difference).toFixed(2), plan.netReceived);
});

test("planOrderPosting: a Stripe exchange GAIN on a foreign order reverses the journal legs", () => {
  // Same class as the Telr loss, opposite sign: the gateway's rate beat ours,
  // so more landed than the invoice expected. buildResidualJournalBody swaps
  // the debit and credit legs off that sign.
  const plan = planOrderPosting({
    invoiceBalance: 500, grossAed: 515, feeAed: 15, netAed: 500,
    bankScale: 1, crossBorder: false, orderCurrency: "SAR", feeVatInclusive: false,
  });
  assert.equal(plan.differenceKind, "fx");
  assert.equal(plan.difference, -15);
  const journal = buildDifferenceJournalBody({
    plan, accounts: ACCOUNTS, date: "2026-09-08", reference: "REF/805099/FX", description: "exchange gain",
  });
  assert.equal(journal.line_items[0].account_id, ACCOUNTS.depositAccountId, "a gain debits clearing");
  assert.equal(journal.line_items[1].account_id, ACCOUNTS.differenceAccountId);
  assert.equal(journal.line_items[0].amount, 15);
});

test("planOrderPosting: an AED order in an AED payout still holds a real gap for review", () => {
  // The guard must survive the fix — only foreign-currency orders are exempt.
  const plan = planOrderPosting({
    invoiceBalance: 130, grossAed: 100, feeAed: 5, netAed: 95,
    bankScale: 1, crossBorder: false, orderCurrency: "AED", feeVatInclusive: true,
  });
  assert.match(plan.review ?? "", /doesn't match/);
});

test("planOrderPosting: a foreign-currency gap beyond 15% is still held for review", () => {
  const plan = planOrderPosting({
    invoiceBalance: 1000, grossAed: 700, feeAed: 20, netAed: 680,
    bankScale: 1, crossBorder: false, orderCurrency: "SAR", feeVatInclusive: true,
  });
  assert.match(plan.review ?? "", /Exchange difference/);
});

test("pickInvoiceForOrder: a foreign-currency order gets the FX tolerance", () => {
  // Two live invoices, and the gateway's AED figure is 2.1% off the right one
  // because it converted SAR at its own rate. The AED tolerance (0.25%) would
  // reject both; the FX tolerance picks the near one.
  const candidates = [
    { invoice_id: "A", invoice_number: "INV-1", status: "overdue", total: 810.7, balance: 810.7, customer_id: "C1" },
    { invoice_id: "B", invoice_number: "INV-2", status: "overdue", total: 2400, balance: 2400, customer_id: "C1" },
  ];
  const picked = pickInvoiceForOrder(candidates, {
    orderNumber: "804938", expectedAmount: 793.3, crossBorder: false, orderCurrency: "SAR",
  });
  assert.equal(picked.invoice?.invoice_id, "A");

  const aed = pickInvoiceForOrder(candidates, {
    orderNumber: "804938", expectedAmount: 793.3, crossBorder: false, orderCurrency: "AED",
  });
  assert.ok(aed.error, "an AED order with the same gap still refuses to guess");
});
