import { test } from "node:test";
import assert from "node:assert/strict";
import { zohoPaymentModeFor } from "@/lib/integrations/zoho";

test("zohoPaymentModeFor: COD is Cash on Delivery, case-insensitively", () => {
  assert.equal(zohoPaymentModeFor("COD"), "Cash on Delivery");
  assert.equal(zohoPaymentModeFor("cod"), "Cash on Delivery");
});

test("zohoPaymentModeFor: every other gateway is Credit Card", () => {
  // Collapsed deliberately: this Zoho org's payment_mode picklist is Credit
  // Card / Cash on Delivery, not one custom mode per gateway. Which gateway
  // actually paid is still recorded on our side, in settlement_records.gateway
  // — the audit trail doesn't depend on Zoho's own payment_mode field.
  assert.equal(zohoPaymentModeFor("Stripe"), "Credit Card");
  assert.equal(zohoPaymentModeFor("Tabby"), "Credit Card");
  assert.equal(zohoPaymentModeFor("Tamara"), "Credit Card");
  assert.equal(zohoPaymentModeFor("Checkout.com"), "Credit Card");
  assert.equal(zohoPaymentModeFor("Unclassified"), "Credit Card");
});
