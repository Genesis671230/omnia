import { test } from "node:test";
import assert from "node:assert/strict";
import { isBookedInZoho } from "@/lib/finance/payout-booked";

test("a matched but unbooked order does not lock the payout", () => {
  assert.equal(isBookedInZoho({ zoho_payment_id: null, zoho_fee_expense_id: null, zoho_fx_journal_id: null, force_payment_id: null }), false);
});

test("an in-flight lease wrote nothing yet", () => {
  assert.equal(isBookedInZoho({ zoho_payment_id: "CLAIMED:abc" }), false);
});

test("any Zoho document — or a write that may have landed — locks it", () => {
  assert.equal(isBookedInZoho({ zoho_payment_id: "4518000001234" }), true);
  assert.equal(isBookedInZoho({ zoho_fee_expense_id: "PENDING:2026-09-29T10:00" }), true);
  assert.equal(isBookedInZoho({ force_payment_id: "4518000009999" }), true);
});
