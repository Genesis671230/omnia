import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPayoutPostings,
  accountMapFromEnv,
  type ZohoAccountMap,
} from "@/lib/integrations/zoho-banking";
import { buildBankLinePosting, missingIncomeMapping, missingExpenseMappingFor } from "@/lib/integrations/zoho-banking";

const ACCOUNTS: ZohoAccountMap = {
  bankAccountId: "BANK1",
  feeAccountId: "FEES1",
  clearingByGateway: { Tabby: "CLR_TABBY", Tamara: "CLR_TAMARA", COD: "CLR_COD" },
};

const BASE = {
  gateway: "Tabby",
  bankReference: "FT26192VXFKW",
  date: "2026-07-11",
  payoutId: "TABBY-20260706SAR",
};

test("buildPayoutPostings: splits a payout into net-to-bank and fee, both drawn from clearing", () => {
  const postings = buildPayoutPostings(
    { ...BASE, netAed: 28492.32, grossAed: 30497.70 },
    ACCOUNTS,
  );

  assert.equal(postings.length, 2);

  const [net, fee] = postings;
  assert.equal(net.amount, 28492.32);
  assert.equal(net.from_account_id, "CLR_TABBY");
  assert.equal(net.to_account_id, "BANK1");
  assert.equal(net.transaction_type, "transfer_fund");
  assert.equal(net.referenceNumber, "FT26192VXFKW");

  // hand-computed from the real Tabby KSA statement: 30497.70 - 28492.32
  assert.equal(fee.amount, 2005.38);
  assert.equal(fee.from_account_id, "CLR_TABBY");
  assert.equal(fee.to_account_id, "FEES1");
  assert.equal(fee.referenceNumber, "FT26192VXFKW-FEE");

  // The whole point of the clearing model: what leaves clearing must equal
  // what customers were charged, or money is stranded there forever.
  assert.equal(+(net.amount + fee.amount).toFixed(2), 30497.70);
});

test("buildPayoutPostings: a zero-fee payout emits only the transfer, no 0.00 noise", () => {
  const postings = buildPayoutPostings(
    { ...BASE, gateway: "COD", netAed: 7302.95, grossAed: 7302.95 },
    ACCOUNTS,
  );
  assert.equal(postings.length, 1);
  assert.equal(postings[0].amount, 7302.95);
  assert.equal(postings[0].from_account_id, "CLR_COD");
});

test("buildPayoutPostings: refuses a gateway with no clearing account rather than guessing", () => {
  assert.throws(
    () => buildPayoutPostings({ ...BASE, gateway: "Checkout", netAed: 100, grossAed: 110 }, ACCOUNTS),
    /No Zoho clearing account mapped for gateway "Checkout"/,
  );
});

test("buildPayoutPostings: refuses a net larger than gross instead of inventing income", () => {
  assert.throws(
    () => buildPayoutPostings({ ...BASE, netAed: 200, grossAed: 100 }, ACCOUNTS),
    /exceeds gross/,
  );
});

test("buildPayoutPostings: refuses a payout with no bank reference — it could not be deduplicated", () => {
  assert.throws(
    () => buildPayoutPostings({ ...BASE, bankReference: "", netAed: 100, grossAed: 110 }, ACCOUNTS),
    /no bank reference/,
  );
});

test("buildPayoutPostings: refuses a non-positive net", () => {
  assert.throws(
    () => buildPayoutPostings({ ...BASE, netAed: 0, grossAed: 10 }, ACCOUNTS),
    /net must be positive/,
  );
});

test("buildPayoutPostings: fee reference is distinct from the net reference so neither dedupes the other", () => {
  const [net, fee] = buildPayoutPostings({ ...BASE, netAed: 90, grossAed: 100 }, ACCOUNTS);
  assert.notEqual(net.referenceNumber, fee.referenceNumber);
  assert.equal(fee.amount, 10);
});

test("buildPayoutPostings: sub-cent inputs round to the cent and still balance", () => {
  // Checkout's export carries amounts to 8 decimal places.
  const [net, fee] = buildPayoutPostings(
    { ...BASE, gateway: "Tamara", netAed: 498.9825, grossAed: 500.00183621 },
    ACCOUNTS,
  );
  assert.equal(net.amount, 498.98);
  assert.equal(fee.amount, 1.02); // 500.00 - 498.98
  assert.equal(+(net.amount + fee.amount).toFixed(2), 500.00);
});

