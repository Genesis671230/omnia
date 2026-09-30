/* Pure aggregation for the Ledger tab — client-safe, no I/O.
 *
 * Sign conventions follow the account's nature, so every figure reads the way
 * the accountant reads it in Zoho:
 *   · clearing / bank / receivable / Input VAT / fees are debit-natured:
 *     movement = debit − credit (money in, cost incurred)
 *   · sales and Output VAT are credit-natured: credit − debit
 *   · Exchange gain or loss: credit − debit, so a GAIN is positive
 */

export type LedgerGroup = "clearing" | "bank" | "sales" | "receivable" | "tax" | "fees" | "fx" | "refunds";

export type LedgerAccountInfo = {
  account_id: string;
  name: string;
  type: string;
  group: LedgerGroup;
  balance: number | null;
  currency: string;
};

export type LedgerLine = {
  id: string;
  accountId: string;
  date: string | null;
  type: string;
  typeLabel: string;
  txnId: string;
  entry: string;
  ref: string;
  payee: string;
  desc: string;
  offset: string;
  debit: number;
  credit: number;
  /** Tied to something Omnia booked or matched (payout, settlement, bank line). null = not checked for this group. */
  linked: boolean | null;
  /** Zoho's own reconcile_status for the line ("reconciled", "unreconciled", …). */
  zohoRec: string;
};

export const GROUP_LABEL: Record<LedgerGroup, string> = {
  clearing: "Gateway clearing",
  bank: "Bank & cash",
  sales: "Sales",
  receivable: "Receivables",
  tax: "VAT",
  fees: "Fees",
  fx: "Exchange",
  refunds: "Refunds",
};

const r2 = (n: number) => Math.round(n * 100) / 100;

const CREDIT_NATURED = (a: LedgerAccountInfo) =>
  a.group === "sales" || a.group === "fx" || a.group === "refunds" || /output vat/i.test(a.name);

export function movement(a: LedgerAccountInfo, debit: number, credit: number): number {
  return r2(CREDIT_NATURED(a) ? credit - debit : debit - credit);
}

/** Clearing / bank account name → gateway key used by the shared palette. */
export function gatewayOf(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("tabby")) return "Tabby";
  if (n.includes("tamara")) return "Tamara";
  if (n.includes("telr")) return "Telr";
  if (n.includes("stripe")) return "Stripe";
  if (n.includes("checkout")) return "Checkout";
  if (n.includes("shopify")) return "Shopify Payments";
  if (/delivery|on ?track|smsa|cod/.test(n)) return "COD";
  return "Unclassified";
}

export type AccountSummary = LedgerAccountInfo & {
  debit: number;
  credit: number;
  /** In the account's natural sign — see movement(). */
  net: number;
  lineCount: number;
  unlinked: number;
  /** balance − this month's movement; only meaningful for the current month. */
  opening: number | null;
};

export function summarizeAccounts(
  accounts: LedgerAccountInfo[], lines: LedgerLine[], opts: { isCurrentMonth: boolean },
): AccountSummary[] {
  const byId = new Map<string, { d: number; c: number; n: number; u: number }>();
  for (const l of lines) {
    const s = byId.get(l.accountId) ?? { d: 0, c: 0, n: 0, u: 0 };
    s.d += l.debit; s.c += l.credit; s.n += 1; if (l.linked === false) s.u += 1;
    byId.set(l.accountId, s);
  }
  return accounts.map((a) => {
    const s = byId.get(a.account_id) ?? { d: 0, c: 0, n: 0, u: 0 };
    const net = movement(a, s.d, s.c);
    // Zoho balances for asset accounts are debit − credit; for a
    // credit-natured account we never hold a balance, so opening stays null.
    const opening = opts.isCurrentMonth && a.balance != null && !CREDIT_NATURED(a) ? r2(a.balance - (s.d - s.c)) : null;
    return { ...a, debit: r2(s.d), credit: r2(s.c), net, lineCount: s.n, unlinked: s.u, opening };
  }).sort((x, y) => y.lineCount - x.lineCount);
}

export type LedgerTotals = {
  sales: number;
  clearingIn: number;
  clearingOut: number;
  openClearing: number;
  fees: number;
  inputVat: number;
  fxNet: number;
  unlinked: number;
  lineCount: number;
};

