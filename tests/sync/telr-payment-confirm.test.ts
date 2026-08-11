import { test } from "node:test";
import assert from "node:assert/strict";
import { pickAuthorisedTransaction } from "@/lib/sync/telr-payment-confirm";
import type { TelrToolsTransaction } from "@/lib/integrations/telr";

function txn(overrides: Partial<TelrToolsTransaction> = {}): TelrToolsTransaction {
  return { id: "t1", amount: 100, currency: "AED", cartId: "123_abc", authorised: false, date: "2026-08-07 12:00:00", ...overrides };
}

test("pickAuthorisedTransaction: returns the authorised transaction among a cart's events", () => {
  const txns = [txn({ id: "sale", authorised: false }), txn({ id: "auth-sale", authorised: true })];
  const picked = pickAuthorisedTransaction(txns);
  assert.equal(picked?.id, "auth-sale");
});

test("pickAuthorisedTransaction: returns null when nothing in the cart was authorised", () => {
  const txns = [txn({ id: "declined", authorised: false }), txn({ id: "void", authorised: false })];
  assert.equal(pickAuthorisedTransaction(txns), null);
});

test("pickAuthorisedTransaction: returns null for an empty cart", () => {
  assert.equal(pickAuthorisedTransaction([]), null);
});
