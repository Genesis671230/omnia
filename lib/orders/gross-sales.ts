// Gross Sales from store orders — the founder's "what did we actually sell"
// number, split by store and bucketed on the Dubai calendar.
//
// WHAT COUNTS
// Gross Sales here is PAID orders only (financial_status === "paid"), matching
// lib/reports/cfo-digest.ts. Pending, failed, expired, cancelled, refunded and
// voided orders are real order attempts but not money in the door, and mixing
// them into a revenue figure is exactly the discrepancy that showed up against
// the manual dispatch sheet's "32 paid / 37 total" count.
//
// Rather than silently drop the rest, every report carries an `excluded` block
// with the unpaid and cancelled counts and their value, so the founder can see
// the gap between "orders placed" and "money taken" instead of wondering why
// this panel disagrees with the orders list.
//
// Gross means before gateway fees, refunds and VAT. It is the top line, not
// the payout — what lands in the bank is the reconciliation side of the app
// and is deliberately a different number.
//
// Amounts are gross_aed, which the order normalizer has already converted to
// AED, so a KSA order in SAR and a UAE order in AED can be summed.

import {
  addDubaiDays,
  dubaiDayKey,
  dubaiDayRange,
  dubaiToday,
} from "@/lib/dubai-day";

/** The four storefronts. Order is display order, widest first. */
export const GROSS_SALES_STORES = ["UAE", "KSA", "WA", "WOO"] as const;
export type StoreId = (typeof GROSS_SALES_STORES)[number];

export const STORE_LABELS: Record<string, string> = {
  UAE: "Shopify UAE",
  KSA: "Shopify KSA",
  WA: "Shopify WhatsApp",
  WOO: "WooCommerce",
};

export const PAID_STATUS = "paid";

/** Statuses that mean the order was reversed, not merely unfinished. */
export const CANCELLED_STATUSES = new Set(["voided", "refunded", "cancelled"]);

/** The only order fields this report needs. Keeps callers and tests light. */
export type GrossSalesOrder = {
  store_id: string;
  order_date: string | null;
  gross_aed: number | null;
  financial_status: string | null;
};

export type StoreAmount = {
  store: string;
  label: string;
  grossAed: number;
  orders: number;
};

export type DayBucket = {
  /** Dubai calendar day, YYYY-MM-DD. */
  day: string;
  grossAed: number;
  orders: number;
  /** Keyed by store id, present for every store so the chart can stack. */
  byStore: Record<string, number>;
};

export type Rollup = {
  key: "today" | "yesterday" | "last7" | "prev7";
  label: string;
  fromDay: string;
  toDay: string;
  grossAed: number;
  orders: number;
  byStore: StoreAmount[];
  /** The same-length window immediately before this one, for comparison. */
  previousGrossAed: number | null;
  /** null when the previous window was zero — a rise from nothing has no percentage. */
  deltaPct: number | null;
};

export type GrossSalesReport = {
  /** The Dubai day treated as "today". */
  asOfDay: string;
  stores: string[];
  storeLabels: Record<string, string>;
  today: Rollup;
  yesterday: Rollup;
  last7: Rollup;
  /** Daily buckets, ascending, one entry per day with no gaps. */
  series: DayBucket[];
  /** Orders the headline deliberately leaves out, over the chart window. */
  excluded: {
    fromDay: string;
    toDay: string;
    unpaidOrders: number;
    unpaidGrossAed: number;
    cancelledOrders: number;
    cancelledGrossAed: number;
    /** Counted across everything fetched — an order with no date has no window. */
    undatedOrders: number;
  };
};

function money(n: number): number {
  return +n.toFixed(2);
}

function isPaid(o: GrossSalesOrder): boolean {
  return (o.financial_status || "").toLowerCase() === PAID_STATUS;
}

function isCancelled(o: GrossSalesOrder): boolean {
  return CANCELLED_STATUSES.has((o.financial_status || "").toLowerCase());
}

function emptyByStore(stores: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of stores) out[s] = 0;
  return out;
}

/**
 * Daily paid-sales buckets over an inclusive Dubai day range.
 *
 * Days with no orders are emitted as zero rows rather than omitted, so the
 * chart draws a real gap instead of joining Monday straight to Thursday and
 * making a dead midweek look like steady trade.
 */
export function buildDailySeries(
  orders: GrossSalesOrder[],
  fromDay: string,
  toDay: string,
  stores: readonly string[] = GROSS_SALES_STORES,
): DayBucket[] {
  const byDay = new Map<string, DayBucket>();
  for (const day of dubaiDayRange(fromDay, toDay)) {
    byDay.set(day, { day, grossAed: 0, orders: 0, byStore: emptyByStore(stores) });
  }

  for (const o of orders) {
    if (!isPaid(o)) continue;
    const day = dubaiDayKey(o.order_date);
    if (!day) continue;
    const bucket = byDay.get(day);
    if (!bucket) continue; // outside the requested window
    const amount = Number(o.gross_aed) || 0;
    bucket.grossAed += amount;
    bucket.orders += 1;
    // An unrecognised store still counts toward the day total; it just gets
    // its own key rather than being dropped or folded into another store.
    bucket.byStore[o.store_id] = (bucket.byStore[o.store_id] ?? 0) + amount;
  }

  return [...byDay.values()].map((b) => ({
    ...b,
    grossAed: money(b.grossAed),
    byStore: Object.fromEntries(
      Object.entries(b.byStore).map(([k, v]) => [k, money(v)]),
    ),
  }));
}