export function ledgerTotals(summaries: AccountSummary[]): LedgerTotals {
  const t: LedgerTotals = { sales: 0, clearingIn: 0, clearingOut: 0, openClearing: 0, fees: 0, inputVat: 0, fxNet: 0, unlinked: 0, lineCount: 0 };
  for (const s of summaries) {
    t.unlinked += s.unlinked;
    t.lineCount += s.lineCount;
    if (s.group === "sales" && /^sales$/i.test(s.name.trim())) t.sales += s.net;
    if (s.group === "clearing") { t.clearingIn += s.debit; t.clearingOut += s.credit; t.openClearing += s.balance ?? 0; }
    if (s.group === "fees" && /gateway/i.test(s.name)) t.fees += s.net;
    if (s.group === "tax" && /input vat/i.test(s.name)) t.inputVat += s.net;
    if (s.group === "fx") t.fxNet += s.net;
  }
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, k === "unlinked" || k === "lineCount" ? v : r2(v)])) as LedgerTotals;
}

export type DailyPoint = { day: string; label: string; sales: number; clearingIn: number; bankIn: number };

export function dailyFlow(accounts: LedgerAccountInfo[], lines: LedgerLine[], range: { start: string; end: string }): DailyPoint[] {
  const acct = new Map(accounts.map((a) => [a.account_id, a]));
  const days = new Map<string, DailyPoint>();
  const endDay = Number(range.end.slice(8, 10));
  for (let d = 1; d <= endDay; d++) {
    const day = `${range.start.slice(0, 8)}${String(d).padStart(2, "0")}`;
    days.set(day, { day, label: String(d), sales: 0, clearingIn: 0, bankIn: 0 });
  }
  for (const l of lines) {
    const a = acct.get(l.accountId);
    const p = l.date ? days.get(l.date.slice(0, 10)) : undefined;
    if (!a || !p) continue;
    if (a.group === "sales" && /^sales$/i.test(a.name.trim())) p.sales += l.credit - l.debit;
    else if (a.group === "clearing") p.clearingIn += l.debit;
    else if (a.group === "bank") p.bankIn += l.debit;
  }
  return [...days.values()].map((p) => ({ ...p, sales: r2(p.sales), clearingIn: r2(p.clearingIn), bankIn: r2(p.bankIn) }));
}

export type DeductionRow = { source: string; gateway: string; fees: number; vat: number; fxLoss: number; total: number };

/**
 * Fees, the VAT on them and FX differences, attributed to the clearing
 * account they were paid through (Zoho's offset account on the expense /
 * journal line). Lines with no offset land in "Unattributed".
 */
export function deductionsBySource(accounts: LedgerAccountInfo[], lines: LedgerLine[]): DeductionRow[] {
  const acct = new Map(accounts.map((a) => [a.account_id, a]));
  const rows = new Map<string, DeductionRow>();
  for (const l of lines) {
    const a = acct.get(l.accountId);
    if (!a) continue;
    const isFee = a.group === "fees" && /gateway/i.test(a.name);
    const isVat = a.group === "tax" && /input vat/i.test(a.name);
    const isFx = a.group === "fx";
    if (!isFee && !isVat && !isFx) continue;
    const source = l.offset.trim() || "Unattributed";
    const row = rows.get(source) ?? { source, gateway: gatewayOf(source), fees: 0, vat: 0, fxLoss: 0, total: 0 };
    const dr = l.debit - l.credit;
    if (isFee) row.fees += dr;
    else if (isVat) row.vat += dr;
    else row.fxLoss += dr; // debit to FX = loss
    rows.set(source, row);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, fees: r2(r.fees), vat: r2(r.vat), fxLoss: r2(r.fxLoss), total: r2(r.fees + r.vat + r.fxLoss) }))
    .filter((r) => r.total !== 0 || r.fees !== 0)
    .sort((a, b) => b.total - a.total);
}

export type TypeMixRow = { type: string; count: number; amount: number };

export function typeMix(lines: LedgerLine[]): TypeMixRow[] {
  const m = new Map<string, TypeMixRow>();
  for (const l of lines) {
    const k = l.typeLabel || l.type || "Other";
    const r = m.get(k) ?? { type: k, count: 0, amount: 0 };
    r.count += 1; r.amount += Math.max(l.debit, l.credit);
    m.set(k, r);
  }
  return [...m.values()].map((r) => ({ ...r, amount: r2(r.amount) })).sort((a, b) => b.count - a.count);
}

/** Running balance per day for one account (current month only — needs an opening). */
export function runningBalance(summary: AccountSummary, lines: LedgerLine[]): { day: string; balance: number }[] {
  if (summary.opening == null) return [];
  const byDay = new Map<string, number>();
  for (const l of lines) {
    if (l.accountId !== summary.account_id || !l.date) continue;
    const d = l.date.slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + l.debit - l.credit);
  }
  let bal = summary.opening;
  return [...byDay.keys()].sort().map((day) => { bal += byDay.get(day)!; return { day, balance: r2(bal) }; });
}
