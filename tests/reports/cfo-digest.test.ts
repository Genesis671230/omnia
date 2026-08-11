import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFinancialReport, dubaiDayBoundsUtc, dubaiRangeBoundsUtc, computeMonthEndForecast, formatTrendLine } from "@/lib/reports/cfo-digest";
import type { OrderRowRaw } from "@/lib/repositories/orders.repository";

function makeOrder(overrides: Partial<OrderRowRaw> = {}): OrderRowRaw {
  return {
    uid: "KSA_1", store_id: "KSA", order_number: "1001", order_date: "2026-08-07T08:00:00Z",
    customer_name: "Jane Doe", customer_email: "jane@example.com", customer_phone: "0501234567",
    customer_id: "email:jane@example.com",
    shipping_address1: "", shipping_address2: "", shipping_state: "", shipping_postcode: "", shipping_company: "",
    billing_address1: "", billing_address2: "", billing_state: "", billing_postcode: "", billing_company: "",
    city: "Riyadh", country: "SA", currency: "SAR", gross_original: 100, gross_aed: 100,
    gateway: "COD", gateway_raw: "COD", financial_status: "paid", fulfillment_status: "unfulfilled",
    telr_cartid: "", telr_tranref: "", payout_id: null, payout_status: "awaiting",
    line_items: [{ title: "Rose Oud", sku: "OUD-100", qty: 1, total_aed: 100, image_url: "", stock: 5 }],
    courier: "", tracking_number: "", tracking_url: "",
    fulfillment_stage: "", fulfillment_stage_updated_at: null,
    awb_number: "", shipped_at: null, label_url: "", ship_error: "",
    ...overrides,
  };
}

test("dubaiDayBoundsUtc: a Dubai calendar day is UTC 20:00 the prior day to UTC 20:00", () => {
  const { fromUtc, toUtc } = dubaiDayBoundsUtc("2026-08-07");
  assert.equal(fromUtc, "2026-08-06T20:00:00.000Z");
  assert.equal(toUtc, "2026-08-07T20:00:00.000Z");
});

test("dubaiRangeBoundsUtc spans multiple Dubai days inclusively", () => {
  const { fromUtc, toUtc } = dubaiRangeBoundsUtc("2026-08-01", "2026-08-07");
  assert.equal(fromUtc, "2026-07-31T20:00:00.000Z");
  assert.equal(toUtc, "2026-08-07T20:00:00.000Z");
});

test("totalOrders counts every order regardless of status; paidOrders/revenue only count financial_status=paid", () => {
  const rows = [
    makeOrder({ uid: "A", gross_aed: 100, financial_status: "paid" }),
    makeOrder({ uid: "B", gross_aed: 999, financial_status: "pending" }),
    makeOrder({ uid: "C", gross_aed: 999, financial_status: "cancelled" }),
    makeOrder({ uid: "D", gross_aed: 999, financial_status: "failed" }),
  ];
  const report = computeFinancialReport("2026-08-07", "2026-08-07", rows, new Map());
  assert.equal(report.totalOrders, 4);
  assert.equal(report.paidOrders, 1);
  assert.equal(report.revenueAed, 100);
});

test("byStatus breaks down every order (not just paid) by financial_status", () => {
  const rows = [
    makeOrder({ uid: "A", financial_status: "paid" }),
    makeOrder({ uid: "B", financial_status: "paid" }),
    makeOrder({ uid: "C", financial_status: "pending" }),
  ];
  const report = computeFinancialReport("2026-08-07", "2026-08-07", rows, new Map());
  assert.deepEqual(report.byStatus, [
    { status: "paid", orders: 2 },
    { status: "pending", orders: 1 },
  ]);
});

