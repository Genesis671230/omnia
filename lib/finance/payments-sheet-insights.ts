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
  /** The payout batch's declared total, parsed from the parenthesised
   *  figure in paymentReceivedRaw ("… (25,794.83)") — the SAME number on
   *  every order row that settled in that batch, so it doubles as the
   *  batch's identity. Null when the note carries no parens amount. */
  paymentBatchTotalAed: number | null;
  amountAed: number;
  cancelledAmount: number;
  isDuplicateFlagged: boolean;
  /** The gateway's own reported gross for this order (SMSA's "Total Amt
   *  from Gateway") — more accurate than amountAed for Gross Sales when
   *  present, since amountAed is Omnia's own FX estimate and this is the
   *  gateway's actual converted figure. Null when the column is absent or
   *  blank on this row (older rows, or a month registered before this
   *  column existed) — never derived/guessed. */
  gatewayGrossAed: number | null;
  /** "Fee Deducted" — 0 when absent (never null; a fee genuinely is 0 when
   *  not yet confirmed, so this participates in sums safely by default). */
  feeDeductedAed: number;
  /** "Amount After Deduction" — null when absent. Callers that need a net
   *  figure and get null should derive gatewayGrossAed - feeDeductedAed
   *  themselves rather than this file silently doing it, so it's always
   *  clear which figure is the sheet's own vs. computed. */
  netAfterFeeAed: number | null;
  /** "Fee%" (SMSA) / "% Charged" (Local) as literally entered in the sheet
   *  — null when absent. Not the same as a computed fee percentage; kept
   *  separate so a discrepancy between the two is visible, not hidden. */
  feePercentRaw: number | null;
};

export type PeriodStats = {
  totalOrders: number;
  received: { count: number; amountAed: number };
  pending: { count: number };
  exchange: { count: number };
  /** "Returns" and "cancelled" collapse to one metric — the sheet has a
   *  single "Cancelled / Refunded Amount" column, no signal to split them. */
  cancelled: { count: number; amountAed: number };
  grossAed: number;
  feesAed: number;
  netAed: number;
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
  return {
    totalOrders: 0, received: { count: 0, amountAed: 0 }, pending: { count: 0 },
    exchange: { count: 0 }, cancelled: { count: 0, amountAed: 0 },
    grossAed: 0, feesAed: 0, netAed: 0,
  };
}

// Gross prefers the gateway's own reported figure (Task 3) over Omnia's FX
// estimate (amountAed) when present; net trusts the sheet's own Amount
// After Deduction exactly when present, only deriving gross-fees as a
// fallback (never a guessed/estimated figure when a real one is missing).
export function grossFeeNetForRow(row: PaymentSheetRow): { gross: number; fees: number; net: number } {
  const gross = row.gatewayGrossAed ?? row.amountAed;
  const fees = row.feeDeductedAed;
  const net = row.netAfterFeeAed ?? +(gross - fees).toFixed(2);
  return { gross, fees, net };
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

  const { gross, fees, net } = grossFeeNetForRow(row);
  stats.grossAed += gross;
  stats.feesAed += fees;
  stats.netAed += net;
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
  grossAed: number;
  feesAed: number;
  netAed: number;
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
      bucket = {
        gatewayLabel: key, totalOrders: 0, received: { count: 0, amountAed: 0 }, pending: { count: 0 },
        exchange: { count: 0 }, cancelled: { count: 0, amountAed: 0 }, grossAed: 0, feesAed: 0, netAed: 0,
      };
      byGateway.set(key, bucket);
    }
    bucket.totalOrders++;
    const isReceived = row.actualPaymentStatus.toLowerCase() === "payment received";
    const isCancelled = row.cancelledAmount > 0;
    if (isCancelled) { bucket.cancelled.count++; bucket.cancelled.amountAed += row.cancelledAmount; }
    if (row.isExchange) bucket.exchange.count++;
    if (isReceived) { bucket.received.count++; bucket.received.amountAed += row.amountAed; }
    else if (!isCancelled) bucket.pending.count++;

    const { gross, fees, net } = grossFeeNetForRow(row);
    bucket.grossAed += gross;
    bucket.feesAed += fees;
    bucket.netAed += net;
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

export type FeeRanking = {
  best: { gatewayLabel: string; feePercent: number } | null;
  worst: { gatewayLabel: string; feePercent: number } | null;
};