test("accountMapFromEnv: names the missing key rather than failing vaguely", () => {
  const saved = { ...process.env };
  try {
    delete process.env.ZOHO_BANK_ACCOUNT_ID;
    assert.throws(() => accountMapFromEnv(), /ZOHO_BANK_ACCOUNT_ID is not set/);

    process.env.ZOHO_BANK_ACCOUNT_ID = "B1";
    delete process.env.ZOHO_FEE_ACCOUNT_ID;
    assert.throws(() => accountMapFromEnv(), /ZOHO_FEE_ACCOUNT_ID is not set/);

    process.env.ZOHO_FEE_ACCOUNT_ID = "F1";
    process.env.ZOHO_CLEARING_ACCOUNTS = "{not json";
    assert.throws(() => accountMapFromEnv(), /not valid JSON/);

    process.env.ZOHO_CLEARING_ACCOUNTS = '{"Tabby":"C1"}';
    assert.deepEqual(accountMapFromEnv(), {
      bankAccountId: "B1", feeAccountId: "F1", clearingByGateway: { Tabby: "C1" },
    });
  } finally {
    process.env = saved;
  }
});

const BANK_LINE_ACCOUNTS: ZohoAccountMap = {
  bankAccountId: "BANK1",
  feeAccountId: "FEES1",
  clearingByGateway: {},
  defaultIncomeAccountId: "INCOME1",
  expenseAccountByKind: { salary: "EXP_SALARY", supplier: "EXP_SUPPLIER", fee: "EXP_FEE" },
};

test("buildBankLinePosting: a credit posts as a deposit from the default income account into the bank", () => {
  const posting = buildBankLinePosting(
    { bankLineId: "abc-123", direction: "credit", amount: 2462, date: "2026-07-11", kind: null, description: "ON TRACK DELIVERY" },
    BANK_LINE_ACCOUNTS,
  );
  assert.equal(posting.transaction_type, "deposit");
  assert.equal(posting.from_account_id, "INCOME1");
  assert.equal(posting.to_account_id, "BANK1");
  assert.equal(posting.amount, 2462);
  assert.equal(posting.referenceNumber, "BANKLINE-abc-123");
  assert.equal(posting.description, "ON TRACK DELIVERY");
});

test("buildBankLinePosting: a debit posts as an expense from the bank into its kind's mapped account", () => {
  const posting = buildBankLinePosting(
    { bankLineId: "def-456", direction: "debit", amount: 50, date: "2026-07-19", kind: "fee", description: "Outward SWIFT Charges" },
    BANK_LINE_ACCOUNTS,
  );
  assert.equal(posting.transaction_type, "expense");
  assert.equal(posting.from_account_id, "BANK1");
  assert.equal(posting.to_account_id, "EXP_FEE");
  assert.equal(posting.amount, 50);
  assert.equal(posting.referenceNumber, "BANKLINE-def-456");
});

test("buildBankLinePosting: a debit with no kind falls back to 'other'", () => {
  assert.throws(
    () => buildBankLinePosting(
      { bankLineId: "g1", direction: "debit", amount: 10, date: "2026-07-19", kind: null, description: "x" },
      BANK_LINE_ACCOUNTS,
    ),
    /No expense account mapped for kind "other"/,
  );
});

test("buildBankLinePosting: refuses a credit with no default income account mapped", () => {
  assert.throws(
    () => buildBankLinePosting(
      { bankLineId: "g2", direction: "credit", amount: 10, date: "2026-07-19", kind: null, description: "x" },
      { ...BANK_LINE_ACCOUNTS, defaultIncomeAccountId: "" },
    ),
    /No default income account mapped/,
  );
});

test("buildBankLinePosting: refuses a debit whose kind has no mapped expense account", () => {
  assert.throws(
    () => buildBankLinePosting(
      { bankLineId: "g3", direction: "debit", amount: 10, date: "2026-07-19", kind: "tax", description: "x" },
      BANK_LINE_ACCOUNTS,
    ),
    /No expense account mapped for kind "tax"/,
  );
});

test("buildBankLinePosting: refuses a non-positive amount", () => {
  assert.throws(
    () => buildBankLinePosting(
      { bankLineId: "g4", direction: "credit", amount: 0, date: "2026-07-19", kind: null, description: "x" },
      BANK_LINE_ACCOUNTS,
    ),
    /amount must be positive/,
  );
});

test("missingIncomeMapping / missingExpenseMappingFor: name what's missing", () => {
  assert.deepEqual(missingIncomeMapping({ bankAccountId: "", feeAccountId: "", clearingByGateway: {} }), [
    "bank account",
    "default income account",
  ]);
  assert.deepEqual(missingExpenseMappingFor("salary", BANK_LINE_ACCOUNTS), []);
  assert.deepEqual(missingExpenseMappingFor("tax", BANK_LINE_ACCOUNTS), ["tax expense account"]);
});
