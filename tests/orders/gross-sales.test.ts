import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDailySeries,
  computeGrossSales,
  deltaPercent,
  type GrossSalesOrder,
} from "../../lib/orders/gross-sales";
import { addDubaiDays, dubaiDayKey, dubaiDayRange, dubaiToday } from "../../lib/dubai-day";
import { earliestDayNeeded } from "../../lib/orders/gross-sales.service";

const ASOF = "2026-03-15";

function order(
  partial: Partial<GrossSalesOrder> & { order_date: string | null },
): GrossSalesOrder {
  return {
    store_id: "UAE",
    gross_aed: 100,
    financial_status: "paid",
    ...partial,
  };
}

/* ---------- Dubai day boundary ---------- */

test("dubaiDayKey puts a late Dubai evening on the Dubai day, not the next UTC day", () => {
  // 21:00 Dubai on 15 March is 17:00 UTC on 15 March — same day either way.
  assert.equal(dubaiDayKey("2026-03-15T17:00:00Z"), "2026-03-15");
  // 01:00 Dubai on 16 March is 21:00 UTC on 15 March. Bucketing on the raw
  // UTC string would file this under the 15th and undercount the 16th.
  assert.equal(dubaiDayKey("2026-03-15T21:00:00Z"), "2026-03-16");
  // 03:59 Dubai on 15 March is 23:59 UTC on the 14th.
  assert.equal(dubaiDayKey("2026-03-14T23:59:00Z"), "2026-03-15");
});

test("dubaiDayKey returns null rather than guessing for missing or junk dates", () => {
  assert.equal(dubaiDayKey(null), null);
  assert.equal(dubaiDayKey(""), null);
  assert.equal(dubaiDayKey("not-a-date"), null);
});

test("dubaiDayRange is inclusive at both ends and does not loop on an inverted range", () => {
  assert.deepEqual(dubaiDayRange("2026-03-13", "2026-03-15"), [
    "2026-03-13",
    "2026-03-14",
    "2026-03-15",
  ]);
  assert.deepEqual(dubaiDayRange("2026-03-15", "2026-03-13"), []);
});

test("addDubaiDays crosses a month boundary correctly", () => {
  assert.equal(addDubaiDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDubaiDays("2026-02-28", 1), "2026-03-01");
});

test("dubaiToday is four hours ahead of UTC", () => {
  // 22:00 UTC on the 15th is 02:00 Dubai on the 16th.
  const ms = new Date("2026-03-15T22:00:00Z").getTime();
  assert.equal(dubaiToday(ms), "2026-03-16");
});

/* ---------- what counts as gross sales ---------- */

test("only paid orders count toward gross sales", () => {
  const orders = [
    order({ order_date: "2026-03-15T08:00:00Z", gross_aed: 500, financial_status: "paid" }),
    order({ order_date: "2026-03-15T09:00:00Z", gross_aed: 300, financial_status: "pending" }),
    order({ order_date: "2026-03-15T10:00:00Z", gross_aed: 200, financial_status: "cancelled" }),
    order({ order_date: "2026-03-15T11:00:00Z", gross_aed: 150, financial_status: "refunded" }),
  ];
  const rep = computeGrossSales(orders, ASOF);
  assert.equal(rep.today.grossAed, 500);
  assert.equal(rep.today.orders, 1);
});

test("financial_status matching is case-insensitive", () => {
  const rep = computeGrossSales(
    [order({ order_date: "2026-03-15T08:00:00Z", gross_aed: 400, financial_status: "PAID" })],
    ASOF,
  );
  assert.equal(rep.today.grossAed, 400);
});

