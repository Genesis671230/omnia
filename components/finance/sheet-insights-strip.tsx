"use client";

/* Payments-sheet insights — trend chart + standalone stats + gateway
   breakdown + exchange/SKU drill-down, deliberately Zoho-free (see
   lib/finance/payments-sheet.ts) so this renders even when Zoho is rate
   limited. Also the "paste a sheet URL" surface: leave the input blank to
   read the default configured payments sheet, or paste a different sheet
   of the same SMSA Orders / Local orders layout to see its numbers instead.

   The API returns the full row set once; the date-range and gateway
   filters below re-run the identical pure aggregation
   (lib/finance/payments-sheet-insights.ts) locally, so filtering is
   instant and never re-hits the Sheets API. */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SheetGatewayTable } from "./sheet-gateway-table";
import { SheetExchangeTable } from "./sheet-exchange-table";
import { SheetTrendChart } from "./sheet-trend-chart";
import { SheetMonthlyTable } from "./sheet-monthly-table";
import { SheetMonthReconciliation } from "./sheet-month-reconciliation";
import { SheetPayoutBreakdown } from "./sheet-payout-breakdown";
import { computeGatewayBreakdown, type SheetInsightsResponse, type PeriodStats } from "@/lib/finance/payments-sheet-insights";

/* Ops keeps one spreadsheet per month, registered in payment_sheet_months.
   The API returns every registered month at once (see readPaymentRowsScoped)
   along with the list of months it read, so the month chips below are driven
   by what actually loaded rather than by a hardcoded range. */
type SheetMonth = { monthKey: string; spreadsheetId: string; label: string };
type InsightsResponse = SheetInsightsResponse & {
  months?: SheetMonth[];
  source?: "explicit" | "registry" | "env-default";
};

