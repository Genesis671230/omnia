import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCourierLanes, buildPulse, sumStoreFunnels, type CcOrder } from "../../lib/dashboard/command-center";

const o = (n: string, country: string, day: string, gross = 100, extra: Partial<CcOrder> = {}): CcOrder => ({
  order_number: n, country, order_date: `${day}T08:00:00`, gross_aed: gross, financial_status: "paid", store_id: "MAIN", gateway: "Stripe", ...extra,
});

test("UAE orders go by road (OnTrack), the rest by air (SMSA); fees only from courier vouchers", () => {
  const lanes = buildCourierLanes({
    orders: [o("A1", "AE", "2026-09-20", 786, { gateway: "COD", financial_status: "pending" }), o("A2", "AE", "2026-09-20"), o("S1", "SA", "2026-09-21"), o("X", "SA", "2026-09-21", 100, { financial_status: "refunded" })],
    fromDay: "2026-09-20", toDay: "2026-09-21",
    sheet: { road: new Set(), air: new Set(["S1"]) },
    roadFees: new Map([["A1", 30]]),
  });
  const [road, air] = lanes;
  assert.equal(road.orders, 2);
  assert.equal(road.feesAed, 30);
  assert.equal(road.feeOrders, 1);
  assert.equal(road.logged, 0);
  assert.deepEqual(road.daily.map((d) => d.orders), [2, 0]);
  assert.equal(air.orders, 1); // the refunded order isn't a sale
  assert.equal(air.logged, 1);
  assert.equal(air.feesAed, null); // no SMSA charges uploaded — unknown, not zero
});

test("an unreadable dispatch sheet is reported, not counted as zero logged", () => {
  const [road] = buildCourierLanes({ orders: [o("A", "AE", "2026-09-20")], fromDay: "2026-09-20", toDay: "2026-09-20", sheet: { road: null, air: null }, roadFees: new Map() });
  assert.equal(road.logged, -1);
});

test("store funnels sum only the sites that report one", () => {
  const f = sumStoreFunnels([
    ["MAIN", { status: "ok", totals: { sessions: 1000, addedToCart: 80, reachedCheckout: 40, completed: 20 }, daily: [], sources: [] }],
    ["UAE", { status: "missing_scope", message: "needs read_reports" }],
  ]);
  assert.equal(f.sessions, 1000);
  assert.deepEqual(f.sites, ["MAIN"]);
  assert.equal(f.missing[0].site, "UAE");
});

test("pulse: today, yesterday and month to date against the same days last month", () => {
  const p = buildPulse([o("1", "AE", "2026-10-01", 500), o("2", "AE", "2026-09-30", 300), o("3", "AE", "2026-09-01", 400)],
    "2026-10-01", "2026-10-01", "2026-09-01", "2026-09-01", "2026-09-30");
  assert.equal(p.today.salesAed, 500);
  assert.equal(p.yesterday.salesAed, 300);
  assert.equal(p.mtd.prevSalesAed, 400);
  assert.equal(p.mtd.change, 25);
});
