/* Search and grouping over reconciliation lines — pure, client-side.
 *
 * Filtering runs against the ~115 lines already in memory rather than the
 * server: a round trip per keystroke would be slower AND would race the
 * 60-second poll the view already runs. The DATE range stays server-side by
 * contrast, because /api/reconcile deliberately matches over all data and
 * filters only its output — a payout can straddle a range boundary, so
 * narrowing dates on the client would silently change which credits match.
 */

import type { ReconLine } from "@/lib/reconciliation/engine";

export type FilterLine = Pick<
  ReconLine,
  | "id"
  | "date"
  | "narration"
  | "reference"
  | "provider"
  | "bankAmount"
  | "state"
  | "payout"
  | "resolvedOrders"
  | "unresolvedRefs"
  | "refundedOrders"
  | "transactions"
> & { reviewFlag?: boolean };

/* ── Search ──────────────────────────────────────────────────────────────── */

/** Everything on a row a person might type. Includes the per-order refs inside
 *  the proof table, not just the resolved list — an order visible on screen
 *  must be findable, whatever bucket it sits in. */
export function searchTarget(l: FilterLine): string {
  return [
    l.id,
    l.narration,
    l.reference,
    l.provider,
    l.payout?.id ?? "",
    l.payout?.source ?? "",
    l.payout?.currency ?? "",
    ...l.resolvedOrders,
    ...l.unresolvedRefs,
    ...l.refundedOrders,
    ...l.transactions.map((t) => t.ref),
  ]
    .join(" ")
    .toLowerCase();
}

/** AND across whitespace-separated tokens: typing more always narrows. The
 *  alternative (OR) makes a second word widen the result set, which reads as
 *  the search being broken. */
export function matchesQuery(l: FilterLine, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const target = searchTarget(l);
  return tokens.every((t) => target.includes(t));
}

/* ── Grouping ────────────────────────────────────────────────────────────── */

export type GroupMode = "gateway" | "date" | "status" | "none";

export type ReconGroup<T extends FilterLine = FilterLine> = {
  key: string;
  label: string;
  lines: T[];
  count: number;
  total: number;
  settled: number;
  awaiting: number;
  exception: number;
};

const STATUS_LABEL: Record<string, string> = {
  SETTLED: "Settled",
  AWAITING_PAYOUT: "Awaiting payout",
  PAYOUT_VARIANCE: "Variance",
  ORDERS_UNRESOLVED: "Orders unresolved",
};

const UNDATED = "No statement date";

/** Groups whatever it is handed — the caller has already applied tab, search,
 *  and range — so a group header always describes what is on screen. */
export function groupLines<T extends FilterLine>(lines: T[], mode: GroupMode): ReconGroup<T>[] {
  if (lines.length === 0) return [];

  const keyOf = (l: T): string => {
    if (mode === "gateway") return l.provider;
    if (mode === "status") return l.state;
    if (mode === "date") return l.date ? l.date.slice(0, 10) : UNDATED;
    return "all";
  };

  const by = new Map<string, ReconGroup<T>>();
  for (const l of lines) {
    const key = keyOf(l);
    const g =
      by.get(key) ??
      {
        key,
        label: mode === "status" ? (STATUS_LABEL[key] ?? key) : mode === "none" ? "All credits" : key,
        lines: [] as T[],
        count: 0,
        total: 0,
        settled: 0,
        awaiting: 0,
        exception: 0,
      };

    g.lines.push(l);
    g.count += 1;
    g.total = round2(g.total + l.bankAmount);
    if (l.state === "SETTLED") g.settled = round2(g.settled + l.bankAmount);
    else if (l.state === "AWAITING_PAYOUT") g.awaiting = round2(g.awaiting + l.bankAmount);
    else g.exception = round2(g.exception + l.bankAmount);

    by.set(key, g);
  }

  const groups = [...by.values()];
  // Date reads chronologically (newest work first); everything else reads by
  // how much money is in the group, so the biggest problem is at the top.
  if (mode === "date") {
    groups.sort((a, b) => {
      if (a.key === UNDATED) return 1;
      if (b.key === UNDATED) return -1;
      return b.key.localeCompare(a.key);
    });
  } else {
    groups.sort((a, b) => b.total - a.total);
  }
  return groups;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