test("computes COGS from purchase_rate x qty on paid orders only, and profit as revenue minus COGS", () => {
  const rows = [
    makeOrder({
      uid: "A", gross_aed: 100, financial_status: "paid",
      line_items: [{ title: "Rose Oud", sku: "OUD-100", qty: 3, total_aed: 100, image_url: "", stock: 5 }],
    }),
    makeOrder({
      uid: "B", gross_aed: 500, financial_status: "pending",
      line_items: [{ title: "Rose Oud", sku: "OUD-100", qty: 100, total_aed: 500, image_url: "", stock: 5 }],
    }),
  ];
  const report = computeFinancialReport("2026-08-07", "2026-08-07", rows, new Map([["OUD-100", 10]]));
  assert.equal(report.cogsAed, 30); // only the paid order's 3 units count
  assert.equal(report.profitAed, 70);
  assert.equal(report.marginPct, 70);
});

test("line items with no zoho sku match are excluded from COGS and counted as unmatched", () => {
  const rows = [
    makeOrder({
      uid: "A", gross_aed: 100, financial_status: "paid",
      line_items: [{ title: "Mystery Item", sku: "UNKNOWN", qty: 1, total_aed: 100, image_url: "", stock: null }],
    }),
  ];
  const report = computeFinancialReport("2026-08-07", "2026-08-07", rows, new Map());
  assert.equal(report.cogsAed, 0);
  assert.equal(report.unmatchedLineItems, 1);
  assert.equal(report.profitAed, 100);
});

test("marginPct is null (not 0) when paid revenue is zero", () => {
  const report = computeFinancialReport("2026-08-07", "2026-08-07", [], new Map());
  assert.equal(report.revenueAed, 0);
  assert.equal(report.marginPct, null);
});

test("groups paid revenue and paid order count by store, sorted by revenue descending", () => {
  const rows = [
    makeOrder({ uid: "A", store_id: "KSA", gross_aed: 50, financial_status: "paid" }),
    makeOrder({ uid: "B", store_id: "UAE", gross_aed: 200, financial_status: "paid" }),
    makeOrder({ uid: "C", store_id: "KSA", gross_aed: 50, financial_status: "paid" }),
    makeOrder({ uid: "D", store_id: "UAE", gross_aed: 999, financial_status: "cancelled" }),
  ];
  const report = computeFinancialReport("2026-08-07", "2026-08-07", rows, new Map());
  assert.deepEqual(report.byStore, [
    { store: "UAE", paidOrders: 1, revenueAed: 200 },
    { store: "KSA", paidOrders: 2, revenueAed: 100 },
  ]);
});

test("computeMonthEndForecast: projects month-end revenue at the same daily pace as month-to-date", () => {
  // 1000 AED over 10 days of a 30-day month -> 100/day pace -> 3000 for the month
  assert.equal(computeMonthEndForecast(1000, 10, 30), 3000);
});

test("computeMonthEndForecast: day 1 of the month just returns that day's pace times days in month", () => {
  assert.equal(computeMonthEndForecast(50, 1, 30), 1500);
});

test("computeMonthEndForecast: zero MTD revenue forecasts zero, not NaN/Infinity", () => {
  assert.equal(computeMonthEndForecast(0, 15, 30), 0);
});

test("computeMonthEndForecast: dayOfMonth of 0 (guard) returns 0 rather than dividing by zero", () => {
  assert.equal(computeMonthEndForecast(500, 0, 30), 0);
});

test("formatTrendLine: null yesterday revenue means no comparison is possible", () => {
  assert.equal(formatTrendLine(500, null), null);
});

test("formatTrendLine: a meaningful increase gets the up arrow and a positive percentage", () => {
  const line = formatTrendLine(150, 100);
  assert.match(line!, /^📈/);
  assert.match(line!, /\+50%/);
});

test("formatTrendLine: a meaningful decrease gets the down arrow and a negative percentage", () => {
  const line = formatTrendLine(50, 100);
  assert.match(line!, /^📉/);
  assert.match(line!, /-50%/);
});

test("formatTrendLine: a flat day (within ±1%) gets the neutral arrow, not up or down", () => {
  const line = formatTrendLine(100.5, 100);
  assert.match(line!, /^➡️/);
});

test("formatTrendLine: yesterday being exactly zero doesn't divide by zero", () => {
  assert.equal(formatTrendLine(0, 0), null);
  const line = formatTrendLine(50, 0);
  assert.match(line!, /zero paid revenue/);
});
