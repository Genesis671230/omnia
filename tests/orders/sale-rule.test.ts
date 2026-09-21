import { test } from "node:test";
import assert from "node:assert/strict";
import { isCountedSale } from "@/lib/orders/sale-rule";

const o = (store_id: string, financial_status: string, gateway = "Stripe", gross_aed = 100) =>
  ({ store_id, financial_status, gateway, gross_aed });

test("matches the founder's reference rule store by store", () => {
  // every store: total > 0, never reversed
  assert.equal(isCountedSale(o("UAE", "paid", "Stripe", 0)), false);
  for (const s of ["UAE", "KSA", "WA", "WOO"]) {
    for (const st of ["refunded", "cancelled", "voided"]) assert.equal(isCountedSale(o(s, st)), false, `${s} ${st}`);
  }
  // WooCommerce: everything but pending / failed
  assert.equal(isCountedSale(o("WOO", "paid")), true);
  assert.equal(isCountedSale(o("WOO", "on-hold")), true);
  assert.equal(isCountedSale(o("WOO", "pending", "COD")), false);
  assert.equal(isCountedSale(o("WOO", "failed")), false);
  // Shopify UAE / KSA: paid, partially paid, or pending COD
  assert.equal(isCountedSale(o("UAE", "partially_paid", "Tabby")), true);
  assert.equal(isCountedSale(o("KSA", "pending", "COD")), true);
  assert.equal(isCountedSale(o("KSA", "pending", "Tabby")), false);
  assert.equal(isCountedSale(o("KSA", "partially_refunded", "Shopify Payments")), false);
  // Shopify WA: pending on any method is a prepaid sale
  assert.equal(isCountedSale(o("WA", "pending", "Stripe")), true);
  assert.equal(isCountedSale(o("WA", "pending", "COD")), true);
});
