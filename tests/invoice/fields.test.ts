import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectInvoiceTemplate, isPaidOrder, ontrackPrefill, intlPrefill,
  PAID_SHIPPING_AED, type OrderForInvoice,
} from "@/lib/invoice-fields";

const baseOrder: OrderForInvoice = {
  order_number: "3671",
  order_date: "2026-07-17T00:00:00Z",
  customer_name: "Abdul Wahid",
  customer_email: "zya@example.com",
  customer_phone: "00966568578818",
  city: "Riyadh",
  country: "SA",
  gateway: "Stripe",
  financial_status: "paid",
  gross_aed: 100,
  currency: "SAR",
};

test("selectInvoiceTemplate: AE → ontrack, everywhere else → intl", () => {
  assert.equal(selectInvoiceTemplate("AE"), "ontrack");
  assert.equal(selectInvoiceTemplate(" ae "), "ontrack");
  assert.equal(selectInvoiceTemplate("SA"), "intl");
  assert.equal(selectInvoiceTemplate("KW"), "intl");
  assert.equal(selectInvoiceTemplate(""), "intl");
});

test("isPaidOrder: online paid true, COD false, unpaid/pending/refunded false", () => {
  assert.equal(isPaidOrder({ gateway: "Stripe", financial_status: "paid" }), true);
  assert.equal(isPaidOrder({ gateway: "COD" }), false);
  assert.equal(isPaidOrder({ gateway: "Stripe", financial_status: "pending" }), false);
  assert.equal(isPaidOrder({ gateway: "Stripe", financial_status: "refunded" }), false);
  assert.equal(isPaidOrder({ gateway: "Stripe" }), true); // no status = assume collected
});

test("ontrackPrefill: paid order gets PAID remarks/total and AED 30 shipping", () => {
  const f = ontrackPrefill({ ...baseOrder, gateway: "Stripe", financial_status: "paid", gross_aed: 954 });
  assert.equal(f.remarks, "PAID");
  assert.equal(f.totalLabel, "PAID");
  assert.equal(f.shipping, PAID_SHIPPING_AED);
  assert.equal(f.orderValue, 954);
  assert.equal(f.total, 954 + PAID_SHIPPING_AED);
  assert.equal(f.paid, "Yes");
});

test("ontrackPrefill: COD order is not marked paid (no PAID total, no auto shipping)", () => {
  const f = ontrackPrefill({ ...baseOrder, gateway: "COD" });
  assert.equal(f.remarks, "");
  assert.equal(f.totalLabel, undefined);
  assert.equal(f.shipping, 0);
  assert.equal(f.paid, "COD");
});

test("intlPrefill: maps line items to rows with unit price = total/qty, item # = order number", () => {
  const f = intlPrefill(baseOrder, [
    { title: "Necklace Set", qty: 2, total_aed: 200 },
    { title: "Ring", qty: 1, total_aed: 50 },
  ]);
  assert.equal(f.items.length, 2);
  assert.equal(f.items[0].itemNo, "3671");
  assert.equal(f.items[0].unitPrice, 100); // 200 / 2
  assert.match(f.items[0].description, /Necklace Set/);
  assert.match(f.items[0].description, /Made in China/);
  assert.equal(f.items[1].unitPrice, 50);
  assert.equal(f.customerId, "#SA3671");
  assert.equal(f.currency, "AED");
  assert.equal(f.email, "zya@example.com");
});

test("intlPrefill: no line items → single fallback summary line at order value", () => {
  const f = intlPrefill({ ...baseOrder, gross_aed: 954 }, []);
  assert.equal(f.items.length, 1);
  assert.equal(f.items[0].qty, 1);
  assert.equal(f.items[0].unitPrice, 954);
  assert.match(f.items[0].description, /Order #3671/);
});