async function fetchInsights(spreadsheetId: string): Promise<InsightsResponse> {
  const params = new URLSearchParams();
  if (spreadsheetId) params.set("spreadsheetId", spreadsheetId);
  const res = await fetch(`/api/invoices/sheet-insights?${params}`, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

/** Last calendar day of a "YYYY-MM" key, as YYYY-MM-DD. */
function monthEndIso(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const PERIOD_LABELS: [keyof SheetInsightsResponse["periods"], string][] = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["thisWeek", "This week"],
  ["thisMonth", "This month"],
  ["allTime", "All time"],
];

function PeriodCard({ label, active, onClick, stats, index }: { label: string; active: boolean; onClick: () => void; stats: PeriodStats; index: number }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.25 }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className={`flex flex-1 flex-col gap-2 rounded-2xl border p-4 text-left transition-colors ${
        active
          ? "border-[#2563EB] bg-gradient-to-br from-[#1E3A8A] to-[#1D4ED8] shadow-lg shadow-blue-900/20"
          : "border-[#DBEAFE] bg-white hover:border-[#93C5FD]"
      }`}
    >
      <span className={`text-[11px] font-semibold uppercase tracking-wider ${active ? "text-[#BFDBFE]" : "text-[#64748B]"}`}>{label}</span>
      <span className={`text-[24px] font-semibold tabular-nums ${active ? "text-white" : "text-[#0F172A]"}`}>
        {stats.totalOrders}
      </span>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px]">
        <span className={active ? "text-[#93C5FD]" : "text-[#15803D]"}>{stats.received.count} received</span>
        <span className={active ? "text-[#FCD34D]" : "text-[#B45309]"}>{stats.pending.count} pending</span>
        {stats.exchange.count > 0 && <span className={active ? "text-white/70" : "text-[#64748B]"}>{stats.exchange.count} exchange</span>}
        {stats.cancelled.count > 0 && <span className={active ? "text-[#FCA5A5]" : "text-[#B91C1C]"}>{stats.cancelled.count} cancelled</span>}
      </div>
    </motion.button>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function SheetInsightsStrip() {
  const [urlInput, setUrlInput] = useState("");
  const [activeId, setActiveId] = useState("");
  const [activePeriod, setActivePeriod] = useState<keyof SheetInsightsResponse["periods"] | "custom" | "month">("allTime");
  const [activeMonth, setActiveMonth] = useState<string | null>(null);
  const [customFrom, setCustomFrom] = useState(daysAgoIso(30));
  const [customTo, setCustomTo] = useState(todayIso());
  const [gatewayFilter, setGatewayFilter] = useState("all");

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["sheet-insights", activeId],
    queryFn: () => fetchInsights(activeId),
    // One read now covers every registered month, so it costs six Sheets API
    // calls (two tabs x three months) rather than two. Hold it briefly instead
    // of re-reading all of them on every remount; the refresh button and the
    // month chips both still work without waiting this out.
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });

  const usingCustomSheet = activeId.trim().length > 0;

  // Resolve the active period into a concrete [from, to] window over which
  // the gateway table + exchange table both filter — every fixed period
  // maps to Dubai-local day boundaries, matching computeSheetInsights.
  const [from, to] = useMemo((): [string | null, string | null] => {
    if (activePeriod === "month" && activeMonth) return [`${activeMonth}-01`, monthEndIso(activeMonth)];
    if (activePeriod === "custom") return [customFrom || null, customTo || null];
    if (activePeriod === "allTime") return [null, null];
    const t = todayIso();
    if (activePeriod === "today") return [t, t];
    if (activePeriod === "yesterday") { const y = daysAgoIso(1); return [y, y]; }
    if (activePeriod === "thisWeek") return [daysAgoIso(7), t];
    if (activePeriod === "thisMonth") return [t.slice(0, 7) + "-01", t];
    return [null, null];
  }, [activePeriod, activeMonth, customFrom, customTo]);

  const rows = data?.rows ?? [];
  // Newest month first — the one ops is actually working in.
  const months = useMemo(
    () => [...(data?.months ?? [])].sort((a, b) => b.monthKey.localeCompare(a.monthKey)),
    [data?.months],
  );
  const gatewayBreakdownAll = useMemo(() => computeGatewayBreakdown(rows, from, to), [rows, from, to]);
  const gatewayOptions = useMemo(() => [...new Set(gatewayBreakdownAll.map((g) => g.gatewayLabel))].sort(), [gatewayBreakdownAll]);
  const gatewayBreakdown = gatewayFilter === "all" ? gatewayBreakdownAll : gatewayBreakdownAll.filter((g) => g.gatewayLabel === gatewayFilter);

  return (
    <div className="space-y-4">
      {/* ── URL input ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#DBEAFE] bg-gradient-to-r from-[#EFF6FF] to-white p-3 shadow-sm">
        <Input
          placeholder="Paste a payments-sheet Google Sheets URL to view its stats (leave blank for the default sheet)…"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setActiveId(urlInput.trim())}
          className="h-9 min-w-70 flex-1 border-[#BFDBFE] bg-white text-[12.5px]"
        />
        <Button size="sm" variant="outline" onClick={() => setActiveId(urlInput.trim())} className="h-9 border-[#BFDBFE] text-[#1D4ED8] hover:bg-[#DBEAFE]">
          View
        </Button>
        {usingCustomSheet && (
          <Button size="sm" variant="ghost" onClick={() => { setUrlInput(""); setActiveId(""); }} className="h-9 text-[#64748B]">
            Reset to default sheet
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="ml-auto h-9 border-[#BFDBFE] text-[#1D4ED8] hover:bg-[#DBEAFE]">
          {isFetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </Button>
      </div>

      {error && <div className="rounded-lg bg-[#FEF2F2] px-4 py-3 text-[12.5px] text-[#991B1B]">{(error as Error).message}</div>}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-[#DBEAFE] bg-white p-10 text-[13px] text-[#64748B]">
          <Loader2 size={16} className="animate-spin" /> Reading sheet…
        </div>
      ) : data ? (
        <>
          {/* ── Month picker ─────────────────────────────────────────
              Ops keeps one spreadsheet per month. Every registered month is
              already loaded, so switching between them is instant and never
              re-hits the Sheets API. */}
          {months.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-[#DBEAFE] bg-white p-2.5 shadow-sm">
              <span className="px-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">Month</span>
              <button
                onClick={() => { setActivePeriod("allTime"); setActiveMonth(null); }}
                className={`rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  activePeriod === "allTime"
                    ? "border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]"
                    : "border-[#BFDBFE] text-[#64748B] hover:text-[#0F172A]"
                }`}
              >
                All months
              </button>
              {months.map((m) => (
                <button
                  key={m.monthKey}
                  onClick={() => { setActivePeriod("month"); setActiveMonth(m.monthKey); }}
                  className={`rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    activePeriod === "month" && activeMonth === m.monthKey
                      ? "border-[#2563EB] bg-gradient-to-r from-[#1E3A8A] to-[#1D4ED8] text-white"
                      : "border-[#BFDBFE] text-[#64748B] hover:text-[#0F172A]"
                  }`}
                >
                  {m.label}
                </button>
              ))}
              {usingCustomSheet && (
                <span className="ml-auto px-1.5 text-[11px] text-[#94A3B8]">
                  Viewing one pasted sheet — months are hidden
                </span>
              )}
            </div>
          )}

          {/* ── Trend chart ──────────────────────────────────────────── */}
          <SheetTrendChart rows={rows} from={from} to={to} />

          {/* ── Monthly rollup ─────────────────────────────────────── */}
          <SheetMonthlyTable rows={rows} from={from} to={to} />

          {/* ── Month-close reconciliation statement ────────────────── */}
          <SheetMonthReconciliation rows={rows} from={from} to={to} />

          {/* ── Period cards ────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            {PERIOD_LABELS.map(([key, label], i) => (
              <PeriodCard key={key} index={i} label={label} active={activePeriod === key} onClick={() => setActivePeriod(key)} stats={data.periods[key]} />
            ))}
          </div>

          {/* ── Filter bar: custom range + gateway ─────────────────── */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#DBEAFE] bg-white p-3 shadow-sm">
            <button
              onClick={() => setActivePeriod("custom")}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                activePeriod === "custom" ? "border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]" : "border-[#BFDBFE] text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              <CalendarRange size={13} />
              Custom range
            </button>
            <Input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); setActivePeriod("custom"); }} className="h-8 w-36 border-[#BFDBFE] text-[12px]" />
            <span className="text-[#93C5FD]">→</span>
            <Input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); setActivePeriod("custom"); }} className="h-8 w-36 border-[#BFDBFE] text-[12px]" />

            <Select value={gatewayFilter} onValueChange={setGatewayFilter}>
              <SelectTrigger className="ml-auto h-8 w-52 border-[#BFDBFE] text-[12px]"><SelectValue placeholder="Gateway" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All gateways</SelectItem>
                {gatewayOptions.map((g) => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ── Gateway breakdown table ─────────────────────────────── */}
          <SheetGatewayTable rows={gatewayBreakdown} />

          {/* ── Payouts, split by order month ───────────────────────── */}
          <SheetPayoutBreakdown rows={rows} from={from} to={to} />

          {/* ── Exchanges + SKUs ────────────────────────────────────── */}
          <SheetExchangeTable spreadsheetId={activeId} from={from ?? ""} to={to ?? ""} />

          <div className="px-1 text-[10.5px] text-[#94A3B8]">
            {data.rowCount} rows read
            {months.length > 0 && ` across ${months.length} ${months.length === 1 ? "month" : "months"} (${months.map((m) => m.label).join(", ")})`}
            {data.source === "env-default" && " · no months registered, reading the default sheet only"}
            {" · updated "}
            {new Date(data.fetchedAt).toLocaleTimeString()}
          </div>
        </>
      ) : null}
    </div>
  );
}
