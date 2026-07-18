import { test } from "node:test";
import assert from "node:assert/strict";
import { zohoPaymentModeFor } from "@/lib/integrations/zoho";

test("zohoPaymentModeFor: maps each known gateway to its own distinct Zoho payment mode", () => {
  // Distinct per gateway — collapsing all of these to "Bank Transfer" (the
  // old behavior) erased which gateway actually paid, defeating the point
  // of an audit trail.
  assert.equal(zohoPaymentModeFor("COD"), "Cash on Delivery");
  assert.equal(zohoPaymentModeFor("Stripe"), "Stripe");
  assert.equal(zohoPaymentModeFor("Tabby"), "Tabby");
  assert.equal(zohoPaymentModeFor("Tamara"), "Tamara");
  assert.equal(zohoPaymentModeFor("Checkout.com"), "Checkout.com");
});

test("zohoPaymentModeFor: unknown gateway falls back to Bank Transfer", () => {
  assert.equal(zohoPaymentModeFor("Unclassified"), "Bank Transfer");
});
