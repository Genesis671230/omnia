/* What a reconciliation row IS, in one word, for the table and its filters.
 * Pure and client-safe (no DB imports), so the page and tests share it.
 *
 * Every label means exactly one thing:
 *   matched     bank credit = payout net within AED 1, every order found
 *   force       the payout matched but a gap remains that is booked on its own:
 *               the bank's small wire cut (auto) or a founder's force-book
 *   exception   needs a person: unmatched orders, or a gap too big to pass
 *   awaiting    no payout file explains this credit yet
 */

export type MatchKind = "matched" | "force" | "exception" | "awaiting";

type Line = {
  state: "SETTLED" | "PAYOUT_VARIANCE" | "ORDERS_UNRESOLVED" | "AWAITING_PAYOUT";
  bankAmount: number;
  variance: number;
  payout: unknown | null;
  resolvedOrders: string[];
  forceBook: unknown | null;
  confirmedBy: string | null;
  reviewFlag: boolean;
};

// Mirrors bankFxVarianceLimit() in engine.ts (server-only module).
const bankCutLimit = (bankAmount: number) => Math.max(1, Math.min(Math.abs(bankAmount) * 0.01, 500));

export function matchKind(l: Line): { kind: MatchKind; gap: number } {
  const gap = Math.round(l.variance * 100) / 100;
  if (l.state === "AWAITING_PAYOUT") return { kind: "awaiting", gap: 0 };
  if (l.state === "SETTLED") return { kind: "matched", gap };
  if (l.state === "PAYOUT_VARIANCE" && l.payout && l.resolvedOrders.length > 0) {
    if (l.forceBook && l.confirmedBy) return { kind: "force", gap };
    if (Math.abs(l.variance) <= bankCutLimit(l.bankAmount)) return { kind: "force", gap };
  }
  return { kind: "exception", gap };
}

export type StatusFilter = "all" | "settled" | "awaiting" | "exceptions" | "flagged";

export function inStatus(l: Line, f: StatusFilter): boolean {
  const k = matchKind(l).kind;
  switch (f) {
    case "all": return true;
    case "settled": return k === "matched" || k === "force";
    case "awaiting": return k === "awaiting";
    // A flag means "someone should look", so flagged rows belong here even when the math foots.
    case "exceptions": return k === "exception" || l.reviewFlag;
    case "flagged": return l.reviewFlag;
  }
}

/** Day-over-day KPI figures for a set of lines on one bank date. */
export function dayKpis(lines: Line[]) {
  const total = lines.reduce((s, l) => s + l.bankAmount, 0);
  const settledAed = lines.filter((l) => inStatus(l, "settled")).reduce((s, l) => s + l.bankAmount, 0);
  return {
    credits: lines.length,
    aed: total,
    pctSettled: total > 0 ? (settledAed / total) * 100 : 0,
    exceptions: lines.filter((l) => inStatus(l, "exceptions")).length,
    variance: lines.filter((l) => l.payout).reduce((s, l) => s + Math.abs(l.variance), 0),
  };
}
