import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSalesByCountry, normalizeCity, type GeoOrderInput } from "@/lib/orders/sales-by-country";

const o = (p: Partial<GeoOrderInput>): GeoOrderInput => ({
  store_id: "UAE",
  financial_status: "paid",
  gateway: "STRIPE",
  gross_aed: 100,
  order_date: "2026-09-10T08:00:00",
  country: "AE",
  city: "Dubai",
  ...p,
});

const RANGE = { fromDay: "2026-09-01", toDay: "2026-09-30" };

test("groups counted sales by country, biggest first, with shares", () => {
  const r = computeSalesByCountry(
    [o({}), o({ gross_aed: 300, country: "sa", city: "Riyadh", store_id: "KSA" }), o({ gross_aed: 50 })],
    RANGE,
  );
  assert.deepEqual(r.total, { orders: 3, soldAed: 450 });
  assert.deepEqual(r.countries.map((c) => c.country), ["SA", "AE"]);
  assert.equal(r.countries[0].share, 300 / 450);
  assert.deepEqual(r.countries[1].byStore, { UAE: 150 });
});

test("uses the sale rule and the Dubai calendar like the ledger", () => {
  const r = computeSalesByCountry(
    [
      o({ financial_status: "refunded" }),
      o({ store_id: "UAE", financial_status: "pending", gateway: "STRIPE" }), // not a sale
      o({ store_id: "WA", financial_status: "pending", gateway: "STRIPE" }), // prepaid WA counts
      o({ order_date: "2026-08-31T20:30:00" }), // 00:30 Dubai on Sep 1 → in range
      o({ order_date: "2026-09-30T20:30:00" }), // Oct 1 in Dubai → out
    ],
    RANGE,
  );
  assert.equal(r.total.orders, 2);
});

test("blank or malformed countries are unknown, never placed on the map", () => {
  const r = computeSalesByCountry([o({ country: "" }), o({ country: "United Arab Emirates" }), o({})], RANGE);
  assert.deepEqual(r.unknown, { orders: 2, soldAed: 200 });
  assert.equal(r.countries.length, 1);
  assert.equal(r.total.soldAed, 300);
});

test("city spellings and Arabic names merge; unknown non-Latin names are kept", () => {
  assert.equal(normalizeCity(" DUBAI "), "Dubai");
  assert.equal(normalizeCity("abu  dhabi"), "Abu Dhabi");
  assert.equal(normalizeCity("الرياض"), "Riyadh");
  assert.equal(normalizeCity("صلالة"), "Salalah");
  assert.equal(normalizeCity("أبوظبي"), "Abu Dhabi");
  assert.equal(normalizeCity("بني هاجر"), "بني هاجر");
  assert.equal(normalizeCity(""), "Unknown city");
  const r = computeSalesByCountry([o({ city: "dubai" }), o({ city: "Dubai " }), o({ city: "Sharjah", gross_aed: 500 })], RANGE);
  assert.deepEqual(r.countries[0].cities, [
    { city: "Sharjah", orders: 1, soldAed: 500 },
    { city: "Dubai", orders: 2, soldAed: 200 },
  ]);
});
