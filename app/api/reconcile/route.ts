import { NextResponse } from "next/server";
import type { ReconLine } from "@/lib/reconciliation/engine";
import { getReconLines } from "@/lib/reconciliation/snapshot";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { ZohoConfigRepository } from "@/lib/repositories/zoho-config.repository";

// A credit's statement date (YYYY-MM-DD…) falls inside an optional [from, to]
// window — either bound omitted means unbounded on that side.
function inRange(date: string | null, from: string | null, to: string | null): boolean {
  if (!date) return true;
  const day = date.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

// GET /api/reconcile?from=YYYY-MM-DD&to=YYYY-MM-DD[&fresh=1]
// Reads the reconciliation SNAPSHOT (lib/reconciliation/snapshot.ts) instead of
// recomputing the whole book per request. Matching still runs over ALL data
// (a payout can straddle a window) — only the returned lines are filtered.
// `fresh=1` forces a recompute; writes that change inputs mark the snapshot
// dirty so the next read recomputes by itself.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const [snap, orderCounts, postings] = await Promise.all([
    getReconLines({ fresh: url.searchParams.get("fresh") === "1" }),
    OrdersRepository.getOrderCounts(),
    // One query for the whole page: the alternative is a per-row lookup (or a
    // Zoho round trip per row) just to decide whether to draw a button.
    ZohoConfigRepository.listPostings(),
  ]);
  const allLines = snap.lines;
  const lines = (from || to) ? allLines.filter((l) => inRange(l.date, from, to)) : allLines;
  // Every bank credit is exactly one line, so the lines ARE the credit list.
  const rangeCredits = (from || to) ? allLines.filter((l) => inRange(l.date, from, to)) : allLines;

  const uploadedProviders = new Set(snap.extras.payoutGateways);
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
    zohoPostings: Object.fromEntries(
      postings.map((p) => [
        p.bank_line_id,
        { status: p.status, postedAt: p.posted_at, reference: p.reference_number, result: p.zoho_result },
      ]),
    ),
    // Uploaded payout files no bank credit claimed — see unmatchedPayoutsOf().
    unmatchedPayouts: snap.extras.unmatchedPayouts,
    documents: {
      bankStatement: allLines.length > 0,
      missingPayouts: missingDocs,
      // a range was requested but no bank credit at all falls inside it —
      // the founder needs to upload that period's statement, not run a sync
      range: (from || to)
        ? { from, to, noStatementForRange: rangeCredits.length === 0 }
        : null,
    },
    computedAt: snap.computedAt,
    computeMs: snap.durationMs,
    stale: snap.stale,
    refreshing: snap.refreshing,
  });
}
