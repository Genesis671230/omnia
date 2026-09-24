import { test } from "node:test";
import assert from "node:assert/strict";
import { matchBankLinesToZoho, refTokens, type LedgerZohoTxn } from "@/lib/reconciliation/zoho-ledger-match";

// Live Zoho rows for 01 Sep 2026 (Sharjah Islamic Bank). The accountant typed
// free text after the bank ref, and booked the AED 1.00 transfer charge and
// its AED 0.05 VAT as ONE 1.05 expense.
const ZOHO: LedgerZohoTxn[] = [
  { transaction_id: "Z-50K", date: "2026-09-01", amount: 50000, transaction_type: "transfer_fund", status: "manually_added",
    debit_or_credit: "credit", reference_number: "FT26244T2HH8-Trf to Credit card 50k on 01.09.2026",
    offset_account_name: "House of Omnia Accessories LLC - sis company" },
  { transaction_id: "Z-FEE", date: "2026-09-01", amount: 1.05, transaction_type: "expense", status: "manually_added",
    debit_or_credit: "credit", reference_number: "FT26244T2HH8", offset_account_name: "Bank Fees and Charges" },
  { transaction_id: "Z-BONUS", date: "2026-09-01", amount: 1000, transaction_type: "expense", status: "manually_added",
    debit_or_credit: "credit", reference_number: "FT26244G9MH3\\HCP-Omar Birthday Bonus", offset_account_name: "Employees Bonus" },
  { transaction_id: "Z-TAMARA", date: "2026-09-01", amount: 6636.25, transaction_type: "transfer_fund", status: "manually_added",
    debit_or_credit: "debit", reference_number: "FT26244989T5", offset_account_name: "TAMARA" },
];

const line = (id: string, amount: number, direction: "credit" | "debit", reference: string, description = "") =>
  ({ id, amount, direction, reference, description });

test("refTokens keeps bank refs and drops free text, account numbers and SWIFT codes", () => {
  assert.deepEqual(refTokens("FT26244T2HH8-Trf to Credit card 50k on 01.09.2026"), ["FT26244T2HH8"]);
  assert.deepEqual(refTokens("FT26244G9MH3\\HCP-Omar Birthday Bonus"), ["FT26244G9MH3"]);
  assert.deepEqual(refTokens("Tax Amount Payable/ AC-0012043598001/FT26244T2HH8 FT26244T2HH8"), ["FT26244T2HH8"]);
});

test("transfer + charge + VAT sharing one ref all resolve: 50k exact, 1.00 + 0.05 combined into the 1.05 expense", () => {
  const out = matchBankLinesToZoho(
    [
      line("L-50K", 50000, "debit", "FT26244T2HH8"),
      line("L-CHG", 1, "debit", "FT26244T2HH8"),
      line("L-VAT", 0.05, "debit", "FT26244T2HH8"),
    ],
    ZOHO,
  );
  assert.equal(out.get("L-50K")?.state, "in_zoho");
  assert.equal(out.get("L-50K")?.matchKind, "exact");
  assert.deepEqual(out.get("L-50K")?.zohoTransactionIds, ["Z-50K"]);

  for (const id of ["L-CHG", "L-VAT"]) {
    const s = out.get(id)!;
    assert.equal(s.state, "in_zoho");
    assert.equal(s.matchKind, "combined");
    assert.deepEqual(s.zohoTransactionIds, ["Z-FEE"]);
    assert.equal(s.zohoAmount, 1.05);
    assert.equal(s.zohoAccount, "Bank Fees and Charges");
  }
});

test("direction matters: a credit never claims a Zoho money-out entry with the same ref", () => {
  const out = matchBankLinesToZoho([line("L", 50000, "credit", "FT26244T2HH8")], ZOHO);
  assert.equal(out.get("L")?.state, "not_found");
});

test("same ref, wrong amount → amount_differs, carrying Zoho's figure", () => {
  const out = matchBankLinesToZoho([line("L", 6600, "credit", "FT26244989T5")], ZOHO);
  assert.equal(out.get("L")?.state, "amount_differs");
  assert.equal(out.get("L")?.zohoAmount, 6636.25);
});

test("a Zoho entry is claimed once — a duplicate bank line with the same ref and amount is not also 'in Zoho'", () => {
  const out = matchBankLinesToZoho(
    [line("A", 1000, "debit", "FT26244G9MH3"), line("B", 1000, "debit", "FT26244G9MH3")],
    ZOHO,
  );
  const states = [out.get("A")?.state, out.get("B")?.state].sort();
  assert.deepEqual(states, ["in_zoho", "not_found"]);
});

