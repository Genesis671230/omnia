import { test } from "node:test";
import assert from "node:assert/strict";
import { detectStatementAccount, type StatementAccount } from "@/lib/finance/statement-accounts";

const acct = (id: string, matchHints: string[]): StatementAccount => ({ id, label: id, bank: "", kind: "bank", holder: "", zohoConnectionId: "", zohoAccountId: "", matchHints, currency: "AED" });
const sib = acct("sib-omniastores", ["0012043598001"]);
const rak = acct("rak-house-of-omnia", ["0333190982001", "546750XXXXXX6886", "HOUSE OF OMNIA ACCESSORIES"]);

test("SIB statement paying House of Omnia stays SIB (8 Oct 2026 misfile)", () => {
  const text = "Transaction history Account 0012043598001 ...\n05/10/2026 Outward Telex Payment/HOUSE OF OMNIA ACCESSORIES LLC/SW- NRA 41,000.00";
  assert.equal(detectStatementAccount(text, [sib, rak])?.id, "sib-omniastores");
});

test("RAK statement is RAK; nothing matching → null", () => {
  assert.equal(detectStatementAccount("Account No 0333190982001 HOUSE OF OMNIA ACCESSORIES LLC", [sib, rak])?.id, "rak-house-of-omnia");
  assert.equal(detectStatementAccount("some other bank", [sib, rak]), null);
});
