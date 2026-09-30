import { NextResponse } from "next/server";
import { getReconLines } from "@/lib/reconciliation/snapshot";

// GET /api/dashboard/attention?month=YYYY-MM — what the founder has to act on
// before the books can close, read off the same recon snapshot the
// reconciliation page shows (so the counts always agree with it):
//   • bank credits that arrived but have no payout file to reconcile against
//   • payout files uploaded that no bank credit has claimed yet
// "month" scopes the list; `open` is every one still open, whatever its month.

type Group = { gateway: string; count: number; amount: number; oldest: string | null };

function group(rows: { gateway: string; amount: number; date: string | null }[]): Group[] {
  const by = new Map<string, Group>();
  for (const r of rows) {
    const g = by.get(r.gateway) ?? { gateway: r.gateway, count: 0, amount: 0, oldest: null };
    g.count += 1;
    g.amount = +(g.amount + r.amount).toFixed(2);
    if (r.date && (!g.oldest || r.date < g.oldest)) g.oldest = r.date;
    by.set(r.gateway, g);
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount);
}

export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month");
  const snap = await getReconLines({});
  const inMonth = (d: string | null) => !month || (d ?? "").slice(0, 7) === month;

  const awaiting = snap.lines
    .filter((l) => l.state === "AWAITING_PAYOUT")
    .map((l) => ({ id: l.id, gateway: l.provider, amount: l.bankAmount, date: l.date?.slice(0, 10) ?? null, reference: l.reference }));
  const awaitingMonth = awaiting.filter((l) => inMonth(l.date));

  const unmatched = (snap.extras.unmatchedPayouts ?? []).map((p) => ({
    id: p.id, gateway: p.provider, amount: p.net, date: p.uploadedAt?.slice(0, 10) ?? null, orders: p.orders,
  }));

  const sum = (rows: { amount: number }[]) => +rows.reduce((s, r) => s + r.amount, 0).toFixed(2);

  return NextResponse.json({
    month,
    computedAt: snap.computedAt,
    bankWithoutPayout: {
      count: awaitingMonth.length,
      amount: sum(awaitingMonth),
      byGateway: group(awaitingMonth),
      latest: [...awaitingMonth].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 8),
      open: { count: awaiting.length, amount: sum(awaiting) },
    },
    payoutsWithoutBank: {
      count: unmatched.length,
      amount: sum(unmatched),
      byGateway: group(unmatched),
    },
  });
}
