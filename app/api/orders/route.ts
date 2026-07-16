import { NextResponse } from "next/server";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";

// GET /api/orders — normalized orders from Supabase (never live Shopify),
// each with its finance chain: payout file seen? settled by bank?
export async function GET() {
  const [orders, payouts] = await Promise.all([
    OrdersRepository.listAll(),
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

  const rows = orders.map(({ line_items: _li, ...o }) => {
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

  return NextResponse.json({ orders: rows, count: rows.length });
}