// "Highest/lowest, based on the analytics" = best/worst gateway by fee % —
// confirmed with the founder. Only gateways that actually processed volume
// (grossAed > 0) are eligible, so a gateway with nothing run through it
// this period can never spuriously win or lose on a 0/0 fee percent.
export function bestWorstGatewayByFeePercent(breakdown: GatewayBreakdownRow[]): FeeRanking {
  const eligible = breakdown
    .filter((b) => b.grossAed > 0)
    .map((b) => ({ gatewayLabel: b.gatewayLabel, feePercent: +((b.feesAed / b.grossAed) * 100).toFixed(2) }));
  if (eligible.length === 0) return { best: null, worst: null };
  const sorted = [...eligible].sort((a, b) => a.feePercent - b.feePercent);
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}

// ─── Payout breakdown ────────────────────────────────────────────────────
//
// One gateway payout ("Payment Received on 05.09.2026 (25,794.83)") routinely
// settles orders from more than one calendar month at once — a September
// Tabby payout paying for late-August orders. This groups the received rows
// back into their settlement batches and, within each batch, splits the
// money by the ORDER's own month, so "September's payout was AED 25,794.83,
// of which AED 9,220.10 was actually August's orders" is visible rather than
// lumped. Pure over the row set the API already returns — no refetch.

// "Payment Received on 05.09.2026 (25,794.83)" -> 25794.83. The parens
// figure is the whole payout batch's declared total (shared across every
// order in the batch). Null when the note has no parenthesised amount.
const PAYMENT_BATCH_TOTAL_RE = /\(\s*([\d,]+(?:\.\d+)?)\s*\)/;
export function parsePaymentBatchTotal(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const m = PAYMENT_BATCH_TOTAL_RE.exec(raw);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// The settlement date out of a "Payment Received on …" note. Ops types this
// by hand and isn't consistent — "05.09.2026", "5/9/2026", "05-Sep-2026",
// "2026-09-05" all show up — so this is deliberately permissive. Day-first
// (DD.MM.YYYY) is the business convention (its Date column is "01.Aug.2026"),
// and the parenthesised payout total is stripped first so its digits can't
// be misread as a date. Returns null when nothing date-shaped is present —
// which computePaymentDateAudit then surfaces rather than letting the row
// vanish from the settlement-month views.
const NOTE_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function toIso(year: string, month: number, day: number): string {
  let y = Number(year);
  if (y < 100) y += 2000;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
export function parsePaymentReceivedNote(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.replace(/\([^)]*\)/g, " ");

  let m = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(s); // ISO-ish, any separator
  if (m) return toIso(m[1], Number(m[2]), Number(m[3]));

  m = /(\d{1,2})[.\-/ ]+([A-Za-z]{3,})[.\-/, ]+(\d{2,4})/.exec(s); // 05-Sep-2026
  if (m) {
    const mi = NOTE_MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi !== -1) return toIso(m[3], mi + 1, Number(m[1]));
  }

  m = /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/.exec(s); // 05.09.2026 (day-first)
  if (m) {
    let day = Number(m[1]);
    let mon = Number(m[2]);
    if (mon > 12 && day <= 12) [day, mon] = [mon, day]; // clearly the other way round
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return toIso(m[3], mon, day);
  }
  return null;
}

// Verified payments ("Payment Received") whose settlement date couldn't be
// read from the note. These are the rows that would otherwise silently drop
// out of every payout-month view — surfaced so ops can fix the sheet.
export type PaymentDateAuditRow = {
  orderNumber: string | null;
  orderDate: string | null;
  amountAed: number;
  gatewayLabel: string | null;
  paymentReceivedRaw: string;
  tab: SheetTabKey;
  rowNumber: number;
};
export type PaymentDateAudit = { count: number; amountAed: number; rows: PaymentDateAuditRow[] };

export function computePaymentDateAudit(rows: PaymentSheetRow[]): PaymentDateAudit {
  const bad = rows.filter(
    (r) => r.actualPaymentStatus.toLowerCase() === "payment received" && !r.paymentReceivedDate,
  );
  return {
    count: bad.length,
    amountAed: +bad.reduce((s, r) => s + r.amountAed, 0).toFixed(2),
    rows: bad.map((r) => ({
      orderNumber: r.orderNumber, orderDate: r.date, amountAed: r.amountAed,
      gatewayLabel: r.gatewayLabel, paymentReceivedRaw: r.paymentReceivedRaw, tab: r.tab, rowNumber: r.rowNumber,
    })),
  };
}

