import { NextResponse } from "next/server";
import { OrdersRepository } from "@/lib/repositories/orders.repository";

// GET /api/pulse?since=ISO — orders placed after `since`, plus a handful of
// energizing headline metrics for the live ticker. Polled from the dashboard;
// keeps the founder's view feeling alive without hitting store APIs directly
// (orders already land in Supabase via /api/sync).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 5 * 60 * 1000);

  const orders = await OrdersRepository.listAll();
  const newOrders = orders
    .filter((o) => o.order_date && new Date(o.order_date) > since)
    .sort((a, b) => (a.order_date! > b.order_date! ? 1 : -1))
    .slice(0, 15)
    .map((o) => ({
      uid: o.uid,
      order_number: o.order_number,
      store_id: o.store_id,
      customer_name: o.customer_name,
      gross_aed: Number(o.gross_aed || 0),
      gateway: o.gateway,
      items: (o.line_items ?? []).slice(0, 2).map((li) => ({ title: li.title, qty: li.qty })),
    }));

  // today's headline metrics — cheap aggregates over the already-loaded order book
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const today = orders.filter((o) => o.order_date && new Date(o.order_date) >= todayStart);
  const todayRevenue = today.reduce((s, o) => s + Number(o.gross_aed || 0), 0);

  const productCount = new Map<string, number>();
  for (const o of today) {
    for (const li of o.line_items ?? []) {
      productCount.set(li.title, (productCount.get(li.title) || 0) + Number(li.qty || 0));
    }
  }
  const topToday = [...productCount.entries()].sort((a, b) => b[1] - a[1])[0];

  const storeCount = new Map<string, number>();
  for (const o of today) storeCount.set(o.store_id, (storeCount.get(o.store_id) || 0) + 1);
  const topStore = [...storeCount.entries()].sort((a, b) => b[1] - a[1])[0];

  const metrics: string[] = [];
  if (today.length > 0) metrics.push(`💰 AED ${Math.round(todayRevenue).toLocaleString()} in sales today across ${today.length} order${today.length === 1 ? "" : "s"}`);
  if (topToday) metrics.push(`🔥 "${topToday[0]}" sold ${topToday[1]}× today`);
  if (topStore) metrics.push(`⚡ ${topStore[0]} is leading today with ${topStore[1]} order${topStore[1] === 1 ? "" : "s"}`);
  if (today.length === 0) metrics.push("👋 No orders yet today — the day is young");

  return NextResponse.json({ now: new Date().toISOString(), newOrders, metrics });
}
