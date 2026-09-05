import { test } from "node:test";
import assert from "node:assert/strict";
import { gatewayFilterOptionsFromZohoAccounts, regionForLine } from "@/lib/reconciliation/gateway-filter";

test("gatewayFilterOptionsFromZohoAccounts: maps the founder's real Zoho account names to gateway+region, in the requested order", () => {
  const accounts = [
    { account_name: "TABBY AED", account_type: "payment_clearing" },
    { account_name: "TABBY KSA", account_type: "payment_clearing" },
    { account_name: "TABBY KWD", account_type: "payment_clearing" },
    { account_name: "TAMARA KSA", account_type: "payment_clearing" },
    { account_name: "TAMARA", account_type: "payment_clearing" },
    { account_name: "Telr Gateway", account_type: "payment_clearing" },
    { account_name: "Stripe Payment getaway", account_type: "payment_clearing" },
    { account_name: "Shopify Payments", account_type: "payment_clearing" },
    // decoys that must NOT appear as filter options:
    { account_name: "Delivery Charges - Tabby", account_type: "cost_of_goods_sold" },
    { account_name: "Checkout - SAR", account_type: "payment_clearing" },
  ];

  const options = gatewayFilterOptionsFromZohoAccounts(accounts);
  const keys = options.map((o) => o.key);

  assert.deepEqual(
    keys,
    // "Checkout - SAR" is a real (if deliberately unused-for-posting) Zoho
    // account — see gateway-account-map.ts's own doc comment — so it legitimately
    // resolves to the KSA region bucket via its "sar" token, not "aed".
    ["tabby-aed", "tabby-ksa", "tabby-kwd", "tamara-ksa", "tamara-aed", "telr-aed", "stripe-aed", "shopify payments-aed", "checkout-ksa"],
  );
  assert.equal(options.find((o) => o.key === "tabby-ksa")!.gateway, "Tabby");
  assert.equal(options.find((o) => o.key === "tabby-ksa")!.region, "KSA");
  assert.equal(options.find((o) => o.key === "tamara-aed")!.region, null);
  // the cost/expense decoy is excluded — same rule gateway-account-map.ts uses
  assert.equal(options.some((o) => o.label === "Delivery Charges - Tabby"), false);
});

test("regionForLine: maps payout currency to the same region codes gateway-account-map.ts posts against", () => {
  assert.equal(regionForLine({ payout: { currency: "SAR" } }), "KSA");
  assert.equal(regionForLine({ payout: { currency: "KWD" } }), "KWD");
  assert.equal(regionForLine({ payout: { currency: "OMR" } }), "OMR");
  assert.equal(regionForLine({ payout: { currency: "AED" } }), null);
  assert.equal(regionForLine({ payout: null }), null);
});
