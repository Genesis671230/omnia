/* Reconciliation insights — pure aggregation over already-computed recon lines.
 *
 * Everything here is a total function of its input: no fetch, no React, no
 * clock except the one you pass in. The Insights tab renders these outputs
 * directly, which is why they are computed from the SAME payload the rows
 * below are drawn from — a separate aggregation endpoint would be a second
 * source of truth for the same numbers, free to drift from the rows it sits
 * above.
 */

import type { ReconLine } from "@/lib/reconciliation/engine";

/** The fields the insight views actually read. Structural, so a test fixture
 *  is a small object rather than a full engine result. */
export type InsightLine = Pick<
  ReconLine,
  | "id"
  | "provider"
  | "date"
  | "bankAmount"
  | "state"
  | "variance"
  | "unresolvedRefs"
  | "transactions"
  | "payout"
  | "rateDriftAed"
  | "fxFeeAed"
>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ── Cash in transit + aging ─────────────────────────────────────────────── */

export type AgingKey = "0-7" | "8-14" | "15+";

export type AgingRow = {
  gateway: string;
  total: number;
  count: number;
  /** Credits with no statement date, already counted in the 15+ bucket. */
  undated: number;
  buckets: Record<AgingKey, number>;
  oldestDays: number | null;
};

/** Money the gateways are still holding, by how long they have held it.
 *  The 7-day boundary matches the row-level "overdue" rule already in the UI:
 *  payouts reach the bank inside a week, so day 8 is late by our own standard. */
export function agingByGateway(lines: InsightLine[], now: number = Date.now()): AgingRow[] {
  const by = new Map<string, AgingRow>();

  for (const l of lines) {
    if (l.state !== "AWAITING_PAYOUT") continue;

    const row =
      by.get(l.provider) ??
      { gateway: l.provider, total: 0, count: 0, undated: 0, buckets: { "0-7": 0, "8-14": 0, "15+": 0 }, oldestDays: null };

    // An undated credit is money we cannot age. Dropping it would understate
    // cash in transit, so it is counted at the pessimistic end and reported
    // separately rather than quietly folded in.
    const days = l.date ? Math.floor((now - new Date(l.date).getTime()) / 86_400_000) : null;
    const key: AgingKey = days === null ? "15+" : days <= 7 ? "0-7" : days <= 14 ? "8-14" : "15+";

    row.buckets[key] = round2(row.buckets[key] + l.bankAmount);
    row.total = round2(row.total + l.bankAmount);
    row.count += 1;
    if (days === null) row.undated += 1;
    else if (row.oldestDays === null || days > row.oldestDays) row.oldestDays = days;

    by.set(l.provider, row);
  }

  return [...by.values()].sort((a, b) => b.total - a.total);
}

/* ── Fee burn ────────────────────────────────────────────────────────────── */

export type FeeBurnRow = {
  gateway: string;
  gross: number;
  fee: number;
  /** null when the gateway's parser produced no per-order breakdown, or when
   *  gross is zero — both mean "unknown", which is not the same as 0%. */
  ratePct: number | null;
  hasData: boolean;
  lineCount: number;
};

/** What each gateway actually costs, from the per-order shares the proof table
 *  already shows. Refunds carry negative shares and therefore reduce both sides
 *  of the ratio, which is what makes the rate an effective rate rather than a
 *  headline one. */
export function feeBurnByGateway(lines: InsightLine[]): FeeBurnRow[] {
  const by = new Map<string, FeeBurnRow>();

  for (const l of lines) {
    const row = by.get(l.provider) ?? { gateway: l.provider, gross: 0, fee: 0, ratePct: null, hasData: false, lineCount: 0 };
    row.lineCount += 1;
    for (const t of l.transactions) {
      row.gross = round2(row.gross + t.grossShare);
      row.fee = round2(row.fee + t.feeShare);
      row.hasData = true;
    }
    by.set(l.provider, row);
  }

  for (const row of by.values()) {
    row.ratePct = row.hasData && row.gross > 0 ? round2((row.fee / row.gross) * 100) : null;
  }

  return [...by.values()].sort((a, b) => b.fee - a.fee);
}

/* ── Settlement timeline ─────────────────────────────────────────────────── */

export type TimelineRow = {
  date: string;
  settled: number;
  awaiting: number;
  exception: number;
  total: number;
  count: number;
};

/** Bank credits per calendar day, split by state. Undated credits are excluded
 *  rather than bucketed — a timeline has nowhere honest to put them (aging
 *  above is where they surface instead). */
