import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrdersAnalytics, type AnalyticsAdRow } from "@/lib/orders/orders-analytics";

const range = { fromDay: "2026-09-24", toDay: "2026-09-30", prevFromDay: "2026-09-17", prevToDay: "2026-09-23" };
// order_date is offset-less UTC; 20:30Z on the 23rd is 00:30 on the 24th in Dubai.
const order = (store_id: string, order_date: string, gross_aed: number, financial_status = "paid", gateway = "Tabby") =>
  ({ store_id, order_date, gross_aed, financial_status, gateway });
const ad = (store_id: string, date: string, spend: number, extra: Partial<AnalyticsAdRow> = {}): AnalyticsAdRow => ({
  platform: "meta", store_id, campaign_id: "meta:1", campaign_name: "Adv+", date, spend, value: spend * 5,
  impressions: 1000, clicks: 40, purchases: 2, landing_page_views: 30, view_content: 50, add_to_cart: 6, initiate_checkout: 3, ...extra,
});

test("omniastores.com keeps its WooCommerce history and ad account under Shopify Main", () => {
  const a = buildOrdersAnalytics({
    ...range,
    orders: [order("MAIN", "2026-09-25T10:00:00", 1000), order("WOO", "2026-09-18T10:00:00", 400)],
    ads: [ad("WOO", "2026-09-25", 200)],
  });
  const main = a.sites.find((s) => s.code === "MAIN")!;
  assert.equal(main.revenue, 1000);
  assert.equal(main.prev.revenue, 400);
  assert.equal(main.adsTotal.spend, 200);
  assert.equal(main.adsTotal.pixelRoas, 5);
  assert.equal(main.salesRoas, 5);
  assert.deepEqual(main.topCampaigns.map((c) => c.name), ["Adv+"]);
});

test("the sale rule decides what counts; reversed orders are counted as cancelled", () => {
  const a = buildOrdersAnalytics({
    ...range,
    orders: [
      order("UAE", "2026-09-25T10:00:00", 500),
      order("UAE", "2026-09-25T11:00:00", 300, "refunded"),
      order("UAE", "2026-09-25T12:00:00", 200, "pending", "Tabby"), // pending, not COD → not a sale on UAE
      order("UAE", "2026-09-25T13:00:00", 250, "pending", "COD"),
    ],
    ads: [],
  });
  const uae = a.sites.find((s) => s.code === "UAE")!;
  assert.equal(uae.orders, 2);
  assert.equal(uae.revenue, 750);
  assert.equal(uae.cancelled, 1);
  assert.equal(uae.salesRoas, null);
});

test("orders land on their Dubai day; the daily series spans the whole range", () => {
  const a = buildOrdersAnalytics({ ...range, orders: [order("WA", "2026-09-23T20:30:00", 90)], ads: [ad("WOO", "2026-09-17", 50)] });
  assert.equal(a.daily.length, 7);
  assert.equal(a.daily[0].day, "2026-09-24");
  assert.equal(a.daily[0].WA, 90);
  assert.equal(a.totals.revenue, 90);
  assert.equal(a.totals.adSpend, 0);
  assert.equal(a.totals.prev.adSpend, 50);
});

import { buildSalesInsights } from "@/lib/orders/orders-analytics";

test("top SKUs: counted sales only, trend against the period before", () => {
  const li = (sku: string, total_aed: number, qty = 1) => ({ sku, title: `Set ${sku}`, total_aed, qty, image_url: null, stock: 3 });
  const { topSkus } = buildSalesInsights({
    ...range,
    orders: [
      { ...order("MAIN", "2026-09-25T10:00:00", 900), line_items: [li("A", 900)] },
      { ...order("MAIN", "2026-09-26T10:00:00", 900), line_items: [li("A", 900)] },
      { ...order("MAIN", "2026-09-18T10:00:00", 1000), line_items: [li("A", 1000)] }, // previous period
      { ...order("WA", "2026-09-25T11:00:00", 400), line_items: [li("B", 400, 2)] },
      { ...order("WA", "2026-09-25T12:00:00", 5000, "refunded"), line_items: [li("C", 5000)] }, // not a sale
    ],
  });
  assert.deepEqual(topSkus.map((s) => [s.sku, s.units, s.revenue, s.trend]), [["A", 2, 1800, "rising"], ["B", 2, 400, "new"]]);
  assert.equal(topSkus[1].avgPrice, 200);
});

test("time of day: Dubai quarter-hours and the best 3-hour window", () => {
  // 17:00Z = 21:00 Dubai → slot 84
  const { timeOfDay } = buildSalesInsights({
    ...range,
    orders: [order("MAIN", "2026-09-25T17:00:00", 1000), order("MAIN", "2026-09-26T17:10:00", 500), order("MAIN", "2026-09-26T04:00:00", 100)],
  });
  assert.equal(timeOfDay.slots[84].revenue, 1500);
  assert.equal(timeOfDay.slots[84].label, "21:00");
  assert.ok(timeOfDay.peak.fromSlot <= 84 && timeOfDay.peak.toSlot >= 84);
  assert.equal(timeOfDay.peak.revenue, 1500);
  assert.equal(timeOfDay.peak.share, 0.94);
});
