import { NextResponse } from "next/server";
import { OrdersRepository, parseOrdersQuery } from "@/lib/repositories/orders.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { computeFinanceStatuses } from "@/lib/orders-finance-status";


export async function GET(request: Request) {
  const url = new URL(request.url);
  const { days, page, limit, store, location, q, fulfillableFrom,orderNumbers } = parseOrdersQuery(url.searchParams);
  const from = days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : undefined;

  const [{ rows, total }, payouts, coverage] = await Promise.all([
    OrdersRepository.listPage({ from, store, location, q, fulfillableFrom, page, limit }),
    PayoutsRepository.listWithRefs(),
    OrdersRepository.getCoverageCounts({ store, location, q }),
  ]);
  if (orderNumbers.length > 0) {
    const orders =
      await OrdersRepository.getGatewaysByOrderNumbers(
        orderNumbers,
      );
  
    return NextResponse.json({
      orders,
      total, page, pageSize: limit,
      orderNumbers
    });
  }

  const stripped = rows.map(({ line_items: _li, ...o }) => o);
  const orders = computeFinanceStatuses(stripped, payouts);

  return NextResponse.json({ orders, total, page, pageSize: limit, coverage,orderNumbers });
}