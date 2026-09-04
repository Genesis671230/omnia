// Pure computation over payments-sheet rows — no I/O, no server-only
// imports. Split out of payments-sheet.ts (which does the actual Google
// Sheets fetch) specifically so this half is safe to import from a client
// component too: the sheet-insights API returns the full PaymentSheetRow[]
// once, and the client re-runs these exact same functions locally for
// instant date-range/gateway filtering — no refetch per filter change, and
// server and client are guaranteed to agree on the numbers because it's
// the same code.

export const SHEET_TABS = { smsa: "SMSA Orders", local: "Local orders" } as const;
export type SheetTabKey = keyof typeof SHEET_TABS;

export type PartyInfo = {
  raw: string;
  /** Single resolved gateway name, or null when split/unresolvable. */
  canonical: string | null;
  isSplit: boolean;
};

export type PaymentSheetRow = {
  tab: SheetTabKey;
  rowNumber: number; // 1-indexed, matches the sheet's own row numbers
  orderNumber: string | null;
  date: string | null; // ISO, parsed from the sheet's Date column
  party: PartyInfo;
  /** Raw sale-type cell — SMSA's "Part" column, Local's "Type of Sale". */
  saleType: string;
  /** True when saleType names an exchange — the authoritative exchange
   *  signal. Independent of whether party.canonical resolved a real
   *  gateway — an exchange can still be gateway-paid. */
  isExchange: boolean;
  currency: string | null; // SMSA only; null on Local (implicitly AED)
  region: string; // "KSA" | "UAE" | "KWD" | "OMR" | "QAR" | "BHD" | ""
  /** Gateway + region, e.g. "Tabby KSA", "Tabby UAE" — for the insights
   *  breakdown ONLY. Never compare this against a Zoho invoice's gateway
   *  field, which has no region suffix. */
  gatewayLabel: string | null;
  actualPaymentStatus: string;
  paymentReceivedRaw: string;
  paymentReceivedDate: string | null; // ISO, parsed from paymentReceivedRaw
  amountAed: number;
  cancelledAmount: number;
  isDuplicateFlagged: boolean;
};

export type PeriodStats = {
  totalOrders: number;
  received: { count: number; amountAed: number };
  pending: { count: number };
  exchange: { count: number };
  /** "Returns" and "cancelled" collapse to one metric — the sheet has a
   *  single "Cancelled / Refunded Amount" column, no signal to split them. */
  cancelled: { count: number; amountAed: number };
};

export type SheetInsights = {
  spreadsheetId: string;
  periods: {
    today: PeriodStats;
    yesterday: PeriodStats;
    thisWeek: PeriodStats;
    thisMonth: PeriodStats;
    allTime: PeriodStats;
  };
  rowCount: number;
  fetchedAt: string;
};

// What GET /api/invoices/sheet-insights actually returns: the fixed
// periods above, a server-computed gateway breakdown for the request's
// [from, to], and the full row set so the client can recompute that same
// breakdown locally for any OTHER date range without a refetch.
export type SheetInsightsResponse = SheetInsights & {
  gatewayBreakdown: GatewayBreakdownRow[];
  rows: PaymentSheetRow[];
};

export function emptyPeriodStats(): PeriodStats {
  return { totalOrders: 0, received: { count: 0, amountAed: 0 }, pending: { count: 0 }, exchange: { count: 0 }, cancelled: { count: 0, amountAed: 0 } };
}

// A row can be exchange AND received (paid) AND have a cancelled amount
// (partial refund on an exchange) all at once — these are independent
// facts, so every bucket below is additive, not a single mutually-exclusive
// bucket per row. "Pending" is the one exception: it only means "confirmed
// nothing yet" (not received, not cancelled) — an exchange row that's also
// unpaid still counts as pending, since ops still needs to chase that.
function addRowToStats(stats: PeriodStats, row: PaymentSheetRow): void {
  stats.totalOrders++;
  const isReceived = row.actualPaymentStatus.toLowerCase() === "payment received";
  const isCancelled = row.cancelledAmount > 0;
  if (isCancelled) { stats.cancelled.count++; stats.cancelled.amountAed += row.cancelledAmount; }
  if (row.isExchange) stats.exchange.count++;
  if (isReceived) { stats.received.count++; stats.received.amountAed += row.amountAed; }
  else if (!isCancelled) stats.pending.count++;
}