test("excluded block accounts for every order the headline drops", () => {
  const orders = [
    order({ order_date: "2026-03-15T08:00:00Z", gross_aed: 500, financial_status: "paid" }),
    order({ order_date: "2026-03-15T09:00:00Z", gross_aed: 300, financial_status: "pending" }),
    order({ order_date: "2026-03-15T09:30:00Z", gross_aed: 120, financial_status: "failed" }),
    order({ order_date: "2026-03-15T10:00:00Z", gross_aed: 200, financial_status: "cancelled" }),
    order({ order_date: "2026-03-15T10:30:00Z", gross_aed: 150, financial_status: "voided" }),
    order({ order_date: null, gross_aed: 90, financial_status: "paid" }),
  ];
  const rep = computeGrossSales(orders, ASOF);

  assert.equal(rep.excluded.unpaidOrders, 2); // pending + failed
  assert.equal(rep.excluded.unpaidGrossAed, 420);
  assert.equal(rep.excluded.cancelledOrders, 2); // cancelled + voided
  assert.equal(rep.excluded.cancelledGrossAed, 350);
  assert.equal(rep.excluded.undatedOrders, 1);
});

test("excluded is scoped to the chart window, not to everything fetched", () => {
  const orders = [
    // Inside a 7-day window ending 15 March.
    order({ order_date: "2026-03-12T08:00:00Z", gross_aed: 100, financial_status: "pending" }),
    // Outside it — the service pads the fetch by a week for the trailing
    // comparison, and these must not be counted against a 7-day chart.
    order({ order_date: "2026-03-02T08:00:00Z", gross_aed: 5000, financial_status: "pending" }),
    order({ order_date: "2026-03-01T08:00:00Z", gross_aed: 900, financial_status: "cancelled" }),
  ];
  const rep = computeGrossSales(orders, ASOF, 7);

  assert.equal(rep.excluded.fromDay, "2026-03-09");
  assert.equal(rep.excluded.toDay, ASOF);
  assert.equal(rep.excluded.unpaidOrders, 1);
  assert.equal(rep.excluded.unpaidGrossAed, 100);
  assert.equal(rep.excluded.cancelledOrders, 0);
});

test("a paid order with no date is excluded from the totals, not counted as today", () => {
  const rep = computeGrossSales(
    [order({ order_date: null, gross_aed: 999, financial_status: "paid" })],
    ASOF,
  );
  assert.equal(rep.today.grossAed, 0);
  assert.equal(rep.last7.grossAed, 0);
  assert.equal(rep.excluded.undatedOrders, 1);
});

test("a null or zero total is not a sale (reference rule: total > 0), and never NaN", () => {
  const rep = computeGrossSales(
    [
      order({ order_date: "2026-03-15T08:00:00Z", gross_aed: null }),
      order({ order_date: "2026-03-15T09:00:00Z", gross_aed: 250 }),
    ],
    ASOF,
  );
  assert.equal(rep.today.grossAed, 250);
  assert.equal(rep.today.orders, 1);
});

/* ---------- rollups ---------- */

test("today, yesterday and last 7 days cover the right windows", () => {
  const orders = [
    order({ order_date: "2026-03-15T08:00:00Z", gross_aed: 100 }), // today
    order({ order_date: "2026-03-14T08:00:00Z", gross_aed: 200 }), // yesterday
    order({ order_date: "2026-03-10T08:00:00Z", gross_aed: 400 }), // within last 7
    order({ order_date: "2026-03-09T08:00:00Z", gross_aed: 800 }), // exactly 6 days back, inside
    order({ order_date: "2026-03-08T08:00:00Z", gross_aed: 1600 }), // 7 days back, outside
  ];
  const rep = computeGrossSales(orders, ASOF);

  assert.equal(rep.today.grossAed, 100);
  assert.equal(rep.yesterday.grossAed, 200);
  // 100 + 200 + 400 + 800, excluding the 1600 on the 8th.
  assert.equal(rep.last7.grossAed, 1500);
  assert.equal(rep.last7.fromDay, "2026-03-09");
  assert.equal(rep.last7.toDay, "2026-03-15");
});

test("today compares against yesterday and reports the percentage change", () => {
  const orders = [
    order({ order_date: "2026-03-15T08:00:00Z", gross_aed: 150 }),
    order({ order_date: "2026-03-14T08:00:00Z", gross_aed: 100 }),
  ];
  const rep = computeGrossSales(orders, ASOF);
  assert.equal(rep.today.previousGrossAed, 100);
  assert.equal(rep.today.deltaPct, 50);
});

