import { test } from "node:test";
import assert from "node:assert/strict";
import { inferTransactionType } from "../../lib/reconciliation/infer-transaction-type";

const acct = (account_type: string, account_name = "X") => ({ account_type, account_name });

test("money out: drawings to equity, transfer to another bank or card, expense otherwise", () => {
  assert.equal(inferTransactionType("debit", acct("equity", "Drawings")), "owner_drawings");
  assert.equal(inferTransactionType("debit", acct("credit_card", "5362-72XX")), "transfer_fund");
  assert.equal(inferTransactionType("debit", acct("bank", "RAK Bank")), "transfer_fund");
  assert.equal(inferTransactionType("debit", acct("expense", "Bank Fees and Charges")), "expense");
  assert.equal(inferTransactionType("debit", acct("other_current_asset", "Prepaid Expenses")), "expense");
});

test("money in: contribution from equity, transfer from a bank, interest / other income, deposit otherwise", () => {
  assert.equal(inferTransactionType("credit", acct("equity")), "owner_contribution");
  assert.equal(inferTransactionType("credit", acct("cash")), "transfer_fund");
  assert.equal(inferTransactionType("credit", acct("other_income", "Interest Income")), "interest_income");
  assert.equal(inferTransactionType("credit", acct("other_income", "Misc")), "other_income");
  assert.equal(inferTransactionType("credit", acct("other_current_asset", "Stripe clearing")), "deposit");
  assert.equal(inferTransactionType("credit", undefined), null);
});

test("a credit card kept as a liability account is a transfer, not an expense (Credit Card - XXX-8436)", () => {
  assert.equal(inferTransactionType("debit", acct("other_current_liability", "Credit Card - XXX-8436")), "transfer_fund");
  assert.equal(inferTransactionType("debit", acct("expense", "Credit Card Charges")), "expense");
  assert.equal(inferTransactionType("debit", acct("other_current_liability", "VAT Payable")), "expense");
});