// Dubai-local (UTC+4) day boundaries, matching the convention already used
// for dispatch timing elsewhere (lib/integrations/dispatch-sheet.ts).
function dubaiDayKey(date: Date): string {
  const dubai = new Date(date.getTime() + 4 * 60 * 60_000);
  return dubai.toISOString().slice(0, 10);
}

export function computeSheetInsights(rows: PaymentSheetRow[], spreadsheetId: string): SheetInsights {
  const now = new Date();
  const todayKey = dubaiDayKey(now);
  const yesterdayKey = dubaiDayKey(new Date(now.getTime() - 24 * 60 * 60_000));
  const weekAgoKey = dubaiDayKey(new Date(now.getTime() - 7 * 24 * 60 * 60_000));
  const monthStartKey = todayKey.slice(0, 7) + "-01";

  const periods = {
    today: emptyPeriodStats(),
    yesterday: emptyPeriodStats(),
    thisWeek: emptyPeriodStats(),
    thisMonth: emptyPeriodStats(),
    allTime: emptyPeriodStats(),
  };

  for (const row of rows) {
    addRowToStats(periods.allTime, row);
    if (!row.date) continue;
    if (row.date === todayKey) addRowToStats(periods.today, row);
    if (row.date === yesterdayKey) addRowToStats(periods.yesterday, row);
    if (row.date >= weekAgoKey && row.date <= todayKey) addRowToStats(periods.thisWeek, row);
    if (row.date >= monthStartKey && row.date <= todayKey) addRowToStats(periods.thisMonth, row);
  }

  return { spreadsheetId, periods, rowCount: rows.length, fetchedAt: new Date().toISOString() };
}

export type GatewayBreakdownRow = {
  gatewayLabel: string;
  totalOrders: number;
  received: { count: number; amountAed: number };
  pending: { count: number };
  exchange: { count: number };
  cancelled: { count: number; amountAed: number };
};

function inDateWindow(row: PaymentSheetRow, from: string | null, to: string | null): boolean {
  if (!from && !to) return true;
  if (!row.date) return false;
  if (from && row.date < from) return false;
  if (to && row.date > to) return false;
  return true;
}

// Per-(gateway+region) breakdown — "prove this many orders from that
// gateway, and cancelled/returned this much" — over an arbitrary date
// window. Rows with no resolvable gateway (blank Party, pure "Exchange"
// with nothing else, unrecognized text) are grouped under "Unresolved"
// rather than dropped, so the total still foots against rowCount.
export function computeGatewayBreakdown(rows: PaymentSheetRow[], from: string | null, to: string | null): GatewayBreakdownRow[] {
  const byGateway = new Map<string, GatewayBreakdownRow>();
  for (const row of rows) {
    if (!inDateWindow(row, from, to)) continue;
    const key = row.gatewayLabel ?? "Unresolved";
    let bucket = byGateway.get(key);
    if (!bucket) {
      bucket = { gatewayLabel: key, totalOrders: 0, received: { count: 0, amountAed: 0 }, pending: { count: 0 }, exchange: { count: 0 }, cancelled: { count: 0, amountAed: 0 } };
      byGateway.set(key, bucket);
    }
    bucket.totalOrders++;
    const isReceived = row.actualPaymentStatus.toLowerCase() === "payment received";
    const isCancelled = row.cancelledAmount > 0;
    if (isCancelled) { bucket.cancelled.count++; bucket.cancelled.amountAed += row.cancelledAmount; }
    if (row.isExchange) bucket.exchange.count++;
    if (isReceived) { bucket.received.count++; bucket.received.amountAed += row.amountAed; }
    else if (!isCancelled) bucket.pending.count++;
  }

  return [...byGateway.values()].sort((a, b) => b.totalOrders - a.totalOrders);
}

export type ExchangeRow = {
  tab: SheetTabKey;
  rowNumber: number;
  orderNumber: string;
  date: string | null;
  saleType: string;
  gatewayLabel: string | null;
};

// Exchange rows in a date window, for the "pull out the corresponding
// order and SKUs" drill-down (order line_items are joined separately, from
// Supabase — this stays pure, no DB access).
export function listExchangeRows(rows: PaymentSheetRow[], from: string | null, to: string | null): ExchangeRow[] {
  return rows
    .filter((r) => r.isExchange && r.orderNumber && inDateWindow(r, from, to))
    .map((r) => ({ tab: r.tab, rowNumber: r.rowNumber, orderNumber: r.orderNumber!, date: r.date, saleType: r.saleType, gatewayLabel: r.gatewayLabel }));
}