test("last 7 days compares against the 7 days before it, not an overlapping window", () => {
  const orders = [
    order({ order_date: "2026-03-12T08:00:00Z", gross_aed: 300 }), // current window
    order({ order_date: "2026-03-05T08:00:00Z", gross_aed: 200 }), // prior window
  ];
  const rep = computeGrossSales(orders, ASOF);
  assert.equal(rep.last7.grossAed, 300);
  assert.equal(rep.last7.previousGrossAed, 200);
  assert.equal(rep.last7.deltaPct, 50);
});

test("delta is null rather than zero or Infinity when there is nothing to compare against", () => {
  assert.equal(deltaPercent(500, 0), null);
  assert.equal(deltaPercent(500, null), null);
  assert.equal(deltaPercent(0, 0), null);
  assert.equal(deltaPercent(0, 100), -100);

  const rep = computeGrossSales(
    [order({ order_date: "2026-03-15T08:00:00Z", gross_aed: 500 })],
    ASOF,
  );
  assert.equal(rep.today.previousGrossAed, 0);
  assert.equal(rep.today.deltaPct, null);
});

/* ---------- last 30 days, last calendar month, custom range ---------- */

test("last 30 days is inclusive of today and 29 days back, and no further", () => {
  const orders = [
    order({ order_date: "2026-03-15T08:00:00Z", gross_aed: 10 }),
    order({ order_date: "2026-02-14T08:00:00Z", gross_aed: 20 }), // exactly 29 back, inside
    order({ order_date: "2026-02-13T08:00:00Z", gross_aed: 40 }), // 30 back, outside
  ];
  const rep = computeGrossSales(orders, ASOF);
  assert.equal(rep.last30.fromDay, "2026-02-14");
  assert.equal(rep.last30.toDay, ASOF);
  assert.equal(rep.last30.grossAed, 30);
});

test("last month is the previous calendar month, not a rolling 30 days", () => {
  const orders = [
    order({ order_date: "2026-02-01T08:00:00Z", gross_aed: 100 }), // first day of Feb
    order({ order_date: "2026-02-28T08:00:00Z", gross_aed: 200 }), // last day of Feb
    order({ order_date: "2026-03-01T08:00:00Z", gross_aed: 400 }), // March, excluded
    order({ order_date: "2026-01-31T08:00:00Z", gross_aed: 800 }), // January, excluded
  ];
  const rep = computeGrossSales(orders, ASOF);
  assert.equal(rep.lastMonth.fromDay, "2026-02-01");
  assert.equal(rep.lastMonth.toDay, "2026-02-28");
  assert.equal(rep.lastMonth.grossAed, 300);
  assert.equal(rep.lastMonth.label, "February 2026");
});

test("last month compares against the month before it", () => {
  const orders = [
    order({ order_date: "2026-02-10T08:00:00Z", gross_aed: 300 }),
    order({ order_date: "2026-01-10T08:00:00Z", gross_aed: 200 }),
  ];
  const rep = computeGrossSales(orders, ASOF);
  assert.equal(rep.lastMonth.grossAed, 300);
  assert.equal(rep.lastMonth.previousGrossAed, 200);
  assert.equal(rep.lastMonth.deltaPct, 50);
});

test("last month rolls back across a year boundary", () => {
  const rep = computeGrossSales([], "2026-01-15");
  assert.equal(rep.lastMonth.fromDay, "2025-12-01");
  assert.equal(rep.lastMonth.toDay, "2025-12-31");
  assert.equal(rep.lastMonth.label, "December 2025");
});

test("last month handles a leap February", () => {
  const rep = computeGrossSales([], "2028-03-10");
  assert.equal(rep.lastMonth.fromDay, "2028-02-01");
  assert.equal(rep.lastMonth.toDay, "2028-02-29");
});

test("there is no custom rollup until both dates are supplied", () => {
  assert.equal(computeGrossSales([], ASOF).custom, null);
  assert.equal(computeGrossSales([], ASOF, 30, undefined, { fromDay: "2026-03-01" }).custom, null);
  assert.equal(computeGrossSales([], ASOF, 30, undefined, { toDay: "2026-03-05" }).custom, null);
  // Inverted range is refused rather than quietly swapped.
  assert.equal(
    computeGrossSales([], ASOF, 30, undefined, { fromDay: "2026-03-09", toDay: "2026-03-01" })
      .custom,
    null,
  );
});

