import { NextResponse } from "next/server";
import { OrdersRepository, parseOrdersQuery } from "@/lib/repositories/orders.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { computeFinanceStatuses } from "@/lib/orders-finance-status";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";
import { hasSalesOrder, salesOrderIndex } from "@/lib/integrations/zoho-sales-orders";
import { zohoConfigured } from "@/lib/integrations/zoho";
import { isCountedSale } from "@/lib/orders/sale-rule";
import { addDubaiDays, dubaiDayKey, dubaiToday } from "@/lib/dubai-day";

// ?status=all|cancelled|voided|refunded|failed|not_in_zoho — the list's tabs.
// not_in_zoho: counted sales in the window with no Zoho sales order carrying
// their number in any organisation — the team's "create these" list.
async function notInZoho(opts: { from?: string; store: string | null; q: string; page: number; limit: number }) {
  if (!zohoConfigured()) throw new Error("Zoho is not configured");
  const fromDay = opts.from ? dubaiDayKey(opts.from.replace("Z", "")) ?? dubaiToday() : addDubaiDays(dubaiToday(), -90);
  const rows = await OrdersRepository.listInWindow({ from: opts.from ?? new Date(Date.now() - 90 * 86400_000).toISOString(), store: opts.store });
  // A sales order may be dated a few days either side of its order.
  const index = await salesOrderIndex(addDubaiDays(fromDay, -7), addDubaiDays(dubaiToday(), 1));
  const failed = index.orgs.filter((o) => o.error);
  if (failed.length) throw new Error(`Couldn't read Zoho sales orders from ${failed.map((o) => `${o.label} (${o.error})`).join(", ")}`);
  const term = opts.q.toLowerCase();
  const missing = rows.filter((o) =>
    isCountedSale(o) && !hasSalesOrder(index, o.order_number) &&
    (!term || [o.order_number, o.customer_name, o.city, o.customer_phone].some((v) => String(v ?? "").toLowerCase().includes(term))),
  );
  const start = (opts.page - 1) * opts.limit;
  return { rows: missing.slice(start, start + opts.limit), total: missing.length, allNumbers: missing.map((o) => ({ order_number: o.order_number, order_date: o.order_date, store_id: o.store_id, gross_aed: o.gross_aed, customer_name: o.customer_name })), orgs: index.orgs };
}


export async function GET(request: Request) {
  const url = new URL(request.url);
  const { days, page, limit, store, location, q, fulfillableFrom,orderNumbers, status } = parseOrdersQuery(url.searchParams);
  const from = days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : undefined;

  let zohoMissing: Awaited<ReturnType<typeof notInZoho>> | null = null;
  if (status === "not_in_zoho") {
    try {
      zohoMissing = await notInZoho({ from, store, q, page, limit });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message, orders: [], total: 0 }, { status: 502 });
    }
  }
  const [{ rows, total }, payouts, coverage, counts] = await Promise.all([
    zohoMissing ? Promise.resolve({ rows: zohoMissing.rows, total: zohoMissing.total }) : OrdersRepository.listPage({ from, store, location, q, fulfillableFrom, page, limit, status }),
    PayoutsRepository.listWithRefs(),
    OrdersRepository.getCoverageCounts({ store, location, q }),
    OrdersRepository.countStatusTabs({ from, store, location, q }),
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
  // Settlement evidence per order: without it every order reads AWAITING_BANK
  // however much proof its settlement record carries, and nothing can show as
  // ready to book.
  const settlements = await SettlementsRepository.settlementInfoByOrderUid(
    stripped.map((o) => o.uid).filter(Boolean) as string[],
  );
  const orders = computeFinanceStatuses(stripped, payouts, settlements);

  return NextResponse.json({
    orders, total, page, pageSize: limit, coverage, orderNumbers, status,
    counts: zohoMissing ? { ...counts, not_in_zoho: zohoMissing.total } : counts,
    ...(zohoMissing ? { missingInZoho: zohoMissing.allNumbers, zohoOrgs: zohoMissing.orgs } : {}),
  });
}