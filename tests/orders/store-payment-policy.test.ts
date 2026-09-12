import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isCashOnDelivery,
  resolveFinancialStatus,
  PREPAID_AT_CREATION_STORES,
} from "@/lib/orders/store-payment-policy";

const wa = (reportedStatus: string, gateway = "Stripe") =>
  resolveFinancialStatus({ storeId: "WA", reportedStatus, gateway });

test("WA is the only storefront that takes payment before the order exists", () => {
  assert.deepEqual([...PREPAID_AT_CREATION_STORES], ["WA"]);
});

test("WA: the store's permanent pending is replaced with paid", () => {
  assert.equal(wa("PENDING"), "paid");
  assert.equal(wa("pending"), "paid");
  assert.equal(wa(""), "paid");
  assert.equal(wa("unpaid"), "paid");
  assert.equal(wa("authorized"), "paid");
});

test("WA: every prepaid gateway counts, not just Stripe", () => {
  for (const gw of ["Stripe", "Tabby", "Tamara", "Telr", "Unclassified", ""]) {
    assert.equal(wa("pending", gw), "paid", `${gw || "(none)"} should count as paid`);
  }
});

test("WA: a reversal always wins — the store genuinely knows about those", () => {
  assert.equal(wa("refunded"), "refunded");
  assert.equal(wa("partially_refunded"), "partially_refunded");
  assert.equal(wa("voided"), "voided");
  assert.equal(wa("cancelled"), "cancelled");
});

test("WA: paid stays paid", () => {
  assert.equal(wa("paid"), "paid");
});

// Cash on Delivery is the one WA case where the money genuinely has not arrived
// when the order is created — the courier collects it. Counting it as revenue
// up front would overstate Gross Sales.
test("WA: COD is left at the store's status, because nobody has been paid yet", () => {
  assert.equal(wa("pending", "COD"), "pending");
  assert.equal(wa("", "COD"), "");
});

test("WA: a COD order the store reports as paid is still paid", () => {
  assert.equal(wa("paid", "COD"), "paid");
});

test("isCashOnDelivery matches the classifier's COD label, case-insensitively", () => {
  assert.equal(isCashOnDelivery("COD"), true);
  assert.equal(isCashOnDelivery("cod"), true);
  assert.equal(isCashOnDelivery(" COD "), true);
  assert.equal(isCashOnDelivery("Stripe"), false);
  assert.equal(isCashOnDelivery(null), false);
});

test("the storefronts that watch their own checkout are reported verbatim", () => {
  for (const store of ["UAE", "KSA", "WOO"]) {
    for (const status of ["pending", "paid", "refunded", "voided", ""]) {
      assert.equal(
        resolveFinancialStatus({ storeId: store, reportedStatus: status, gateway: "Stripe" }),
        status,
        `${store}/${status} must pass through untouched`,
      );
    }
  }
});

test("status is normalised to lower case whatever the store sends", () => {
  assert.equal(resolveFinancialStatus({ storeId: "UAE", reportedStatus: "PAID", gateway: "x" }), "paid");
  assert.equal(resolveFinancialStatus({ storeId: "UAE", reportedStatus: "  Refunded ", gateway: "x" }), "refunded");
});
