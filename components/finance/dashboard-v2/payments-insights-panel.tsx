"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeftRight, Banknote, Clock, ExternalLink, Loader2, Percent, RotateCcw, TrendingUp,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { computePayoutSummary, type PayoutSummaryLineInput } from "@/lib/reconciliation/payout-summary";
import { aed2, compact } from "./types";

type PeriodStats = {
  totalOrders: number;
  received: { count: number; amountAed: number };
  cancelled: { count: number; amountAed: number };
  exchange: { count: number };
  grossAed: number; feesAed: number; netAed: number;
};
type GatewayRow = {
  gatewayLabel: string; totalOrders: number;
  cancelled: { count: number; amountAed: number };
  grossAed: number; feesAed: number; netAed: number;
};
type PaymentsInsightsResponse = {
  periods: { today: PeriodStats; thisWeek: PeriodStats; thisMonth: PeriodStats; allTime: PeriodStats };
  gatewayBreakdown: GatewayRow[];
  feeRanking: { best: { gatewayLabel: string; feePercent: number } | null; worst: { gatewayLabel: string; feePercent: number } | null };
  monthsIncluded: string[];
  months: { monthKey: string; label: string; spreadsheetId: string }[];
};

function sheetEditUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

async function fetchPaymentsInsights(): Promise<PaymentsInsightsResponse> {
  const res = await fetch("/api/dashboard/payments-insights");
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// Extension C: "awaiting payout" is a RECONCILIATION concept (bank credits
// with no payout file yet, ReconLine.state === AWAITING_PAYOUT) — a
// completely different data source (/api/reconcile) than the payments-sheet
// rows the rest of this panel draws from. Fetched independently, same
// "fetch on its own, fail without blocking the rest" convention as
// useExchangeCount() in
// components/finance/reconciliation/payout-summary-bar.tsx — a slow or
// broken /api/reconcile call must never take the other five tiles down
// with it. computePayoutSummary is the existing, already-tested function
// (lib/reconciliation/payout-summary.ts) — not reimplemented here.
function useAwaitingAed(): { value: number | null; loading: boolean } {
  const [value, setValue] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch("/api/reconcile")
      .then((r) => r.json())
      .then((d: { lines?: PayoutSummaryLineInput[] }) => {
        if (!alive) return;
        setValue(computePayoutSummary(d.lines ?? []).awaitingAed);
      })
      .catch(() => { if (alive) setValue(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  return { value, loading };
}

function Tile({ label, value, icon: Icon, tone, note }: {
  label: string; value: string; icon: React.ElementType; tone: string; note?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#EAE3D6] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11.5px] text-[#8A8175]">
        <Icon size={13} style={{ color: tone }} /> {label}
      </div>
      <div className="mt-1.5 font-serif text-[22px] tabular-nums" style={{ color: tone }}>{value}</div>
      {note && <div className="mt-0.5 text-[11px] text-[#8A8175]">{note}</div>}
    </div>
  );
}

// Row of clickable gateway pills, matching the exact style already used in
// recon-view.tsx's gateway filter (border-[#1F1B16]/bg-[#1F1B16] when
// active, muted outline otherwise) — computed entirely client-side from
// the already-fetched gatewayBreakdown, no new fetch per click.
function pillClass(active: boolean): string {
  return `rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
    active
      ? "border-[#1F1B16] bg-[#1F1B16] text-[#FBF8F1]"
      : "border-[#EAE3D6] bg-white text-[#8A8175] hover:border-[#D6CCBA] hover:text-[#1F1B16]"
  }`;
}

function BarTip({ active, payload, label }: {
  active?: boolean; label?: string;
  payload?: { name: string; value: number; color?: string }[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="dv2-tip">
      <div className="dv2-tip-label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="dv2-tip-row">
          <span style={{ background: p.color }} />{p.name}: <b>{aed2(Number(p.value))}</b>
        </div>
      ))}
    </div>
  );
}

// Extension A: the primary visual — gross/net/fees per gateway, grouped
// (not stacked, since net + fees only approximates gross rather than
// exactly summing it row-by-row). Same recharts building blocks and
// tooltip styling (dv2-tip, from charts.tsx's CHARTS_CSS, already injected
// by founder-dashboard.tsx) as the rest of this dashboard's charts.
function GatewayBarChart({ rows }: { rows: GatewayRow[] }) {
  if (rows.length === 0) {
    return <p className="dv2-quiet">No gateway data for this selection.</p>;
  }
  const data = rows.map((g) => ({ gatewayLabel: g.gatewayLabel, Gross: g.grossAed, Net: g.netAed, Fees: g.feesAed }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 46)}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke="rgba(0,0,0,.05)" />
        <XAxis type="number" tickFormatter={(v) => compact(v)} tick={{ fontSize: 10, fill: "#9a8b73" }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="gatewayLabel" width={110} tick={{ fontSize: 11, fill: "#1F1B16" }} axisLine={false} tickLine={false} />
        <Tooltip content={<BarTip />} cursor={{ fill: "rgba(124,58,237,.06)" }} />
        <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 6 }} />
        <Bar dataKey="Gross" name="Gross" fill="#2E6B7A" radius={[0, 3, 3, 0]} />
        <Bar dataKey="Net" name="Net" fill="#4B7A54" radius={[0, 3, 3, 0]} />
        <Bar dataKey="Fees" name="Fees" fill="#8A8175" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Real-time per the founder's ask: any edit ops makes in the sheet this
// month shows up here within a minute, same 60s cadence the reconciliation
// dashboard already polls at (lib/hooks/use-reconciliation-query.ts).
export function PaymentsInsightsPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["payments-insights"],
    queryFn: fetchPaymentsInsights,
    refetchInterval: 60_000,
    retry: false,
  });
  const { value: awaitingAed, loading: awaitingLoading } = useAwaitingAed();

  // Extension B: gateway filter, computed client-side from the one
  // already-fetched gatewayBreakdown — no refetch on click.
  const [gatewayFilter, setGatewayFilter] = useState<string | null>(null);
  const filteredBreakdown = useMemo(() => {
    if (!data) return [];
    if (!gatewayFilter) return data.gatewayBreakdown;
    return data.gatewayBreakdown.filter((g) => g.gatewayLabel === gatewayFilter);
  }, [data, gatewayFilter]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-dashed border-[#D6CCBA] bg-white p-6 text-[13px] text-[#8A8175]">
        <Loader2 size={16} className="animate-spin" /> Loading payments-sheet analytics…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-dashed border-[#D6CCBA] bg-white p-6 text-[13px] text-[#8A8175]">
        <AlertTriangle size={16} className="text-[#B0742E]" />
        {(error as Error)?.message || "Couldn't load payments-sheet analytics."}
      </div>
    );
  }

  const m = data.periods.thisMonth;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-[#1F1B16]">This month, across the payments sheet</h3>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {data.months.length === 0 ? (
            <span className="text-[11px] text-[#8A8175]">no months registered</span>
          ) : (
            data.months.map((m) => (
              <a
                key={m.monthKey}
                href={sheetEditUrl(m.spreadsheetId)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-[#8A8175] hover:text-[#1F1B16]"
                title={`Open ${m.label} in Google Sheets`}
              >
                {m.label} <ExternalLink size={11} />
              </a>
            ))
          )}
        </div>
      </div>

      {/* Founder's exact six tiles, in the order asked for: Gross, Net,
          Fees, Awaiting, Refunds, Exchanges. Awaiting Payments (Extension C)
          comes from a second, independent fetch — see useAwaitingAed above. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Gross Sales" value={aed2(m.grossAed)} icon={TrendingUp} tone="#2E6B7A" />
        <Tile label="Net Sales" value={aed2(m.netAed)} icon={Banknote} tone="#4B7A54" />
        <Tile label="Fees" value={aed2(m.feesAed)} icon={Percent} tone="#8A8175" />
        <Tile
          label="Awaiting Payments"
          value={awaitingLoading ? "…" : awaitingAed == null ? "—" : aed2(awaitingAed)}
          note={awaitingAed == null && !awaitingLoading ? "couldn't load" : undefined}
          icon={Clock} tone="#B0742E"
        />
        <Tile label="Refunds / Cancellations" value={aed2(m.cancelled.amountAed)} icon={RotateCcw} tone="#A6472F" />
        <Tile label="Exchanges" value={String(m.exchange.count)} icon={ArrowLeftRight} tone="#6F5325" />
      </div>

      {(data.feeRanking.best || data.feeRanking.worst) && (
        <p className="text-[11px] text-[#8A8175]">
          {data.feeRanking.worst && <>Costliest gateway: <b className="text-[#1F1B16]">{data.feeRanking.worst.gatewayLabel}</b> ({data.feeRanking.worst.feePercent}%)</>}
          {data.feeRanking.best && <> · Cheapest: <b className="text-[#1F1B16]">{data.feeRanking.best.gatewayLabel}</b> ({data.feeRanking.best.feePercent}%)</>}
        </p>
      )}

      {data.gatewayBreakdown.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setGatewayFilter(null)} className={pillClass(gatewayFilter === null)}>
            All gateways
          </button>
          {data.gatewayBreakdown.map((g) => (
            <button
              key={g.gatewayLabel}
              onClick={() => setGatewayFilter(gatewayFilter === g.gatewayLabel ? null : g.gatewayLabel)}
              className={pillClass(gatewayFilter === g.gatewayLabel)}
            >
              {g.gatewayLabel}
            </button>
          ))}
        </div>
      )}

      {data.gatewayBreakdown.length > 0 && (
        <div className="rounded-2xl border border-[#EAE3D6] bg-white p-4 shadow-sm">
          <GatewayBarChart rows={filteredBreakdown} />
        </div>
      )}

      {filteredBreakdown.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[#EAE3D6] bg-white">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-[#FBF8F1]">
                <th className="px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Gateway</th>
                <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Orders</th>
                <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Gross</th>
                <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Fee</th>
                <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Net payout</th>
                <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Refunds/Cancelled</th>
              </tr>
            </thead>
            <tbody>
              {filteredBreakdown.map((g) => (
                <tr key={g.gatewayLabel} className="border-t border-[#EAE3D6]">
                  <td className="px-3 py-2 font-medium text-[#1F1B16]">{g.gatewayLabel}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{g.totalOrders}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{aed2(g.grossAed)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[#8A8175]">{aed2(g.feesAed)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums font-medium">{aed2(g.netAed)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[#A6472F]">{aed2(g.cancelled.amountAed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
