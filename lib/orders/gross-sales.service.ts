// Fetch side of the gross-sales report. Kept apart from gross-sales.ts so the
// aggregation stays pure and unit-testable without a Supabase connection.

import { OrdersRepository } from "@/lib/repositories/orders.repository";
import {
  addDubaiDays,
  dubaiDayBoundsUtc,
  dubaiDayCount,
  dubaiMonthBounds,
  dubaiToday,
} from "@/lib/dubai-day";
import {
  computeGrossSales,
  GROSS_SALES_STORES,
  type GrossSalesOrder,
  type GrossSalesReport,
} from "./gross-sales";

/**
 * The oldest Dubai day any rollup in the report needs to see.
 *
 * Every period is shown against the equivalent stretch before it, so the fetch
 * has to reach back past the earliest comparison window, not just past the
 * chart. Getting this wrong does not error — it silently reports a previous
 * window of zero and every delta badge on the widest periods reads as a record
 * month.
 */
export function earliestDayNeeded(
  asOfDay: string,
  days: number,
  range?: { fromDay?: string | null; toDay?: string | null } | null,
): string {
  const candidates = [
    addDubaiDays(asOfDay, -(Math.max(days, 1) - 1)), // chart series
    addDubaiDays(asOfDay, -13), // previous 7 days
    addDubaiDays(asOfDay, -59), // previous 30 days
    dubaiMonthBounds(asOfDay, 2).fromDay, // the month before last month
  ];

  const cFrom = range?.fromDay || null;
  const cTo = range?.toDay || null;
  if (cFrom && cTo && cFrom <= cTo) {
    candidates.push(addDubaiDays(cFrom, -dubaiDayCount(cFrom, cTo)));
  }

  return candidates.reduce((a, b) => (a < b ? a : b));
}

/**
 * Build the report: today, yesterday, the trailing 7 and 30 days, last
 * calendar month, an optional explicit range, and a daily series for the
 * chart, all split across the four stores.
 */
export async function buildGrossSalesReport({
  days = 30,
  store = null,
  fromDay = null,
  toDay = null,
  nowMs = Date.now(),
}: {
  days?: number;
  store?: string | null;
  fromDay?: string | null;
  toDay?: string | null;
  nowMs?: number;
} = {}): Promise<GrossSalesReport> {
  const asOfDay = dubaiToday(nowMs);
  const window = Math.min(Math.max(days, 1), 180);
  const range = { fromDay, toDay };

  const { fromUtc } = dubaiDayBoundsUtc(earliestDayNeeded(asOfDay, window, range));
  const rows = await OrdersRepository.listInWindow({ from: fromUtc, store });

  const orders: GrossSalesOrder[] = rows.map((r) => ({
    store_id: r.store_id,
    order_date: r.order_date,
    gross_aed: r.gross_aed,
    financial_status: r.financial_status,
  }));

  // Filtering to one store would leave the other three as permanent zeros in
  // the stacked chart, so narrow the store list to match the filter.
  const stores = store ? [store] : GROSS_SALES_STORES;

  return computeGrossSales(orders, asOfDay, window, stores, range);
}
