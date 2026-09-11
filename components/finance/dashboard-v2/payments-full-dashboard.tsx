"use client";

/* The founder's "full charts and dashboards" ask: the same blue PowerBI-style
   trend chart + period cards + custom range + gateway table already proven
   in components/finance/sheet-insights-strip.tsx (the Invoices Workbench's
   manual tab) — reused here verbatim (SheetTrendChart, SheetGatewayTable,
   computeGatewayBreakdown), but sourced from EVERY month registered in
   Settings (payment_sheet_months) instead of one hardcoded sheet, and
   auto-refreshing every 60s instead of requiring a manual "View" click —
   real-time, no manual paste-a-URL step. */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SheetGatewayTable } from "../sheet-gateway-table";
import { SheetTrendChart } from "../sheet-trend-chart";
import { SheetMonthlyTable } from "../sheet-monthly-table";
import { SheetMonthReconciliation } from "../sheet-month-reconciliation";
import { SheetPayoutBreakdown } from "../sheet-payout-breakdown";
import { computeGatewayBreakdown, type SheetInsightsResponse, type PeriodStats } from "@/lib/finance/payments-sheet-insights";

type FullDashboardResponse = SheetInsightsResponse & {
  months: { monthKey: string; label: string; spreadsheetId: string }[];
};

async function fetchFull(): Promise<FullDashboardResponse> {
  const res = await fetch("/api/dashboard/payments-sheet-full");
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

const PERIOD_LABELS: [keyof SheetInsightsResponse["periods"], string][] = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["thisWeek", "This week"],
  ["thisMonth", "This month"],
  ["allTime", "All time"],
];

function PeriodCard({ label, active, onClick, stats }: { label: string; active: boolean; onClick: () => void; stats: PeriodStats }) {
  return (
    <button
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
    </button>
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

export function PaymentsFullDashboard() {
  const [activePeriod, setActivePeriod] = useState<keyof SheetInsightsResponse["periods"] | "custom">("allTime");
  const [customFrom, setCustomFrom] = useState(daysAgoIso(30));
  const [customTo, setCustomTo] = useState(todayIso());
  const [gatewayFilter, setGatewayFilter] = useState("all");

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["payments-sheet-full"],
    queryFn: fetchFull,
    refetchInterval: 60_000,
    retry: false,
  });

  const [from, to] = useMemo((): [string | null, string | null] => {
    if (activePeriod === "custom") return [customFrom || null, customTo || null];
    if (activePeriod === "allTime") return [null, null];
    const t = todayIso();
    if (activePeriod === "today") return [t, t];
    if (activePeriod === "yesterday") { const y = daysAgoIso(1); return [y, y]; }
    if (activePeriod === "thisWeek") return [daysAgoIso(7), t];
    if (activePeriod === "thisMonth") return [t.slice(0, 7) + "-01", t];
    return [null, null];
  }, [activePeriod, customFrom, customTo]);

  const rows = data?.rows ?? [];
  const gatewayBreakdownAll = useMemo(() => computeGatewayBreakdown(rows, from, to), [rows, from, to]);
  const gatewayOptions = useMemo(() => [...new Set(gatewayBreakdownAll.map((g) => g.gatewayLabel))].sort(), [gatewayBreakdownAll]);
  const gatewayBreakdown = gatewayFilter === "all" ? gatewayBreakdownAll : gatewayBreakdownAll.filter((g) => g.gatewayLabel === gatewayFilter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-[#0F172A]">Payments sheet — full dashboard</h3>
        <div className="flex flex-wrap items-center gap-3">
          {(data?.months ?? []).map((m) => (
            <a
              key={m.monthKey}
              href={`https://docs.google.com/spreadsheets/d/${m.spreadsheetId}/edit`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-[#64748B] hover:text-[#1D4ED8]"
              title={`Open ${m.label} in Google Sheets`}
            >
              {m.label} <ExternalLink size={11} />
            </a>
          ))}
          <button onClick={() => refetch()} disabled={isFetching} className="flex items-center gap-1 text-[11px] text-[#1D4ED8] hover:text-[#1E3A8A]">
            {isFetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} refresh
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg bg-[#FEF2F2] px-4 py-3 text-[12.5px] text-[#991B1B]">{(error as Error).message}</div>}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-[#DBEAFE] bg-white p-10 text-[13px] text-[#64748B]">
          <Loader2 size={16} className="animate-spin" /> Reading payments sheets…
        </div>
      ) : data ? (
        <>
          <SheetTrendChart rows={rows} from={from} to={to} />

          <SheetMonthlyTable rows={rows} from={from} to={to} />

          <SheetMonthReconciliation rows={rows} from={from} to={to} />

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            {PERIOD_LABELS.map(([key, label]) => (
              <PeriodCard key={key} label={label} active={activePeriod === key} onClick={() => setActivePeriod(key)} stats={data.periods[key]} />
            ))}
          </div>

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

          <SheetGatewayTable rows={gatewayBreakdown} />

          <SheetPayoutBreakdown rows={rows} from={from} to={to} />

          <div className="px-1 text-[10.5px] text-[#94A3B8]">
            {data.rowCount} rows across {data.months.length} month{data.months.length === 1 ? "" : "s"} · updated {new Date(data.fetchedAt).toLocaleTimeString()}
          </div>
        </>
      ) : null}
    </div>
  );
}
