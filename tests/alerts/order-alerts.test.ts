import { test } from "node:test";
import assert from "node:assert/strict";
import { formatOrderAlert, courierStatus } from "@/lib/alerts/order-alerts";
import type { OrderRow } from "@/lib/normalize/order";

function makeOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "KSA_1", tenant_id: "omnia", uid: "KSA_1", store_id: "KSA", order_id: "1",
    order_number: "1001", order_date: "2026-08-07T00:00:00Z",
    currency: "SAR", gross_original: 375, gross_aed: 375 * 0.98,
    subtotal_aed: 0, shipping_aed: 0, tax_aed: 0, discount_aed: 0,
    gateway: "COD", gateway_raw: "Cash on Delivery (COD)",
    telr_cartid: "", telr_tranref: "",
    shipping_address1: "", shipping_address2: "", shipping_state: "", shipping_postcode: "", shipping_company: "",
    billing_address1: "", billing_address2: "", billing_state: "", billing_postcode: "", billing_company: "",
    financial_status: "pending", fulfillment_status: "unfulfilled",
    city: "Riyadh", country: "SA",
    customer_name: "Jane Doe", customer_email: "jane@example.com", customer_phone: "0501234567",
    customer_id: "email:jane@example.com", source: "shopify", payout_status: "awaiting",
    updated_at: "2026-08-07T00:00:00Z",
    line_items: [{ title: "Rose Oud 100ml", sku: "OUD-100", qty: 2, total_aed: 100, image_url: "", stock: 5 }],
    courier: "", tracking_number: "", tracking_url: "",
    ...overrides,
  };
}

test("formats store, order number, gateway, customer, and location", () => {
  const text = formatOrderAlert(makeOrder(), new Map());
  assert.match(text, /Shopify KSA/);
  assert.match(text, /#1001/);
  assert.match(text, /COD/);
  assert.match(text, /Jane Doe/);
  assert.match(text, /Riyadh, SA/);
});

test("shows AED plus original currency when not AED", () => {
  const text = formatOrderAlert(makeOrder({ currency: "SAR", gross_aed: 367.5, gross_original: 375 }), new Map());
  assert.match(text, /367\.50 AED \(375\.00 SAR\)/);
});

test("omits the original-currency aside when currency is already AED", () => {
  const text = formatOrderAlert(makeOrder({ currency: "AED", gross_aed: 100, gross_original: 100 }), new Map());
  assert.match(text, /100\.00 AED/);
  assert.doesNotMatch(text, /\(100\.00 AED\)/);
});

test("uses live Shopify stock on the line item when present", () => {
  const text = formatOrderAlert(makeOrder(), new Map());
  assert.match(text, /Rose Oud 100ml x2 — 5 left/);
});

test("falls back to Zoho-synced stock when the line item has no live stock (Woo)", () => {
  const order = makeOrder({
    line_items: [{ title: "Amber Musk 50ml", sku: "AMB-50", qty: 1, total_aed: 50, image_url: "", stock: null }],
  });
  const text = formatOrderAlert(order, new Map([["AMB-50", 12]]));
  assert.match(text, /Amber Musk 50ml x1 — 12 left/);
});

test("flags zero stock and unknown stock distinctly", () => {
  const order = makeOrder({
    line_items: [
      { title: "Out of Stock Item", sku: "OOS-1", qty: 1, total_aed: 10, image_url: "", stock: 0 },
      { title: "Unmapped Item", sku: "", qty: 1, total_aed: 10, image_url: "", stock: null },
    ],
  });
  const text = formatOrderAlert(order, new Map());
  assert.match(text, /Out of Stock Item x1 — OUT OF STOCK/);
  assert.match(text, /Unmapped Item x1 — stock unknown/);
});

test("escapes HTML-significant characters (Telegram uses parse_mode HTML)", () => {
  const order = makeOrder({
    customer_name: "A & B <Co>",
    line_items: [{ title: "Item <script>", sku: "X", qty: 1, total_aed: 10, image_url: "", stock: 1 }],
  });
  const text = formatOrderAlert(order, new Map());
  assert.match(text, /A &amp; B &lt;Co&gt;/);
  assert.match(text, /Item &lt;script&gt;/);
  assert.doesNotMatch(text, /<script>/);
});

test("local (AE) order before 8:30pm Dubai time ships OnTrack tonight", () => {
  const status = courierStatus(makeOrder({ country: "AE", order_date: "2026-08-07T16:00:00Z" })); // 8:00pm Dubai
  assert.match(status, /OnTrack \(local\)/);
  assert.match(status, /out for pickup tonight/);
  assert.match(status, /@Sinan/);
});

test("local (AE) order after 8:30pm Dubai time holds for tomorrow's OnTrack", () => {
  const status = courierStatus(makeOrder({ country: "AE", order_date: "2026-08-07T17:00:00Z" })); // 9:00pm Dubai
  assert.match(status, /held for tomorrow/);
  assert.match(status, /@Sinan/);
});

test("international order before 1pm Dubai time ships SMSA/DHL today", () => {
  const status = courierStatus(makeOrder({ country: "SA", order_date: "2026-08-07T08:00:00Z" })); // 12:00pm Dubai
  assert.match(status, /SMSA\/DHL \(international\)/);
  assert.match(status, /out with courier today/);
  assert.match(status, /@Yaseen/);
});

test("international order after 1pm Dubai time holds for tomorrow's SMSA/DHL pickup", () => {
  const status = courierStatus(makeOrder({ country: "SA", order_date: "2026-08-07T10:00:00Z" })); // 2:00pm Dubai
  assert.match(status, /past 1pm cutoff/);
  assert.match(status, /@Yaseen/);
});