/** Sum the paid orders falling inside an inclusive Dubai day range. */
function sumWindow(
  orders: GrossSalesOrder[],
  fromDay: string,
  toDay: string,
  stores: readonly string[],
): { grossAed: number; orders: number; byStore: StoreAmount[] } {
  const totals = new Map<string, { grossAed: number; orders: number }>();
  for (const s of stores) totals.set(s, { grossAed: 0, orders: 0 });

  let grossAed = 0;
  let count = 0;

  for (const o of orders) {
    if (!isPaid(o)) continue;
    const day = dubaiDayKey(o.order_date);
    if (!day || day < fromDay || day > toDay) continue;
    const amount = Number(o.gross_aed) || 0;
    grossAed += amount;
    count += 1;
    const t = totals.get(o.store_id) ?? { grossAed: 0, orders: 0 };
    t.grossAed += amount;
    t.orders += 1;
    totals.set(o.store_id, t);
  }

  return {
    grossAed: money(grossAed),
    orders: count,
    byStore: [...totals.entries()]
      .map(([store, t]) => ({
        store,
        label: STORE_LABELS[store] ?? store,
        grossAed: money(t.grossAed),
        orders: t.orders,
      }))
      .sort((a, b) => b.grossAed - a.grossAed),
  };
}

/**
 * Percentage change, or null when there is nothing to compare against.
 *
 * Returning null rather than 0 or Infinity matters: "first sales ever" and
 * "flat against last week" are different facts, and a 0% badge on the first
 * would be a lie the founder might act on.
 */
export function deltaPercent(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return +(((current - previous) / previous) * 100).toFixed(1);
}

function makeRollup(
  key: Rollup["key"],
  label: string,
  orders: GrossSalesOrder[],
  fromDay: string,
  toDay: string,
  prevFromDay: string,
  prevToDay: string,
  stores: readonly string[],
): Rollup {
  const cur = sumWindow(orders, fromDay, toDay, stores);
  const prev = sumWindow(orders, prevFromDay, prevToDay, stores);
  return {
    key,
    label,
    fromDay,
    toDay,
    grossAed: cur.grossAed,
    orders: cur.orders,
    byStore: cur.byStore,
    previousGrossAed: prev.grossAed,
    deltaPct: deltaPercent(cur.grossAed, prev.grossAed),
  };
}

/**
 * The whole report. Pure: hand it order rows and the day to treat as today.
 *
 * `days` controls the chart window only; the three rollups are always today,
 * yesterday and the trailing 7 days including today.
 */
export function computeGrossSales(
  orders: GrossSalesOrder[],
  asOfDay: string = dubaiToday(),
  days = 30,
  stores: readonly string[] = GROSS_SALES_STORES,
): GrossSalesReport {
  const yesterday = addDubaiDays(asOfDay, -1);
  const seriesFrom = addDubaiDays(asOfDay, -(Math.max(days, 1) - 1));

  // Scoped to the chart window, not to everything the caller happened to
  // fetch. The service pads the query by an extra week so the trailing-7
  // rollup has something to compare against, and counting exclusions over
  // that padding would put 21 days of unpaid orders next to 14 days of sales.
  const excluded = {
    fromDay: seriesFrom,
    toDay: asOfDay,
    unpaidOrders: 0,
    unpaidGrossAed: 0,
    cancelledOrders: 0,
    cancelledGrossAed: 0,
    undatedOrders: 0,
  };
  for (const o of orders) {
    if (!o.order_date) {
      excluded.undatedOrders += 1;
      continue; // no day, so it cannot be placed in or out of the window
    }
    if (isPaid(o)) continue;
    const day = dubaiDayKey(o.order_date);
    if (!day || day < seriesFrom || day > asOfDay) continue;
    const amount = Number(o.gross_aed) || 0;
    if (isCancelled(o)) {
      excluded.cancelledOrders += 1;
      excluded.cancelledGrossAed += amount;
    } else {
      excluded.unpaidOrders += 1;
      excluded.unpaidGrossAed += amount;
    }
  }

  return {
    asOfDay,
    stores: [...stores],
    storeLabels: STORE_LABELS,
    today: makeRollup(
      "today", "Today", orders,
      asOfDay, asOfDay,
      yesterday, yesterday,
      stores,
    ),
    yesterday: makeRollup(
      "yesterday", "Yesterday", orders,
      yesterday, yesterday,
      addDubaiDays(asOfDay, -2), addDubaiDays(asOfDay, -2),
      stores,
    ),
    last7: makeRollup(
      "last7", "Last 7 days", orders,
      addDubaiDays(asOfDay, -6), asOfDay,
      addDubaiDays(asOfDay, -13), addDubaiDays(asOfDay, -7),
      stores,
    ),
    series: buildDailySeries(orders, seriesFrom, asOfDay, stores),
    excluded: {
      ...excluded,
      unpaidGrossAed: money(excluded.unpaidGrossAed),
      cancelledGrossAed: money(excluded.cancelledGrossAed),
    },
  };
}
