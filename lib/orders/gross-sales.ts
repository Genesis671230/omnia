// Gross Sales from store orders — the founder's "what did we actually sell"
// number, split by store and bucketed on the Dubai calendar.
//
// WHAT COUNTS
// Orders that pass isCountedSale (lib/orders/sale-rule.ts) — the founder's
// reference definition: paid / partially paid, WooCommerce on-hold, pending
// Cash on Delivery on the Shopify stores, and anything on the prepaid WhatsApp
// store. Failed, abandoned-pending, cancelled, refunded and voided orders are
// real order attempts but not sales, and mixing them in is exactly the
// discrepancy that showed up against the manual dispatch sheet's
// "32 paid / 37 total" count.
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
  dubaiDayCount,
  dubaiDayKey,
  dubaiDayRange,
  dubaiMonthBounds,
  dubaiToday,
} from "@/lib/dubai-day";
import { isCountedSale, isReversedOrder } from "./sale-rule";

/** The four storefronts. Order is display order, widest first. */
export const GROSS_SALES_STORES = ["UAE", "KSA", "WA", "WOO", "MAIN"] as const;
export type StoreId = (typeof GROSS_SALES_STORES)[number];

export const STORE_LABELS: Record<string, string> = {
  UAE: "Shopify UAE",
  KSA: "Shopify KSA",
  WA: "Shopify WhatsApp",
  WOO: "WooCommerce",
  MAIN: "Shopify Main",
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
  /** Needed to count pending Cash on Delivery orders. */
  gateway?: string | null;
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

export type RollupKey =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "lastMonth"
  | "custom";

export type Rollup = {
  key: RollupKey;
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
  last30: Rollup;
  /** The previous whole calendar month, not a rolling 30 days. */
  lastMonth: Rollup;
  /** Only present when the caller supplied an explicit from/to range. */
  custom: Rollup | null;
  /** Fixed periods in display order, for a panel that just wants to map over them. */
  periods: Rollup[];
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
  return isCountedSale(o);
}

function isCancelled(o: GrossSalesOrder): boolean {
  return isReversedOrder(o);
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
  key: RollupKey,
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
  range?: { fromDay?: string | null; toDay?: string | null } | null,
): GrossSalesReport {
  const yesterday = addDubaiDays(asOfDay, -1);
  const seriesFrom = addDubaiDays(asOfDay, -(Math.max(days, 1) - 1));
  const prevMonth = dubaiMonthBounds(asOfDay, 1);
  const monthBefore = dubaiMonthBounds(asOfDay, 2);

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

  const today = makeRollup(
    "today", "Today", orders,
    asOfDay, asOfDay,
    yesterday, yesterday,
    stores,
  );
  const yesterdayRollup = makeRollup(
    "yesterday", "Yesterday", orders,
    yesterday, yesterday,
    addDubaiDays(asOfDay, -2), addDubaiDays(asOfDay, -2),
    stores,
  );
  const last7 = makeRollup(
    "last7", "Last 7 days", orders,
    addDubaiDays(asOfDay, -6), asOfDay,
    addDubaiDays(asOfDay, -13), addDubaiDays(asOfDay, -7),
    stores,
  );
  const last30 = makeRollup(
    "last30", "Last 30 days", orders,
    addDubaiDays(asOfDay, -29), asOfDay,
    addDubaiDays(asOfDay, -59), addDubaiDays(asOfDay, -30),
    stores,
  );
  const lastMonth = makeRollup(
    "lastMonth", prevMonth.label, orders,
    prevMonth.fromDay, prevMonth.toDay,
    monthBefore.fromDay, monthBefore.toDay,
    stores,
  );

  // A custom range compares against the equally long stretch immediately
  // before it, so "1-10 March" is judged against "19-28 February" rather than
  // against a fixed month that happens to be a different length.
  let custom: Rollup | null = null;
  const cFrom = range?.fromDay || null;
  const cTo = range?.toDay || null;
  if (cFrom && cTo && cFrom <= cTo) {
    const span = dubaiDayCount(cFrom, cTo);
    custom = makeRollup(
      "custom",
      span === 1 ? cFrom : `${cFrom} to ${cTo}`,
      orders,
      cFrom, cTo,
      addDubaiDays(cFrom, -span), addDubaiDays(cFrom, -1),
      stores,
    );
  }

  return {
    asOfDay,
    stores: [...stores],
    storeLabels: STORE_LABELS,
    today,
    yesterday: yesterdayRollup,
    last7,
    last30,
    lastMonth,
    custom,
    periods: [today, yesterdayRollup, last7, last30, lastMonth],
    series: buildDailySeries(orders, seriesFrom, asOfDay, stores),
    excluded: {
      ...excluded,
      unpaidGrossAed: money(excluded.unpaidGrossAed),
      cancelledGrossAed: money(excluded.cancelledGrossAed),
    },
  };
}
