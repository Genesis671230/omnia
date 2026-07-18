import { NextResponse } from "next/server";
import { OrdersRepository, parseOrdersQuery } from "@/lib/repositories/orders.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { computeFinanceStatuses } from "@/lib/orders-finance-status";

// GET /api/orders?days=30&page=1&limit=50&store=UAE&location=Dubai&q=nada —
// normalized, paginated orders from Supabase (never live Shopify), each with
// its finance chain: payout file seen? settled by bank?
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { days, page, limit, store, location, q } = parseOrdersQuery(url.searchParams);
  const from = days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : undefined;

  const [{ rows, total }, payouts] = await Promise.all([
    OrdersRepository.listPage({ from, store, location, q, page, limit }),
    PayoutsRepository.listWithRefs(),
  ]);

  const stripped = rows.map(({ line_items: _li, ...o }) => o);
  const orders = computeFinanceStatuses(stripped, payouts);

  return NextResponse.json({ orders, total, page, pageSize: limit });
}
