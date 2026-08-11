// CFO financial report: revenue, COGS, and profit for any Dubai-calendar
// date range (a single day for the daily digest, or any wider range for
// "last week" / "last month" style questions from the AI chat layer).
//
// Revenue/COGS/profit are computed from PAID orders only (financial_status
// === "paid") — pending, cancelled, failed, refunded, voided, and expired
// orders are real order attempts but not real money, and mixing them into
// "revenue" is exactly the discrepancy that showed up against the manual
// dispatch sheet's "32 paid / 37 total" count. totalOrders below is
// deliberately unfiltered so that comparison stays possible.
//
// COGS uses zoho_items.purchase_rate (Zoho's real cost basis for the item),
// NOT zoho_items.rate (list/sale price) — using sale price as "cost" would
// make margin meaningless. See db/schema.sql for the column.

import { supabase } from "@/lib/supabase";
import { OrdersRepository, type OrderRowRaw } from "@/lib/repositories/orders.repository";

const DUBAI_OFFSET_MINUTES = 4 * 60;
const PAID_STATUS = "paid";

// Midnight-to-midnight Dubai day, expressed as the UTC bounds order_date is
// stored/queried in.
function dubaiDayStartUtcMs(dateIsoDay: string): number {
  return new Date(`${dateIsoDay}T00:00:00Z`).getTime() - DUBAI_OFFSET_MINUTES * 60_000;
}

export function dubaiDayBoundsUtc(dateIsoDay: string): { fromUtc: string; toUtc: string } {
  const startMs = dubaiDayStartUtcMs(dateIsoDay);
  return { fromUtc: new Date(startMs).toISOString(), toUtc: new Date(startMs + 24 * 60 * 60_000).toISOString() };
}

// Inclusive of both the fromDay and toDay Dubai calendar days.
export function dubaiRangeBoundsUtc(fromDay: string, toDay: string): { fromUtc: string; toUtc: string } {
  const fromMs = dubaiDayStartUtcMs(fromDay);
  const toMs = dubaiDayStartUtcMs(toDay) + 24 * 60 * 60_000;
  return { fromUtc: new Date(fromMs).toISOString(), toUtc: new Date(toMs).toISOString() };
}

export type StoreBreakdown = { store: string; paidOrders: number; revenueAed: number };
export type StatusBreakdown = { status: string; orders: number };

export type FinancialReport = {
  fromDay: string;
  toDay: string;
  totalOrders: number; // every order in range, no status filter
  paidOrders: number; // financial_status === "paid"
  revenueAed: number; // paid orders only
  cogsAed: number; // paid orders only
  profitAed: number;
  marginPct: number | null; // null when revenue is 0 — undefined, not 0%
  unmatchedLineItems: number; // paid-order line items whose sku has no zoho_items match — cost unknown, excluded from cogsAed
  byStatus: StatusBreakdown[];
  byStore: StoreBreakdown[]; // paid orders only
};

async function purchaseRateBySku(skus: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const clean = [...new Set(skus.filter(Boolean))];
  if (clean.length === 0) return map;
  const { data, error } = await supabase.from("zoho_items").select("sku, purchase_rate").in("sku", clean);
  if (error) return map;
  for (const row of data ?? []) map.set(row.sku as string, Number(row.purchase_rate));
  return map;
}

export function computeFinancialReport(
  fromDay: string,
  toDay: string,
  rows: OrderRowRaw[],
  purchaseRate: Map<string, number>,
): FinancialReport {
  const statusCounts = new Map<string, number>();
  for (const row of rows) {
    const status = (row.financial_status || "unknown").toLowerCase();
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }

  const paid = rows.filter((r) => (r.financial_status || "").toLowerCase() === PAID_STATUS);

  let revenueAed = 0;
  let cogsAed = 0;
  let unmatchedLineItems = 0;
  const byStoreMap = new Map<string, StoreBreakdown>();

  for (const row of paid) {
    revenueAed += Number(row.gross_aed) || 0;

    const entry = byStoreMap.get(row.store_id) ?? { store: row.store_id, paidOrders: 0, revenueAed: 0 };
    entry.paidOrders += 1;
    entry.revenueAed += Number(row.gross_aed) || 0;
    byStoreMap.set(row.store_id, entry);

    for (const li of row.line_items ?? []) {
      const rate = li.sku ? purchaseRate.get(li.sku) : undefined;
      if (rate == null) {
        unmatchedLineItems += 1;
        continue;
      }
      cogsAed += rate * (li.qty ?? 0);
    }
  }

  const profitAed = revenueAed - cogsAed;
  return {
    fromDay,
    toDay,
    totalOrders: rows.length,
    paidOrders: paid.length,
    revenueAed: +revenueAed.toFixed(2),
    cogsAed: +cogsAed.toFixed(2),
    profitAed: +profitAed.toFixed(2),
    marginPct: revenueAed > 0 ? +((profitAed / revenueAed) * 100).toFixed(1) : null,
    unmatchedLineItems,
    byStatus: [...statusCounts.entries()].map(([status, orders]) => ({ status, orders })).sort((a, b) => b.orders - a.orders),
    byStore: [...byStoreMap.values()].sort((a, b) => b.revenueAed - a.revenueAed),
  };
}

export async function buildFinancialReport(fromDay: string, toDay: string): Promise<FinancialReport> {
  const { fromUtc, toUtc } = dubaiRangeBoundsUtc(fromDay, toDay);
  const windowRows = await OrdersRepository.listInWindow({ from: fromUtc });
  const rows = windowRows.filter((r) => r.order_date != null && r.order_date < toUtc);

  const skus = rows.flatMap((r) => (r.line_items ?? []).map((li) => li.sku).filter(Boolean));
  const purchaseRate = await purchaseRateBySku(skus);

  return computeFinancialReport(fromDay, toDay, rows, purchaseRate);
}