test("a custom range sums only the days inside it, both ends inclusive", () => {
  const orders = [
    order({ order_date: "2026-03-01T08:00:00Z", gross_aed: 100 }),
    order({ order_date: "2026-03-05T08:00:00Z", gross_aed: 200 }),
    order({ order_date: "2026-03-06T08:00:00Z", gross_aed: 400 }),
  ];
  const rep = computeGrossSales(orders, ASOF, 30, undefined, {
    fromDay: "2026-03-01",
    toDay: "2026-03-05",
  });
  assert.equal(rep.custom?.grossAed, 300);
  assert.equal(rep.custom?.label, "2026-03-01 to 2026-03-05");
});

test("a custom range compares against the equally long stretch before it", () => {
  const orders = [
    order({ order_date: "2026-03-08T08:00:00Z", gross_aed: 300 }), // in range
    order({ order_date: "2026-03-03T08:00:00Z", gross_aed: 150 }), // in prior window
    order({ order_date: "2026-02-28T08:00:00Z", gross_aed: 999 }), // before prior window
  ];
  // 06-10 March is 5 days, so the prior window is 01-05 March.
  const rep = computeGrossSales(orders, ASOF, 30, undefined, {
    fromDay: "2026-03-06",
    toDay: "2026-03-10",
  });
  assert.equal(rep.custom?.grossAed, 300);
  assert.equal(rep.custom?.previousGrossAed, 150);
  assert.equal(rep.custom?.deltaPct, 100);
});

test("a single-day custom range is labelled as that day and compares to the day before", () => {
  const orders = [
    order({ order_date: "2026-03-10T08:00:00Z", gross_aed: 90 }),
    order({ order_date: "2026-03-09T08:00:00Z", gross_aed: 45 }),
  ];
  const rep = computeGrossSales(orders, ASOF, 30, undefined, {
    fromDay: "2026-03-10",
    toDay: "2026-03-10",
  });
  assert.equal(rep.custom?.label, "2026-03-10");
  assert.equal(rep.custom?.grossAed, 90);
  assert.equal(rep.custom?.previousGrossAed, 45);
});

test("periods lists the five fixed windows in display order", () => {
  const rep = computeGrossSales([], ASOF);
  assert.deepEqual(
    rep.periods.map((p) => p.key),
    ["today", "yesterday", "last7", "last30", "lastMonth"],
  );
  // The custom range is deliberately not in the fixed list.
  assert.ok(!rep.periods.some((p) => p.key === "custom"));
});

test("the fetch window reaches back past every comparison window", () => {
  // Widest fixed comparison is the month before last month.
  assert.equal(earliestDayNeeded("2026-03-15", 30), "2026-01-01");
  // A long custom range pushes it back further still.
  assert.equal(
    earliestDayNeeded("2026-03-15", 30, { fromDay: "2025-06-01", toDay: "2025-06-30" }),
    "2025-05-02",
  );
  // A long chart window also counts.
  assert.equal(earliestDayNeeded("2026-03-15", 180), "2025-09-17");
});

/* ---------- per-store split ---------- */

test("all four stores are split out and sum to the total", () => {
  const orders = [
    order({ order_date: "2026-03-15T08:00:00Z", store_id: "UAE", gross_aed: 100 }),
    order({ order_date: "2026-03-15T08:00:00Z", store_id: "KSA", gross_aed: 200 }),
    order({ order_date: "2026-03-15T08:00:00Z", store_id: "WA", gross_aed: 300 }),
    order({ order_date: "2026-03-15T08:00:00Z", store_id: "WOO", gross_aed: 400 }),
  ];
  const rep = computeGrossSales(orders, ASOF);

  assert.equal(rep.today.grossAed, 1000);
  const sum = rep.today.byStore.reduce((a, s) => a + s.grossAed, 0);
  assert.equal(sum, rep.today.grossAed);
  assert.equal(rep.today.byStore.length, 4);
  // Sorted biggest first.
  assert.equal(rep.today.byStore[0].store, "WOO");
  assert.equal(rep.today.byStore[0].label, "WooCommerce");
});

