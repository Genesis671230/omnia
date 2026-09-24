import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultBankLineNote, parseNarration, zohoDescriptionFor, ZOHO_DESCRIPTION_MAX } from "@/lib/reconciliation/bank-line-description";

// The founder's live example (Zoho transaction, 02 Sep 2026, AED 3,354.10).
const NARRATION =
  "FTS CTD Cr Account Transfer/NETWORK INTERNATIONAL LLC/OFFICE LEVEL 201 101 AL BARSHA 2 PO/BOX 4487 DUBAI UAE/ AE/SIB.CUST//REF/AEL2609020004017 ntsub.VBSkdDB/IXO9Svb SHOPIFY- ROMA1MQTUENP6SXWFJ2/ FT26245BWF4X FT26245BWF4X";

test("parseNarration pulls out the counterparty, gateway ref and merchant tag", () => {
  assert.deepEqual(parseNarration(NARRATION), {
    channel: "FTS CTD Cr Account Transfer",
    counterparty: "NETWORK INTERNATIONAL LLC",
    gatewayRef: "AEL2609020004017",
    merchantTag: "SHOPIFY ROMA1MQTUENP6SXWFJ2",
  });
});

test("a credit's default description names the payout, its orders and every reference", () => {
  const note = defaultBankLineNote({
    direction: "credit", amount: 3354.1, date: "2026-09-02T00:00:00", narration: NARRATION, reference: "FT26245BWF4X",
    entity: "Shopify", payout: { id: "SHOPIFY-UAE-123", gateway: "Shopify Payments", orders: ["3439", "3440"] },
  });
  assert.equal(
    note,
    "Shopify Payments payout received · AED 3,354.10 · from NETWORK INTERNATIONAL LLC · payout SHOPIFY-UAE-123 (2 orders: #3439, #3440) · gateway ref AEL2609020004017 · bank ref FT26245BWF4X · 02 Sep 2026",
  );
});

test("a debit's default description says what it paid", () => {
  const note = defaultBankLineNote({
    direction: "debit", amount: 52.5, date: "2026-09-03", narration: "SERVICE CHARGE/INWARD TT CHARGES", reference: "CHG1", kind: "expense", entity: "Bank charges",
  });
  assert.match(note, /^Expense: Bank charges · AED 52\.50 · to INWARD TT CHARGES · bank ref CHG1 · 03 Sep 2026$/);
});

test("Zoho gets the note first, then the bank narration, within the limit", () => {
  assert.equal(zohoDescriptionFor("Tabby payout", "BANK TEXT"), "Tabby payout | Bank: BANK TEXT");
  assert.equal(zohoDescriptionFor("", "BANK TEXT"), "BANK TEXT");
  const long = zohoDescriptionFor("x".repeat(300), NARRATION);
  assert.equal(long.length, ZOHO_DESCRIPTION_MAX);
});