test("no reference on the line → the ref is read off the narration", () => {
  const out = matchBankLinesToZoho(
    [line("L", 50000, "debit", "", "IBK Other Bank Trans Debit/Omnia Mohamed/SW-NRAKAEAKXXX/TOF - Transfer of Funds/FT26244T2HH8 FT26244T2HH8")],
    ZOHO,
  );
  assert.equal(out.get("L")?.state, "in_zoho");
});

test("a transaction this app posted (BANKLINE-<id>) matches its own line directly", () => {
  const out = matchBankLinesToZoho(
    [line("e478541c-3a44-4c8d-9cb5-cb3c6266561d", 12, "debit", "")],
    [{ transaction_id: "Z1", date: "2026-09-01", amount: 12, transaction_type: "expense", status: "categorized",
       debit_or_credit: "credit", reference_number: "BANKLINE-e478541c-3a44-4c8d-9cb5-cb3c6266561d", offset_account_name: "X" }],
  );
  assert.equal(out.get("e478541c-3a44-4c8d-9cb5-cb3c6266561d")?.state, "in_zoho");
});

test("a line sitting uncategorized in Zoho's bank feed is not booked", () => {
  const out = matchBankLinesToZoho(
    [line("L", 6636.25, "credit", "FT26244989T5")],
    [{ ...ZOHO[3], status: "uncategorized" }],
  );
  assert.equal(out.get("L")?.state, "uncategorized");
});

test("booked under a different ref: a unique same-amount entry within 3 days matches, flagged amount_date", () => {
  const zoho: LedgerZohoTxn = { transaction_id: "Z40", date: "2026-09-07", amount: 40000, transaction_type: "transfer_fund",
    status: "manually_added", debit_or_credit: "credit", reference_number: "FT26251PVCVF-Traf to Credit card 40K on 01.09.2026" };
  const out = matchBankLinesToZoho([{ ...line("L", 40000, "debit", "FT26250XYXNL"), date: "2026-09-07T00:00:00" }], [zoho]);
  assert.equal(out.get("L")?.state, "in_zoho");
  assert.equal(out.get("L")?.matchKind, "amount_date");
});

test("amount+date fallback refuses when two lines could claim the same entry, or the entry's ref belongs to another line", () => {
  const zoho: LedgerZohoTxn = { transaction_id: "Z", date: "2026-09-07", amount: 500, transaction_type: "expense",
    status: "manually_added", debit_or_credit: "credit", reference_number: "FT00000AAAA1" };
  const two = matchBankLinesToZoho([
    { ...line("A", 500, "debit", "FT11111BBBB1"), date: "2026-09-07" },
    { ...line("B", 500, "debit", "FT22222CCCC2"), date: "2026-09-08" },
  ], [zoho]);
  assert.equal(two.get("A")?.state, "not_found");
  assert.equal(two.get("B")?.state, "not_found");

  const owned = matchBankLinesToZoho([
    { ...line("A", 500, "debit", "FT11111BBBB1"), date: "2026-09-07" },
    { ...line("OWNER", 499, "debit", "FT00000AAAA1"), date: "2026-09-07" },
  ], [zoho]);
  assert.equal(owned.get("A")?.state, "not_found");
});

test("a leftover Zoho entry whose ref's own lines are all matched is free for the amount+date fallback", () => {
  // Live: 07 Sep 40K booked in Zoho under the 08 Sep 300K transfer's ref.
  const zoho: LedgerZohoTxn[] = [
    { transaction_id: "Z300", date: "2026-09-08", amount: 300000, transaction_type: "transfer_fund", status: "manually_added",
      debit_or_credit: "credit", reference_number: "FT26251PVCVF-Trf 3 lack to House of Omnia" },
    { transaction_id: "Z40", date: "2026-09-07", amount: 40000, transaction_type: "transfer_fund", status: "manually_added",
      debit_or_credit: "credit", reference_number: "FT26251PVCVF-Traf to Credit card 40K on 01.09.2026" },
  ];
  const out = matchBankLinesToZoho([
    { ...line("L300", 300000, "debit", "FT26251PVCVF"), date: "2026-09-08" },
    { ...line("L40", 40000, "debit", "FT26250XYXNL"), date: "2026-09-07" },
  ], zoho);
  assert.equal(out.get("L300")?.matchKind, "exact");
  assert.equal(out.get("L40")?.state, "in_zoho");
  assert.equal(out.get("L40")?.matchKind, "amount_date");
});
