// The store's real sales for a Dubai-day range, in the shape the analysts
// need: totals vs the period before, per site, top SKUs and when orders come
// in. Shared by the Orders page API and the AI ads analyst.

import { addDubaiDays, dubaiDayBoundsUtc, dubaiDayCount } from "@/lib/dubai-day";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { buildOrdersAnalytics, buildSalesInsights, type LineItem } from "./orders-analytics";

export async function loadSalesContext(fromDay: string, toDay: string) {
  const days = dubaiDayCount(fromDay, toDay);
  const prevToDay = addDubaiDays(fromDay, -1);
  const prevFromDay = addDubaiDays(fromDay, -days);
  const rows = await OrdersRepository.listInWindow({ from: dubaiDayBoundsUtc(prevFromDay).fromUtc });
  const orders = rows.map((o) => ({
    store_id: o.store_id, order_date: o.order_date, gross_aed: o.gross_aed, financial_status: o.financial_status, gateway: o.gateway,
    line_items: (o as { line_items?: LineItem[] | null }).line_items ?? null,
  }));
  const range = { fromDay, toDay, prevFromDay, prevToDay };
  const analytics = buildOrdersAnalytics({ orders, ads: [], ...range });
  const insights = buildSalesInsights({ orders, ...range, limit: 8 });
  return { range, totals: analytics.totals, sites: analytics.sites.map((s) => ({ site: s.label, orders: s.orders, revenue: s.revenue, prevRevenue: s.prev.revenue })), ...insights };
}