export function settlementTimeline(lines: InsightLine[]): TimelineRow[] {
  const by = new Map<string, TimelineRow>();

  for (const l of lines) {
    if (!l.date) continue;
    const day = l.date.slice(0, 10);
    const row = by.get(day) ?? { date: day, settled: 0, awaiting: 0, exception: 0, total: 0, count: 0 };

    if (l.state === "SETTLED") row.settled = round2(row.settled + l.bankAmount);
    else if (l.state === "AWAITING_PAYOUT") row.awaiting = round2(row.awaiting + l.bankAmount);
    else row.exception = round2(row.exception + l.bankAmount);

    row.total = round2(row.total + l.bankAmount);
    row.count += 1;
    by.set(day, row);
  }

  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/* ── Exceptions ──────────────────────────────────────────────────────────── */

export type ExceptionRow = {
  gateway: string;
  varianceAed: number;
  unresolvedOrders: number;
  lineCount: number;
};

/** Exception exposure per gateway. Variance is summed as ABSOLUTE value: a
 *  +500 surplus and a -500 shortfall are two things to explain, not zero. */
export function exceptionsByGateway(lines: InsightLine[]): ExceptionRow[] {
  const by = new Map<string, ExceptionRow>();

  for (const l of lines) {
    if (l.state !== "PAYOUT_VARIANCE" && l.state !== "ORDERS_UNRESOLVED") continue;
    const row = by.get(l.provider) ?? { gateway: l.provider, varianceAed: 0, unresolvedOrders: 0, lineCount: 0 };
    row.varianceAed = round2(row.varianceAed + Math.abs(l.variance));
    row.unresolvedOrders += l.unresolvedRefs.length;
    row.lineCount += 1;
    by.set(l.provider, row);
  }

  return [...by.values()].sort((a, b) => b.varianceAed - a.varianceAed);
}

/* ── FX drift ────────────────────────────────────────────────────────────── */

export type FxDriftRow = {
  id: string;
  gateway: string;
  date: string | null;
  currency: string;
  fxRate: number | null;
  fxSource: "bank" | "estimate" | null;
  /** How far our parse-time estimate sat from the bank's real wire rate. This
   *  is a conversion artifact — nobody was charged it. */
  rateDriftAed: number;
  /** What the gateway genuinely deducted to convert. This one is a real cost. */
  fxFeeAed: number;
  netAed: number;
};

/** Cross-border payouts whose AED figure moved when the bank's own quoted rate
 *  replaced our static estimate. Sub-cent movement is rounding noise and is
 *  filtered out — listing it would train the reader to ignore the list. */
export function fxDriftRows(lines: InsightLine[]): FxDriftRow[] {
  return lines
    .filter((l) => l.payout?.currency && l.rateDriftAed != null && Math.abs(l.rateDriftAed) >= 0.01)
    .map((l) => ({
      id: l.id,
      gateway: l.provider,
      date: l.date,
      currency: l.payout!.currency!,
      fxRate: l.payout!.fxRate,
      fxSource: l.payout!.fxSource,
      rateDriftAed: l.rateDriftAed!,
      fxFeeAed: l.fxFeeAed ?? 0,
      netAed: l.payout!.net,
    }))
    .sort((a, b) => Math.abs(b.rateDriftAed) - Math.abs(a.rateDriftAed));
}

/* ── Headline totals for the Insights tab ────────────────────────────────── */

export type InsightTotals = {
  inTransit: number;
  inTransitCount: number;
  settledAed: number;
  settledCount: number;
  feeAed: number;
  blendedFeePct: number | null;
  exceptionAed: number;
  exceptionCount: number;
  overdueCount: number;
};

export function insightTotals(lines: InsightLine[], now: number = Date.now()): InsightTotals {
  const aging = agingByGateway(lines, now);
  const fees = feeBurnByGateway(lines);
  const exceptions = exceptionsByGateway(lines);

  const gross = fees.reduce((s, f) => s + f.gross, 0);
  const fee = fees.reduce((s, f) => s + f.fee, 0);
  const settled = lines.filter((l) => l.state === "SETTLED");

  return {
    inTransit: round2(aging.reduce((s, a) => s + a.total, 0)),
    inTransitCount: aging.reduce((s, a) => s + a.count, 0),
    settledAed: round2(settled.reduce((s, l) => s + l.bankAmount, 0)),
    settledCount: settled.length,
    feeAed: round2(fee),
    blendedFeePct: gross > 0 ? round2((fee / gross) * 100) : null,
    exceptionAed: round2(exceptions.reduce((s, e) => s + e.varianceAed, 0)),
    exceptionCount: exceptions.reduce((s, e) => s + e.lineCount, 0),
    overdueCount: lines.filter(
      (l) =>
        l.state === "AWAITING_PAYOUT" &&
        l.date != null &&
        Math.floor((now - new Date(l.date).getTime()) / 86_400_000) > 7,
    ).length,
  };
}