export async function buildCfoDigest(dateIsoDay: string): Promise<FinancialReport> {
  return buildFinancialReport(dateIsoDay, dateIsoDay);
}

// Simple day-of-month pace projection ("if the rest of the month keeps this
// pace") — deliberately NOT a fitted/seasonal model, just honest
// extrapolation from month-to-date revenue. Labeled clearly as a pace-based
// estimate everywhere it's shown, never presented as a promise.
export function computeMonthEndForecast(mtdRevenueAed: number, dayOfMonth: number, daysInMonth: number): number {
  if (dayOfMonth <= 0) return 0;
  return +((mtdRevenueAed / dayOfMonth) * daysInMonth).toFixed(2);
}

export type CfoDigestExtras = {
  monthToDateRevenueAed: number;
  monthEndForecastAed: number;
  dayOfMonth: number;
  daysInMonth: number;
  yesterdayRevenueAed: number | null; // null when there's no prior-day data to compare against
};

// Extra context for the daily digest beyond the single day's own numbers —
// kept separate from FinancialReport (used for arbitrary "last week" style
// ranges via the AI chat tool, where a month-end forecast wouldn't make
// sense) rather than bolted onto that type.
export async function buildCfoDigestExtras(dateIsoDay: string): Promise<CfoDigestExtras> {
  const [year, month, day] = dateIsoDay.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstOfMonth = `${dateIsoDay.slice(0, 7)}-01`;

  const yesterday = new Date(`${dateIsoDay}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayIso = yesterday.toISOString().slice(0, 10);

  const [mtdReport, yesterdayReport] = await Promise.all([
    buildFinancialReport(firstOfMonth, dateIsoDay),
    yesterdayIso >= firstOfMonth || yesterdayIso.slice(0, 7) !== dateIsoDay.slice(0, 7)
      ? buildFinancialReport(yesterdayIso, yesterdayIso)
      : Promise.resolve(null),
  ]);

  return {
    monthToDateRevenueAed: mtdReport.revenueAed,
    monthEndForecastAed: computeMonthEndForecast(mtdReport.revenueAed, day, daysInMonth),
    dayOfMonth: day,
    daysInMonth,
    yesterdayRevenueAed: yesterdayReport?.revenueAed ?? null,
  };
}

const STORE_LABELS: Record<string, string> = {
  WA: "Shopify WhatsApp",
  UAE: "Shopify UAE",
  KSA: "Shopify KSA",
  WOO: "WooCommerce",
};

// Pure: the day-over-day trend line, split out so it's independently
// testable without needing two full report fetches.
export function formatTrendLine(todayRevenueAed: number, yesterdayRevenueAed: number | null): string | null {
  if (yesterdayRevenueAed == null) return null;
  if (yesterdayRevenueAed === 0) return todayRevenueAed > 0 ? "📈 vs yesterday: yesterday had zero paid revenue to compare against" : null;
  const pct = ((todayRevenueAed - yesterdayRevenueAed) / yesterdayRevenueAed) * 100;
  const arrow = pct > 1 ? "📈" : pct < -1 ? "📉" : "➡️";
  const sign = pct > 0 ? "+" : "";
  return `${arrow} vs yesterday: ${sign}${pct.toFixed(0)}% (${yesterdayRevenueAed.toFixed(2)} AED)`;
}

export function formatCfoDigest(report: FinancialReport, extras?: CfoDigestExtras): string {
  const storeLines = report.byStore
    .map((s) => `  • ${STORE_LABELS[s.store] ?? s.store}: ${s.paidOrders} paid, ${s.revenueAed.toFixed(2)} AED`)
    .join("\n");
  const statusLine = report.byStatus.map((s) => `${s.status} ${s.orders}`).join(" · ");

  const margin = report.marginPct == null ? "—" : `${report.marginPct}%`;
  const caveat =
    report.unmatchedLineItems > 0
      ? `\n⚠️ ${report.unmatchedLineItems} paid line item(s) had no Zoho SKU match — COGS/profit understated for those.`
      : "";

  const dayLabel = report.fromDay === report.toDay ? report.fromDay : `${report.fromDay} → ${report.toDay}`;
  const isSingleDay = report.fromDay === report.toDay;

  const trendLine = isSingleDay && extras ? formatTrendLine(report.revenueAed, extras.yesterdayRevenueAed) : null;
  const forecastLine =
    isSingleDay && extras
      ? `🎯 Month-end pace: ${extras.monthEndForecastAed.toFixed(2)} AED (${extras.monthToDateRevenueAed.toFixed(2)} AED MTD through day ${extras.dayOfMonth}/${extras.daysInMonth}, extrapolated — not a promise)`
      : null;
  // A strong-day flag only earns the 🔥, not every digest by default — an
  // emoji that shows up regardless of the numbers stops meaning anything.
  const titleFlourish = trendLine?.startsWith("📈") ? " 🔥" : "";

  return [
    `📊 <b>CFO Daily Digest — ${dayLabel}</b>${titleFlourish}`,
    `Orders: ${report.totalOrders} total, ${report.paidOrders} paid (${statusLine})`,
    `💰 Revenue (paid): ${report.revenueAed.toFixed(2)} AED`,
    trendLine,
    `📦 COGS: ${report.cogsAed.toFixed(2)} AED`,
    `💵 Profit: ${report.profitAed.toFixed(2)} AED (${margin} margin)`,
    forecastLine,
    storeLines ? `\nBy store (paid):\n${storeLines}` : null,
    caveat || null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