// "2026-08" -> "Aug 2026". Kept here (not in the chart) so the payout table
// and the chart's monthly axis can't disagree on how a month is spelled.
export function monthLabel(monthKey: string): string {
  if (monthKey === "undated") return "Undated";
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) return monthKey;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export type PayoutOrderMonthSplit = {
  monthKey: string; // "YYYY-MM", or "undated" when the order row has no parseable Date
  label: string;
  amountAed: number;
  orderCount: number;
};

export type PayoutGroupOrder = {
  orderNumber: string | null;
  date: string | null;
  monthKey: string; // "YYYY-MM" | "undated"
  amountAed: number;
  region: string;
  tab: SheetTabKey;
  rowNumber: number;
};

export type PayoutGroup = {
  key: string;
  gatewayLabel: string;
  settlementDate: string; // ISO — the payout date, from paymentReceivedDate
  /** The batch's own declared total (parsed parens). Null when never recorded. */
  declaredTotalAed: number | null;
  /** Sum of the amountAed of every order row in this batch. */
  matchedTotalAed: number;
  /** matchedTotalAed - declaredTotalAed, rounded to cents. Null when there is
   *  no declared total to compare against. Non-zero means the order rows
   *  don't foot to what the payout said it paid — worth a look. */
  varianceAed: number | null;
  orderCount: number;
  /** The batch split by the order's own calendar month, oldest first. */
  byOrderMonth: PayoutOrderMonthSplit[];
  orders: PayoutGroupOrder[];
};

function monthKeyOf(iso: string | null): string {
  return iso ? iso.slice(0, 7) : "undated";
}

// Groups received rows into settlement batches keyed by
// gateway + payout date + declared total (the parens figure is the batch's
// natural identity; gateway+date alone would merge two same-day payouts from
// the same gateway, and adding the total separates those). Windowed on the
// PAYOUT date (paymentReceivedDate), not the order date — you're looking at
// "the September payouts". Rows with no confirmed payment date are skipped
// (nothing has settled for them yet).
export function computePayoutBreakdown(
  rows: PaymentSheetRow[],
  from: string | null,
  to: string | null,
): PayoutGroup[] {
  const byBatch = new Map<string, PayoutGroup & { _months: Map<string, PayoutOrderMonthSplit> }>();

  for (const row of rows) {
    if (row.actualPaymentStatus.toLowerCase() !== "payment received") continue;
    if (!row.paymentReceivedDate) continue;
    if (from && row.paymentReceivedDate < from) continue;
    if (to && row.paymentReceivedDate > to) continue;

    const gatewayLabel = row.gatewayLabel ?? "Unresolved";
    const totalTag = row.paymentBatchTotalAed == null ? "?" : row.paymentBatchTotalAed.toFixed(2);
    const key = `${gatewayLabel}|${row.paymentReceivedDate}|${totalTag}`;

    let batch = byBatch.get(key);
    if (!batch) {
      batch = {
        key,
        gatewayLabel,
        settlementDate: row.paymentReceivedDate,
        declaredTotalAed: row.paymentBatchTotalAed,
        matchedTotalAed: 0,
        varianceAed: null,
        orderCount: 0,
        byOrderMonth: [],
        orders: [],
        _months: new Map(),
      };
      byBatch.set(key, batch);
    }

    const mk = monthKeyOf(row.date);
    batch.matchedTotalAed = +(batch.matchedTotalAed + row.amountAed).toFixed(2);
    batch.orderCount++;
    batch.orders.push({
      orderNumber: row.orderNumber,
      date: row.date,
      monthKey: mk,
      amountAed: row.amountAed,
      region: row.region,
      tab: row.tab,
      rowNumber: row.rowNumber,
    });

    let split = batch._months.get(mk);
    if (!split) {
      split = { monthKey: mk, label: monthLabel(mk), amountAed: 0, orderCount: 0 };
      batch._months.set(mk, split);
    }
    split.amountAed = +(split.amountAed + row.amountAed).toFixed(2);
    split.orderCount++;
  }

  const groups: PayoutGroup[] = [];
  for (const batch of byBatch.values()) {
    const { _months, ...rest } = batch;
    const byOrderMonth = [...(_months.values())].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    const varianceAed =
      rest.declaredTotalAed == null ? null : +(rest.matchedTotalAed - rest.declaredTotalAed).toFixed(2);
    rest.orders.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    groups.push({ ...rest, byOrderMonth, varianceAed });
  }

  // Newest payout first, then by gateway for a stable order within a day.
  return groups.sort(
    (a, b) => b.settlementDate.localeCompare(a.settlementDate) || a.gatewayLabel.localeCompare(b.gatewayLabel),
  );
}

