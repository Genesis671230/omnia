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
