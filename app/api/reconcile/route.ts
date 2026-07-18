import { NextResponse } from "next/server";
import { runReconciliation, type ReconLine } from "@/lib/reconciliation/engine";
import { BankRepository } from "@/lib/repositories/bank.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { OrdersRepository } from "@/lib/repositories/orders.repository";

// A credit's statement date (YYYY-MM-DD…) falls inside an optional [from, to]
// window — either bound omitted means unbounded on that side.
function inRange(date: string | null, from: string | null, to: string | null): boolean {
  if (!date) return true;
  const day = date.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

// GET /api/reconcile?from=YYYY-MM-DD&to=YYYY-MM-DD — recompute bank → payout
// → orders over ALL data (matching can't be scoped to a window — a payout
// can straddle it), then filter the returned lines to the requested range.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const allLines = await runReconciliation();
  const lines = (from || to) ? allLines.filter((l) => inRange(l.date, from, to)) : allLines;

  // document checklist: which gateways have bank credits but no payout file
  const [credits, payouts, orderCounts] = await Promise.all([
    BankRepository.listCredits(),
    PayoutsRepository.listWithRefs(),
    OrdersRepository.getOrderCounts(),
  ]);
  const rangeCredits = (from || to) ? credits.filter((c) => inRange(c.statement_date, from, to)) : credits;

  const uploadedProviders = new Set(payouts.map((p) => p.gateway));
  const missingDocs = [...new Set(
    lines
      .filter((l: ReconLine) => l.state === "AWAITING_PAYOUT" && l.provider !== "Unclassified")
      .map((l: ReconLine) => l.provider),
  )].map((provider) => ({
    provider,
    hasAnyPayoutFile: uploadedProviders.has(provider),
    awaitingAmount: +lines
      .filter((l: ReconLine) => l.state === "AWAITING_PAYOUT" && l.provider === provider)
      .reduce((s, l) => s + l.bankAmount, 0)
      .toFixed(2),
  }));

  return NextResponse.json({
    lines,
    settledOrders: orderCounts.settledOrders,
    totalOrders: orderCounts.totalOrders,
    documents: {
      bankStatement: credits.length > 0,
      missingPayouts: missingDocs,
      // a range was requested but no bank credit at all falls inside it —
      // the founder needs to upload that period's statement, not run a sync
      range: (from || to)
        ? { from, to, noStatementForRange: rangeCredits.length === 0 }
        : null,
    },
    computedAt: new Date().toISOString(),
  });
}