// ─── Monthly rollup ──────────────────────────────────────────────────────
//
// One row per calendar month, two ways to cut it:
//
//   basis: "order"   — a month owns the orders PLACED in it. "Gross sales"
//     is every order's value that month, paid or not. "Net sales" is the
//     after-fee amount for that month's orders that have a confirmed payout
//     — so a July order sitting inside an early-August payout is NOT August
//     (its order date is July), and an August order paid out in September
//     joins August the moment that payout row is recorded. "Awaiting" is
//     that month's orders with no payout yet (it converts to net later).
//
//   basis: "payment" — a month owns the cash that SETTLED in it. "Received"
//     is the payout money that landed that month; "crossMonthIn" is how
//     much of it was actually for earlier-month orders (the amount you'd
//     subtract to get back to that month's own sales).
//
// Rows are split received/awaiting internally, so fees/net always reflect
// confirmed payouts only — never a guessed net for an unpaid order.

export type MonthlyRollupRow = {
  monthKey: string; // "YYYY-MM" | "undated"
  label: string;
  orderCount: number; // rows bucketed into this month
  /** Order basis: every order's gross this month. Payment basis: gross of the received rows. */
  grossAed: number;
  /** Gross of the received (paid) rows only — the denominator for fee %. */
  paidGrossAed: number;
  feesAed: number; // received rows only
  netAed: number; // received rows only, after fees
  receivedCount: number;
  receivedAed: number; // Σ amountAed of received rows
  awaitingCount: number; // order basis only — this month's orders with no payout yet
  awaitingAed: number; // order basis only — their gross, the amount that will become net
  cancelledAed: number;
  crossMonthInCount: number; // payment basis only — received rows whose ORDER month precedes this settlement month
  crossMonthInAed: number; // payment basis only — net of those (cash that belongs to an earlier month's sales)
  feePercent: number | null; // feesAed / paidGrossAed × 100
};

export type MonthlyRollupOptions = {
  from?: string | null;
  to?: string | null;
  basis?: "order" | "payment";
};

function emptyMonthlyRow(monthKey: string): MonthlyRollupRow {
  return {
    monthKey, label: monthLabel(monthKey), orderCount: 0, grossAed: 0, paidGrossAed: 0,
    feesAed: 0, netAed: 0, receivedCount: 0, receivedAed: 0, awaitingCount: 0, awaitingAed: 0,
    cancelledAed: 0, crossMonthInCount: 0, crossMonthInAed: 0, feePercent: null,
  };
}

