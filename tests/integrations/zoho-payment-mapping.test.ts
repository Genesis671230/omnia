import { test } from "node:test";
import assert from "node:assert/strict";
import { zohoPaymentModeFor } from "@/lib/integrations/zoho";

test("zohoPaymentModeFor: maps known gateways to Zoho payment modes", () => {
  assert.equal(zohoPaymentModeFor("Stripe"), "Bank Transfer");
  assert.equal(zohoPaymentModeFor("COD"), "Cash on Delivery");
  assert.equal(zohoPaymentModeFor("Tabby"), "Bank Transfer");
  assert.equal(zohoPaymentModeFor("Tamara"), "Bank Transfer");
});

test("zohoPaymentModeFor: unknown gateway falls back to Bank Transfer", () => {
  assert.equal(zohoPaymentModeFor("Unclassified"), "Bank Transfer");
});