test("a store with no sales still appears, at zero, so the rail never reflows", () => {
  const rep = computeGrossSales(
    [order({ order_date: "2026-03-15T08:00:00Z", store_id: "UAE", gross_aed: 100 })],
    ASOF,
  );
  assert.equal(rep.today.byStore.length, 4);
  const ksa = rep.today.byStore.find((s) => s.store === "KSA");
  assert.equal(ksa?.grossAed, 0);
  assert.equal(ksa?.orders, 0);
});

test("an unrecognised store id still counts toward the day total", () => {
  const rep = computeGrossSales(
    [
      order({ order_date: "2026-03-15T08:00:00Z", store_id: "UAE", gross_aed: 100 }),
      order({ order_date: "2026-03-15T08:00:00Z", store_id: "NEWSTORE", gross_aed: 50 }),
    ],
    ASOF,
  );
  assert.equal(rep.today.grossAed, 150);
  const found = rep.today.byStore.find((s) => s.store === "NEWSTORE");
  assert.equal(found?.grossAed, 50);
});

/* ---------- daily series ---------- */

test("the series has one row per day with no gaps, including empty days", () => {
  const series = buildDailySeries(
    [order({ order_date: "2026-03-15T08:00:00Z", gross_aed: 100 })],
    "2026-03-13",
    "2026-03-15",
  );
  assert.deepEqual(series.map((d) => d.day), ["2026-03-13", "2026-03-14", "2026-03-15"]);
  assert.equal(series[0].grossAed, 0);
  assert.equal(series[1].grossAed, 0);
  assert.equal(series[2].grossAed, 100);
});

test("every series row carries a key for every store so the stack never breaks", () => {
  const series = buildDailySeries(
    [order({ order_date: "2026-03-15T08:00:00Z", store_id: "KSA", gross_aed: 100 })],
    "2026-03-14",
    "2026-03-15",
  );
  for (const row of series) {
    for (const s of ["UAE", "KSA", "WA", "WOO"]) {
      assert.equal(typeof row.byStore[s], "number", `${row.day} missing ${s}`);
    }
  }
  assert.equal(series[1].byStore.KSA, 100);
  assert.equal(series[1].byStore.UAE, 0);
});

test("orders outside the series window are ignored rather than clamped onto an edge day", () => {
  const series = buildDailySeries(
    [
      order({ order_date: "2026-03-10T08:00:00Z", gross_aed: 999 }),
      order({ order_date: "2026-03-15T08:00:00Z", gross_aed: 100 }),
    ],
    "2026-03-14",
    "2026-03-15",
  );
  assert.equal(series.reduce((a, d) => a + d.grossAed, 0), 100);
});

test("the series covers the requested number of days ending today", () => {
  const rep = computeGrossSales([], ASOF, 7);
  assert.equal(rep.series.length, 7);
  assert.equal(rep.series[0].day, "2026-03-09");
  assert.equal(rep.series[6].day, ASOF);
});

test("series day totals reconcile with the last-7 rollup", () => {
  const orders = [
    order({ order_date: "2026-03-15T08:00:00Z", store_id: "UAE", gross_aed: 100 }),
    order({ order_date: "2026-03-13T08:00:00Z", store_id: "KSA", gross_aed: 250.5 }),
    order({ order_date: "2026-03-11T08:00:00Z", store_id: "WOO", gross_aed: 75.25 }),
  ];
  const rep = computeGrossSales(orders, ASOF, 7);
  const seriesTotal = +rep.series.reduce((a, d) => a + d.grossAed, 0).toFixed(2);
  assert.equal(seriesTotal, rep.last7.grossAed);
  assert.equal(seriesTotal, 425.75);
});

test("money values are rounded to two decimals, not left as float noise", () => {
  const rep = computeGrossSales(
    [
      order({ order_date: "2026-03-15T08:00:00Z", gross_aed: 0.1 }),
      order({ order_date: "2026-03-15T09:00:00Z", gross_aed: 0.2 }),
    ],
    ASOF,
  );
  assert.equal(rep.today.grossAed, 0.3);
});
