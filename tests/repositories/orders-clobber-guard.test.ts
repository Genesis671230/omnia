import { test } from "node:test";
import assert from "node:assert/strict";
import { dropClobberRiskFields } from "@/lib/orders-clobber-guard";
import type { OrderRow } from "@/lib/normalize/order";

function makeRow(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "KSA_1",
    tenant_id: "omnia",
    uid: "KSA_1",
    store_id: "KSA",
    order_id: "1",
    order_number: "1001",
    order_date: "2026-01-01T00:00:00Z",
    currency: "SAR",
    gross_original: 100,
    gross_aed: 98,
    subtotal_aed: 90,
    shipping_aed: 5,
    tax_aed: 3,
    discount_aed: 0,
    gateway: "COD",
    gateway_raw: "COD",
    telr_cartid: "",
    telr_tranref: "",
    financial_status: "paid",
    fulfillment_status: "unfulfilled",
    city: "Riyadh",
    country: "SA",
    customer_name: "Test Customer",
    customer_email: "test@example.com",
    customer_phone: "0500000000",
    customer_id: "email:test@example.com",
    source: "shopify",
    payout_status: "awaiting",
    updated_at: "2026-01-01T00:00:00Z",
    line_items: [],
    courier: "Aramex", // store's own raw shipping label
    tracking_number: "STORE-123",
    tracking_url: "https://track.example/STORE-123",
    ...overrides,
  };
}

test("dropClobberRiskFields: strips payout_status for every row regardless of shipped state", () => {
  const row = makeRow();
  const result = dropClobberRiskFields(row, new Set());
  assert.ok(!("payout_status" in result));
});

test("dropClobberRiskFields: keeps courier/tracking when the order hasn't been shipped via our own pipeline", () => {
  const row = makeRow();
  const result = dropClobberRiskFields(row, new Set()); // uid not in shippedUids
  assert.ok("courier" in result, "courier should be part of the upsert payload for a not-yet-shipped order");
  assert.equal(result.courier, "Aramex");
  assert.equal(result.tracking_number, "STORE-123");
  assert.equal(result.tracking_url, "https://track.example/STORE-123");
});

test("dropClobberRiskFields: drops courier/tracking_number/tracking_url when awb_number already exists for this uid", () => {
  const row = makeRow({ uid: "KSA_2" });
  const result = dropClobberRiskFields(row, new Set(["KSA_2"]));
  assert.ok(!("courier" in result), "courier must not be part of the upsert payload for a shipped order");
  assert.ok(!("tracking_number" in result));
  assert.ok(!("tracking_url" in result));
  // everything else still present
  assert.equal(result.order_number, "1001");
  assert.equal(result.gross_aed, 98);
});

test("dropClobberRiskFields: only affects the specific uid marked as shipped, not others in the same batch", () => {
  const shipped = makeRow({ uid: "KSA_3" });
  const notShipped = makeRow({ uid: "KSA_4" });
  const shippedUids = new Set(["KSA_3"]);

  const shippedResult = dropClobberRiskFields(shipped, shippedUids);
  const notShippedResult = dropClobberRiskFields(notShipped, shippedUids);

  assert.ok(!("courier" in shippedResult));
  assert.ok("courier" in notShippedResult);
  assert.equal(notShippedResult.courier, "Aramex");
});
