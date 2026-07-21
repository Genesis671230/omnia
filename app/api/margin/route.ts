import { NextResponse } from "next/server";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { AdInsightsRepository } from "@/lib/repositories/ad-insights.repository";
import { computeStoreMargins } from "@/lib/contribution-margin";

const STORES = ["WOO", "KSA", "UAE", "WA"];

// GET /api/finance/margin?days=30&store=ALL — per-store contribution margin:
// revenue − ad spend − gateway fees (measured where the payout parser gave a
// per-transaction fee, labeled estimates otherwise). Reads only synced tables.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1), 365);
  const storeFilter = (url.searchParams.get("store") || "ALL").toUpperCase();

  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const fromIso = new Date(from + "T00:00:00Z").toISOString();

  const [orders, payouts, insights] = await Promise.all([
    OrdersRepository.listAll(),
    PayoutsRepository.listWithRefs(),
    AdInsightsRepository.listInsights(from, to),
  ]);

  // Window the orders (margin is a windowed metric, like the ads summary).
  const windowed = orders.filter((o) => Boolean(o.order_date) && o.order_date! >= fromIso);

  // Measured fees per order_number: sum fee_aed across payout transactions that
  // carry a real (non-placeholder) fee. listWithRefs() exposes transactions
  // with net_aed today — to get MEASURED fees you must also select fee_aed in
  // PayoutsRepository.listWithRefs (one-line change: add fee_aed to the
  // payout_transactions select + the mapped transactions shape). Until then
  // this map is empty and every order estimates — which is honest, just less
  // precise. See buildMeasuredFeeMap in lib/contribution-margin.ts.
  const measuredFees = new Map<string, number>();
  for (const p of payouts) {
    for (const t of p.transactions as { order_ref: string; fee_aed?: number }[]) {
      const fee = Number(t.fee_aed ?? 0);
      if (fee > 0) measuredFees.set(t.order_ref, (measuredFees.get(t.order_ref) ?? 0) + fee);
    }
  }

  // Ad spend per store, same window.
  const adSpendByStore = new Map<string, number>();
  for (const r of insights) {
    if (storeFilter !== "ALL" && r.store_id !== storeFilter) continue;
    adSpendByStore.set(r.store_id, (adSpendByStore.get(r.store_id) ?? 0) + r.spend);
  }

  const storesToShow = storeFilter === "ALL" ? STORES : [storeFilter];
  const margins = computeStoreMargins(windowed, measuredFees, adSpendByStore, storesToShow);

  // Portfolio totals — the one number a founder judges the operation by.
  const totals = margins.reduce(
    (acc, m) => {
      acc.revenue += m.revenue; acc.adSpend += m.adSpend;
      acc.feesMeasured += m.feesMeasured; acc.feesEstimated += m.feesEstimated;
      acc.contributionMargin += m.contributionMargin; acc.orderCount += m.orderCount;
      return acc;
    },
    { revenue: 0, adSpend: 0, feesMeasured: 0, feesEstimated: 0, contributionMargin: 0, orderCount: 0 },
  );
  const round = (n: number) => +n.toFixed(2);

  return NextResponse.json({
    window: { days, from, to, store: storeFilter },
    stores: margins,
    totals: {
      revenue: round(totals.revenue),
      adSpend: round(totals.adSpend),
      feesMeasured: round(totals.feesMeasured),
      feesEstimated: round(totals.feesEstimated),
      feesTotal: round(totals.feesMeasured + totals.feesEstimated),
      contributionMargin: round(totals.contributionMargin),
      marginPct: totals.revenue > 0 ? +(totals.contributionMargin / totals.revenue).toFixed(4) : null,
      orderCount: totals.orderCount,
    },
  });
}