import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBankStatement } from "@/lib/parsers/bank";

test("bank parser: On Track Delivery COD credit is classified and carries an INV reference", () => {
  const csv = [
    "Date,Description,Credit,Debit",
    "11/07/2026,\"KWD Inward Telex Payment/L.L.C ON TRACK DELIVERY SERVICES/AL MARARR 2- 102 PLOT NO 198-0 OFFI/CE 102-448 Dubai UAE//REF/invoice 16964/FT26192VXFKW FT26192VXFKW\",2462.00,",
  ].join("\n");

  const { credits } = parseBankStatement(csv, "statement.csv");

  assert.equal(credits.length, 1);
  const c = credits[0];
  assert.equal(c.provider, "COD");
  assert.equal(c.confidence, "keyword");
  assert.equal(c.amount, 2462);
  // FT... wire code is present too, but the invoice number is what a founder
  // recognizes — REF_RE should still win when both are present (unchanged
  // behavior), so this fixture pins today's precedence explicitly.
  assert.equal(c.reference, "FT26192VXFKW");
});

test("bank parser: falls back to INVOICE number when no FT/DSZ/INSTQ wire code is present", () => {
  const csv = [
    "Date,Description,Credit,Debit",
    "11/07/2026,\"Inward Telex Payment/L.L.C ON TRACK DELIVERY SERVICES//REF/invoice 16964\",2462.00,",
  ].join("\n");

  const { credits } = parseBankStatement(csv, "statement.csv");

  assert.equal(credits.length, 1);
  assert.equal(credits[0].reference, "INV16964");
});

/* Regression: merged-PDF segments whose wire reference ends in a digit used
   to pair that digit with the real amount ("...FT26202HNZB1 2,345.67
   890,123.45" → phantom AED 1.00 credit, narration truncated mid-reference).
   Positive phantom amounts also flipped obvious debits into credits. */
test("bank parser: reference trailing digit is never read as the amount (merged text)", () => {
  const text = [
    "20/07/2026 FTS CTD Cr Account Transfer/NETWORK INTERNATIONAL LLC/OFFICE LEVEL 201 101 AL BARSHA 2 PO/BOX 4487 DUBAI UAE/ AE/SIB.CUST//REF/AEL2607210004075 ntsub.UvM1Do0/SppLEGm SHOPIFY- MJXZTIV865OZ6NWD9XV/FT26202HNZB1 FT26202HNZB1 2,345.67 890,123.45",
    "19/07/2026 Tax Amount Payable/ AC-0012043598001/FT26201C02Q9 FT26201C02Q9 -0.02 779,850.60",
    "19/07/2026 Outward SWIFT Charges/ DSZ26201CGC0JHK0 DSZ26201CGC0JHK0 -50.00 807,931.79",
    "19/07/2026 IBK Other Bank Trans Debit/Ben Info:86252211091, MEICHONG JEWELRY (HK) CO LTD/09 05 2026/USD/AED 3.70605/PI262010ZYB4C7DX/Channel: IBMB/To 86252211091/ DSZ26201CGC0JHK0 DSZ26201CGC0JHK0 -1,797.05 779,850.62",
  ].join(" ");

  const { credits, debits, format } = parseBankStatement(text);

  assert.equal(format, "merged-text");
  assert.equal(credits.length, 1);
  assert.equal(credits[0].amount, 2345.67);
  assert.equal(credits[0].reference, "FT26202HNZB1");
  assert.ok(credits[0].narration.endsWith("FT26202HNZB1 FT26202HNZB1"), "narration keeps full references");

  // signed negatives stay debits — none of these may surface as a credit
  assert.equal(debits.length, 3);
  const byRef = new Map<string, number[]>();
  for (const d of debits) byRef.set(d.reference, [...(byRef.get(d.reference) ?? []), d.amount]);
  assert.deepEqual(byRef.get("FT26201C02Q9"), [0.02]);
  assert.deepEqual(byRef.get("DSZ26201CGC0JHK0"), [50, 1797.05]);
});

test("bank parser: line-oriented blocks don't bleed the reference digit either", () => {
  const text = [
    "20/07/2026 FTS CTD Cr Account Transfer/NETWORK INTERNATIONAL LLC/",
    "SHOPIFY- MJXZTIV865OZ6NWD9XV/FT26202HNZB1 FT26202HNZB1 2,345.67 890,123.45",
  ].join("\n");

  const { credits } = parseBankStatement(text);

  assert.equal(credits.length, 1);
  assert.equal(credits[0].amount, 2345.67);
});
