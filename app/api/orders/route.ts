import { NextResponse } from "next/server";
import { OrdersRepository, parseOrdersQuery } from "@/lib/repositories/orders.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";

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

  // which order numbers appear in ANY uploaded payout file
  const refsSeen = new Set<string>();
  for (const p of payouts) {
    for (const ref of p.order_refs) {
      refsSeen.add(ref);
      refsSeen.add(ref.replace(/^(WA|UAE|KSA|WOO)/i, ""));
    }
  }

  const orders = rows.map(({ line_items: _li, ...o }) => {
    const settled = o.payout_status === "settled";
    const inPayoutFile = settled || refsSeen.has(o.order_number);
    const financeStatus =
      o.gateway === "COD"
        ? "COD_PENDING"
        : settled
          ? "SETTLED"
          : inPayoutFile
            ? "AWAITING_BANK"
            : "MISSING_PAYOUT";
    return { ...o, in_payout_file: inPayoutFile, finance_status: financeStatus };
  });

  return NextResponse.json({ orders, total, page, pageSize: limit });
}