export function computeMonthlyRollup(rows: PaymentSheetRow[], opts: MonthlyRollupOptions = {}): MonthlyRollupRow[] {
  const { from = null, to = null, basis = "order" } = opts;
  const byMonth = new Map<string, MonthlyRollupRow>();
  const get = (mk: string) => {
    let m = byMonth.get(mk);
    if (!m) { m = emptyMonthlyRow(mk); byMonth.set(mk, m); }
    return m;
  };

  for (const row of rows) {
    const isReceived = row.actualPaymentStatus.toLowerCase() === "payment received";
    const isCancelled = row.cancelledAmount > 0;
    const { gross, fees, net } = grossFeeNetForRow(row);
    const orderMonth = row.date ? row.date.slice(0, 7) : null;

    if (basis === "payment") {
      if (!isReceived || !row.paymentReceivedDate) continue; // no settlement to place
      const d = row.paymentReceivedDate;
      if (from && d < from) continue;
      if (to && d > to) continue;
      const mk = d.slice(0, 7);
      const m = get(mk);
      m.orderCount++;
      m.receivedCount++;
      m.receivedAed += row.amountAed;
      m.grossAed += gross;
      m.paidGrossAed += gross;
      m.feesAed += fees;
      m.netAed += net;
      if (isCancelled) m.cancelledAed += row.cancelledAmount;
      if (orderMonth && orderMonth < mk) {
        m.crossMonthInCount++;
        m.crossMonthInAed += net;
      }
    } else {
      const d = row.date;
      if (d) {
        if (from && d < from) continue;
        if (to && d > to) continue;
      } else if (from || to) {
        continue;
      }
      const m = get(d ? d.slice(0, 7) : "undated");
      m.orderCount++;
      m.grossAed += gross;
      if (isCancelled) m.cancelledAed += row.cancelledAmount;
      if (isReceived) {
        m.receivedCount++;
        m.receivedAed += row.amountAed;
        m.paidGrossAed += gross;
        m.feesAed += fees;
        m.netAed += net;
      } else if (!isCancelled) {
        m.awaitingCount++;
        m.awaitingAed += gross;
      }
    }
  }

  const round2 = (n: number) => +n.toFixed(2);
  const out = [...byMonth.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  for (const m of out) {
    m.grossAed = round2(m.grossAed);
    m.paidGrossAed = round2(m.paidGrossAed);
    m.feesAed = round2(m.feesAed);
    m.netAed = round2(m.netAed);
    m.receivedAed = round2(m.receivedAed);
    m.awaitingAed = round2(m.awaitingAed);
    m.cancelledAed = round2(m.cancelledAed);
    m.crossMonthInAed = round2(m.crossMonthInAed);
    m.feePercent = m.paidGrossAed > 0 ? round2((m.feesAed / m.paidGrossAed) * 100) : null;
  }
  return out;
}

// ─── Month reconciliation ────────────────────────────────────────────────
//
// The full month-close statement the founder reconciles against the bank.
// For a month M, every order placed in M ("dispatched sales", Σ the sheet's
// "In AED" / "Total" column) is one of:
//   • settled within M          — payout landed the same month
//   • settled in a later month  — still M's sales, collected later (a
//                                 subtraction line, NOT "net sales")
//   • still awaiting a payout   — no settlement yet
// and the cash that actually LANDED in M is:
//   • M's own orders settled in M   (= settled within M)
//   • plus earlier-month orders whose payout landed in M   (carried in)
// so   cash received in M  =  dispatched(M) − settled-later(M) − awaiting(M)
//                             + carried-in(M).
//
// Every figure is split International (the SMSA tab) vs Local (the Local
// tab). "Carried in" only fills in when the previous month's sheet is also
// in the row set — otherwise those earlier orders aren't present to match.

export type ReconSplit = { intlAed: number; localAed: number; totalAed: number; count: number };
export type ReconMonthContribution = ReconSplit & { monthKey: string; label: string };

export type MonthReconciliation = {
  monthKey: string;
  label: string;
  /** Every order placed this month — Σ amountAed. */
  dispatched: ReconSplit;
  /** Of the dispatched: payout landed the same month. */
  settledWithin: ReconSplit;
  /** Of the dispatched: payout landed in a later month. `byMonth` = which. */
  settledLater: ReconSplit & { byMonth: ReconMonthContribution[] };
  /** Of the dispatched: no confirmed payout yet. */
  awaiting: ReconSplit;
  /** Of the dispatched: received, but the settlement date can't be read — so
   *  it can't be placed within/later. Fix the sheet note to clear these. */
  unreadableSettlement: ReconSplit;
  /** Earlier-month orders whose payout landed in this month. `byMonth` = the
   *  origin months. */
  carriedIn: ReconSplit & { byMonth: ReconMonthContribution[] };
  /** All cash that settled this month = settledWithin + carriedIn. */
  cashReceived: ReconSplit;
  /** cashReceived after gateway fees, and the fees. */
  cashReceivedNetAed: number;
  cashReceivedFeesAed: number;
  /** Memo: cancelled / refunded recorded against this month's orders. */
  cancelledAed: number;
};

function emptyReconSplit(): ReconSplit {
  return { intlAed: 0, localAed: 0, totalAed: 0, count: 0 };
}
function addToSplit(s: ReconSplit, tab: SheetTabKey, amt: number): void {
  if (tab === "smsa") s.intlAed += amt;
  else s.localAed += amt;
  s.totalAed += amt;
  s.count++;
}
function roundSplit(s: ReconSplit): void {
  s.intlAed = +s.intlAed.toFixed(2);
  s.localAed = +s.localAed.toFixed(2);
  s.totalAed = +s.totalAed.toFixed(2);
}

type ReconAccum = MonthReconciliation & {
  _later: Map<string, ReconMonthContribution>;
  _carry: Map<string, ReconMonthContribution>;
};

export function computeMonthlyReconciliation(
  rows: PaymentSheetRow[],
  opts: { from?: string | null; to?: string | null } = {},
): MonthReconciliation[] {
  const { from = null, to = null } = opts;
  const byMonth = new Map<string, ReconAccum>();
  const get = (mk: string): ReconAccum => {
    let m = byMonth.get(mk);
    if (!m) {
      m = {
        monthKey: mk, label: monthLabel(mk),
        dispatched: emptyReconSplit(),
        settledWithin: emptyReconSplit(),
        settledLater: { ...emptyReconSplit(), byMonth: [] },
        awaiting: emptyReconSplit(),
        unreadableSettlement: emptyReconSplit(),
        carriedIn: { ...emptyReconSplit(), byMonth: [] },
        cashReceived: emptyReconSplit(),
        cashReceivedNetAed: 0,
        cashReceivedFeesAed: 0,
        cancelledAed: 0,
        _later: new Map(),
        _carry: new Map(),
      };
      byMonth.set(mk, m);
    }
    return m;
  };
  const contribution = (map: Map<string, ReconMonthContribution>, mk: string, tab: SheetTabKey, amt: number) => {
    let c = map.get(mk);
    if (!c) { c = { monthKey: mk, label: monthLabel(mk), ...emptyReconSplit() }; map.set(mk, c); }
    addToSplit(c, tab, amt);
  };

  for (const row of rows) {
    if (!row.date) continue;
    const om = row.date.slice(0, 7);
    const tab = row.tab;
    const amt = row.amountAed;
    const isReceived = row.actualPaymentStatus.toLowerCase() === "payment received";
    const pm = isReceived && row.paymentReceivedDate ? row.paymentReceivedDate.slice(0, 7) : null;
    const isCancelled = row.cancelledAmount > 0;
    const { fees, net } = grossFeeNetForRow(row);

    const M = get(om);
    addToSplit(M.dispatched, tab, amt);
    if (isCancelled) M.cancelledAed += row.cancelledAmount;

    if (isReceived && !row.paymentReceivedDate) {
      addToSplit(M.unreadableSettlement, tab, amt);
    } else if (pm) {
      if (pm <= om) {
        addToSplit(M.settledWithin, tab, amt);
      } else {
        addToSplit(M.settledLater, tab, amt);
        contribution(M._later, pm, tab, amt);
      }
    } else if (!isCancelled) {
      addToSplit(M.awaiting, tab, amt);
    }

    if (pm) {
      const S = get(pm);
      addToSplit(S.cashReceived, tab, amt);
      S.cashReceivedNetAed += net;
      S.cashReceivedFeesAed += fees;
      if (om < pm) {
        addToSplit(S.carriedIn, tab, amt);
        contribution(S._carry, om, tab, amt);
      }
    }
  }

  let out: MonthReconciliation[] = [...byMonth.values()]
    .map((m) => {
      const { _later, _carry, ...rest } = m;
      rest.settledLater.byMonth = [..._later.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
      rest.carriedIn.byMonth = [..._carry.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
      for (const s of [rest.dispatched, rest.settledWithin, rest.settledLater, rest.awaiting, rest.unreadableSettlement, rest.carriedIn]) roundSplit(s);
      for (const c of [...rest.settledLater.byMonth, ...rest.carriedIn.byMonth]) roundSplit(c);
      roundSplit(rest.cashReceived);
      rest.cashReceivedNetAed = +rest.cashReceivedNetAed.toFixed(2);
      rest.cashReceivedFeesAed = +rest.cashReceivedFeesAed.toFixed(2);
      rest.cancelledAed = +rest.cancelledAed.toFixed(2);
      return rest;
    })
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  if (from || to) {
    const lo = from ? from.slice(0, 7) : null;
    const hi = to ? to.slice(0, 7) : null;
    out = out.filter((m) => (!lo || m.monthKey >= lo) && (!hi || m.monthKey <= hi));
  }
  return out;
}
