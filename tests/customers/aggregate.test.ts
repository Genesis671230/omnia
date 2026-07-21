import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateCustomers, computeExpectedLtv } from "@/lib/customers/aggregate";
import type { OrderRowRaw } from "@/lib/repositories/orders.repository";

function makeOrder(overrides: Partial<OrderRowRaw> = {}): OrderRowRaw {
  return {
    uid: "KSA_1",
    store_id: "KSA",
    order_number: "1001",
    order_date: "2026-01-01T00:00:00Z",
    customer_name: "Jane Doe",
    customer_email: "jane@example.com",
    customer_phone: "0501234567",
    customer_id: "email:jane@example.com",
    city: "Riyadh",
    country: "SA",
    currency: "SAR",
    gross_original: 100,
    gross_aed: 100,
    gateway: "COD",
    gateway_raw: "COD",
    financial_status: "paid",
    fulfillment_status: "unfulfilled",
    telr_cartid: "",
    telr_tranref: "",
    payout_id: null,
    payout_status: "awaiting",
    line_items: [],
    courier: "",
    tracking_number: "",
    tracking_url: "",
    fulfillment_stage: "processing",
    fulfillment_stage_updated_at: null,
    awb_number: "",
    shipped_at: null,
    label_url: "",
    ship_error: "",
    ...overrides,
  };
}

test("aggregateCustomers: groups orders across stores by email into one customer", () => {
  const orders = [
    makeOrder({ uid: "KSA_1", store_id: "KSA", gross_aed: 100 }),
    makeOrder({ uid: "UAE_1", store_id: "UAE", gross_aed: 50 }),
  ];
  const { customers, unidentifiedCount } = aggregateCustomers(orders);
  assert.equal(unidentifiedCount, 0);
  assert.equal(customers.length, 1);
  const c = customers[0];
  assert.equal(c.id, "email:jane@example.com");
  assert.deepEqual(c.stores.sort(), ["KSA", "UAE"]);
  assert.equal(c.totalOrders, 2);
  assert.equal(c.totalSpendAed, 150);
  assert.equal(c.aov, 75);
});

test("aggregateCustomers: a cancelled order doesn't count toward totals but stays in the full order list", () => {
  const orders = [
    makeOrder({ uid: "KSA_1", gross_aed: 100, financial_status: "paid" }),
    makeOrder({ uid: "KSA_2", gross_aed: 999, financial_status: "cancelled" }),
  ];
  const { customers } = aggregateCustomers(orders);
  assert.equal(customers.length, 1);
  const c = customers[0];
  assert.equal(c.totalOrders, 1);
  assert.equal(c.totalSpendAed, 100);
  assert.equal(c.orders.length, 2, "cancelled order should still appear in the full orders list");
});

test("aggregateCustomers: orders with no email/phone/customer_id are counted as unidentified", () => {
  const orders = [makeOrder({ customer_id: null, customer_email: "", customer_phone: "" })];
  const { customers, unidentifiedCount } = aggregateCustomers(orders);
  assert.equal(customers.length, 0);
  assert.equal(unidentifiedCount, 1);
});

test("aggregateCustomers: falls back to live identity resolution when customer_id is null but email/phone exist", () => {
  const orders = [
    makeOrder({ uid: "KSA_1", customer_id: null, customer_email: "jane@example.com" }),
    makeOrder({ uid: "UAE_1", customer_id: "email:jane@example.com", customer_email: "jane@example.com" }),
  ];
  const { customers, unidentifiedCount } = aggregateCustomers(orders);
  assert.equal(unidentifiedCount, 0);
  assert.equal(customers.length, 1, "both rows should resolve to the same customer despite one having a null customer_id");
  assert.equal(customers[0].totalOrders, 2);
});

test("aggregateCustomers: expectedLtvNextYear matches computeExpectedLtv given the same inputs", () => {
  const orders = [
    makeOrder({ uid: "KSA_1", order_date: "2025-01-01T00:00:00Z", gross_aed: 100 }),
    makeOrder({ uid: "KSA_2", order_date: "2025-06-01T00:00:00Z", gross_aed: 200 }),
  ];
  const { customers } = aggregateCustomers(orders);
  const c = customers[0];
  const expected = computeExpectedLtv(c.totalSpendAed, c.firstOrderDate!, c.lastOrderDate!);
  assert.equal(c.expectedLtvNextYear, expected);
});

test("computeExpectedLtv: a customer quiet for over 180 days is decayed to 15% of run-rate", () => {
  const now = Date.now();
  const first = new Date(now - 400 * 24 * 60 * 60 * 1000).toISOString();
  const last = new Date(now - 200 * 24 * 60 * 60 * 1000).toISOString();
  const ltv = computeExpectedLtv(1200, first, last);
  // ~2 months active, spend 1200 -> run-rate 600/mo * 12 = 7200, decayed to 15%
  assert.ok(ltv > 0 && ltv < 1200, "decayed LTV should be well below naive run-rate");
});
