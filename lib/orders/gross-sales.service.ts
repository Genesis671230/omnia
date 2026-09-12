// Fetch side of the gross-sales report. Kept apart from gross-sales.ts so the
// aggregation stays pure and unit-testable without a Supabase connection.

import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { addDubaiDays, dubaiDayBoundsUtc, dubaiToday } from "@/lib/dubai-day";
import {
  computeGrossSales,
  GROSS_SALES_STORES,
  type GrossSalesOrder,
  type GrossSalesReport,
} from "./gross-sales";

/**
 * Build the report for the trailing `days` Dubai days ending today.
 *
 * The fetch window reaches back an extra 7 days beyond the chart window
 * because the trailing-7 rollup compares against the 7 days before it; without
 * the padding that comparison would silently read as zero and every delta
 * badge would be wrong on the widest view.
 */
export async function buildGrossSalesReport({
  days = 30,
  store = null,
  nowMs = Date.now(),
}: {
  days?: number;
  store?: string | null;
  nowMs?: number;
} = {}): Promise<GrossSalesReport> {
  const asOfDay = dubaiToday(nowMs);
  const window = Math.min(Math.max(days, 1), 180);
  const earliestDay = addDubaiDays(asOfDay, -(window - 1 + 7));
  const { fromUtc } = dubaiDayBoundsUtc(earliestDay);

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

  return computeGrossSales(orders, asOfDay, window, stores);
}
