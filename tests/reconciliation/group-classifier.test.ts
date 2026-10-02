import { test } from "node:test";
import assert from "node:assert/strict";
import { autoClassify, type ClassifierContext } from "../../lib/reconciliation/group-classifier";
import type { BankLineGroup } from "../../lib/reconciliation/group-detector";

const ctx = (creditCardAccountId: string): ClassifierContext => ({
  defaultBankAccountId: "SIB", standardVat5Id: "VAT5", ownerDrawingsAccountId: "DRAWINGS",
  creditCardAccountId, defaultPlaceOfSupply: "DU", payees: [],
});

const group = (description: string, payee: string): BankLineGroup => {
  const line = { id: "L", date: "2026-09-22", description, reference: "FT26265CCMQS", amount: -35000, direction: "debit" } as unknown as BankLineGroup["mainLine"];
  return { key: "FT26265CCMQS", reference: "FT26265CCMQS", date: "2026-09-22", mainLine: line, feeLines: [], allLines: [line], totalAmount: 35000, payee };
};

const TOF = "IBK Other Bank Trans Debit/Omnia Mohamed/SW-NRAKAEAKXXX/TOF - Transfer of Funds/FT26265CCMQS";

test("Omnia Mohamed TOF transfers go to the credit card, never Drawings", () => {
  const c = autoClassify(group(TOF, "Omnia Mohamed"), ctx("CARD-8436"));
  assert.equal(c.groupType, "inter_account");
  assert.equal(c.destinationAccountId, "CARD-8436");
  assert.notEqual(c.destinationAccountId, "DRAWINGS");
});

test("without one known card account the transfer is left for a person, not auto-booked", () => {
  const c = autoClassify(group(TOF, "Omnia Mohamed"), ctx(""));
  assert.equal(c.groupType, "unclassified");
  assert.equal(c.autoClassified, false);
});
