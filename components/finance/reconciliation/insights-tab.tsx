"use client";

import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, Banknote, Clock, Percent, TrendingUp } from "lucide-react";
import {
  agingByGateway, exceptionsByGateway, feeBurnByGateway, fxDriftRows, insightTotals,
  settlementTimeline, type InsightLine,
} from "@/lib/reconciliation/insights";
import { AGING_COLORS, CHART_INK, gatewayColor, STATE_COLORS } from "./colors";
import { aed0, aed2, type ReconLine } from "./types";

/* The Insights tab.
 *
 * Every number here comes from the SAME payload the rows below are drawn from,
 * through the pure functions in lib/reconciliation/insights.ts — a separate
 * aggregation endpoint would be a second source of truth for the same figures,
 * free to drift from the rows it sits above.
 *
 * Palette note: three of the six gateway hues sit under 3:1 on white. The
 * dataviz relief rule therefore applies throughout — every bar carries a direct
 * value label and a legend, so color never carries meaning on its own.
 */

const money = (v: number) => aed0(v);

function ChartCard({ title, subtitle, icon: Icon, children, empty }: {
  title: string; subtitle: string; icon: React.ElementType;
  children: React.ReactNode; empty?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#EAE3D6] bg-white p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <Icon size={15} className="text-[#B08343]" />
        <h3 className="text-[14.5px] font-semibold text-[#1F1B16]">{title}</h3>
      </div>
      <p className="mb-4 text-[12.5px] leading-relaxed text-[#8A8175]">{subtitle}</p>
      {empty ? (
        <div className="flex h-[180px] items-center justify-center rounded-xl border border-dashed border-[#D6CCBA] px-6 text-center text-[13px] text-[#8A8175]">
          {empty}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function StatTile({ label, value, note, icon: Icon, tone }: {
  label: string; value: string; note: string; icon: React.ElementType; tone: string;
}) {
  return (
    <div className="rounded-2xl border border-[#EAE3D6] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-[12px] text-[#8A8175]">
        <Icon size={13} style={{ color: tone }} /> {label}
      </div>
      <div className="mt-1.5 font-serif text-[26px] tabular-nums" style={{ color: tone }}>{value}</div>
      <div className="mt-0.5 text-[11.5px] text-[#8A8175]">{note}</div>
    </div>
  );
}

const tooltipStyle = {
  background: "#FFFFFF",
  border: "1px solid #EAE3D6",
  borderRadius: 10,
  fontSize: 12.5,
  padding: "8px 10px",
  boxShadow: "0 4px 16px rgba(31,27,22,0.08)",
};

export function InsightsTab({ lines }: { lines: ReconLine[] }) {
  const data = lines as unknown as InsightLine[];
  const totals = insightTotals(data);
  const aging = agingByGateway(data);
  const fees = feeBurnByGateway(data).filter((f) => f.hasData || f.lineCount > 0);
  const timeline = settlementTimeline(data);
  const exceptions = exceptionsByGateway(data);
  const drift = fxDriftRows(data);

  return (
    <div className="space-y-4">
      {/* Headline tiles — a hero number needs no plot. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Cash in transit" value={money(totals.inTransit)}
          note={`${totals.inTransitCount} credits · ${totals.overdueCount} overdue`}
          icon={Clock} tone="#B0742E"
        />
        <StatTile
          label="Bank-confirmed settled" value={money(totals.settledAed)}
          note={`${totals.settledCount} credits proven end to end`}
          icon={Banknote} tone="#4B7A54"
        />
        <StatTile
          label="Gateway fees" value={money(totals.feeAed)}
          note={totals.blendedFeePct != null ? `${totals.blendedFeePct}% blended rate` : "no per-order data yet"}
          icon={Percent} tone="#2E6B7A"
        />
        <StatTile
          label="Exception exposure" value={money(totals.exceptionAed)}
          note={`${totals.exceptionCount} credits need a decision`}
          icon={AlertTriangle} tone={totals.exceptionCount ? "#A6472F" : "#8A8175"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Cash in transit + aging ── */}
        <ChartCard
          title="Cash in transit, by how long they've held it"
          subtitle="Money a gateway has collected but not yet paid out. Past 7 days the payout file is overdue by our own rule — that's when to start chasing."
          icon={Clock}
          empty={aging.length === 0 ? "Nothing in transit — every bank credit has its payout file." : undefined}
        >
          <ResponsiveContainer width="100%" height={Math.max(180, aging.length * 52)}>
            <BarChart data={aging} layout="vertical" margin={{ left: 4, right: 64, top: 4, bottom: 4 }}>
              <CartesianGrid horizontal={false} stroke={CHART_INK.grid} />
              <XAxis type="number" tickFormatter={money} stroke={CHART_INK.axis}
                tick={{ fontSize: 11, fill: CHART_INK.muted }} />
              <YAxis type="category" dataKey="gateway" width={78} stroke={CHART_INK.axis}
                tick={{ fontSize: 12, fill: CHART_INK.secondary }} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [aed2(v), `${n} days`]} />
              <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 8 }} formatter={(v) => `${v} days`} />
              {/* One-hue sequential ramp: age is a magnitude, not four categories. */}
              <Bar dataKey="buckets.0-7" name="0–7" stackId="a" fill={AGING_COLORS["0-7"]} radius={[0, 0, 0, 0]} />
              <Bar dataKey="buckets.8-14" name="8–14" stackId="a" fill={AGING_COLORS["8-14"]} />
              <Bar dataKey="buckets.15+" name="15+" stackId="a" fill={AGING_COLORS["15+"]} radius={[4, 4, 4, 4]}>
                <LabelList dataKey="total" position="right" formatter={money}
                  style={{ fontSize: 11.5, fill: CHART_INK.secondary, fontWeight: 500 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* ── Fee burn ── */}
        <ChartCard
          title="What each gateway actually costs"
          subtitle="Effective rate — fees divided by gross, from the same per-order shares the proof tables show. Refunds are netted out, so this is what you really paid."
          icon={Percent}
          empty={fees.length === 0 ? "No settled payouts in this range yet." : undefined}
        >
          <ResponsiveContainer width="100%" height={Math.max(180, fees.length * 52)}>
            <BarChart data={fees} layout="vertical" margin={{ left: 4, right: 90, top: 4, bottom: 4 }}>
              <CartesianGrid horizontal={false} stroke={CHART_INK.grid} />
              <XAxis type="number" tickFormatter={money} stroke={CHART_INK.axis}
                tick={{ fontSize: 11, fill: CHART_INK.muted }} />
              <YAxis type="category" dataKey="gateway" width={78} stroke={CHART_INK.axis}
                tick={{ fontSize: 12, fill: CHART_INK.secondary }} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number, _n, p: { payload?: { ratePct: number | null } }) =>
                  [`${aed2(v)}${p?.payload?.ratePct != null ? ` · ${p.payload.ratePct}%` : ""}`, "Fees"]}
              />
              <Bar dataKey="fee" radius={[0, 4, 4, 0]}>
                {fees.map((f) => <Cell key={f.gateway} fill={gatewayColor(f.gateway)} />)}
                <LabelList
                  dataKey="ratePct" position="right"
                  formatter={(v: number | null) => (v == null ? "no per-order data" : `${v}%`)}
                  style={{ fontSize: 11.5, fill: CHART_INK.secondary, fontWeight: 500 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ── Settlement timeline ── */}
      <ChartCard
        title="Settlement rhythm"
        subtitle="Bank credits per day, split by where each one got to. A day that's mostly amber is a day whose payout files haven't arrived."
        icon={TrendingUp}
        empty={timeline.length === 0 ? "No dated bank credits in this range." : undefined}
      >
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={timeline} margin={{ left: 4, right: 8, top: 4, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke={CHART_INK.grid} />
            <XAxis dataKey="date" stroke={CHART_INK.axis} tick={{ fontSize: 11, fill: CHART_INK.muted }}
              tickFormatter={(d: string) => d.slice(5)} />
            <YAxis tickFormatter={money} stroke={CHART_INK.axis} tick={{ fontSize: 11, fill: CHART_INK.muted }} width={70} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [aed2(v), n]} />
            <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 8 }} />
            <Bar dataKey="settled" name="Settled" stackId="s" fill={STATE_COLORS.SETTLED} />
            <Bar dataKey="awaiting" name="Awaiting payout" stackId="s" fill={STATE_COLORS.AWAITING_PAYOUT} />
            <Bar dataKey="exception" name="Exception" stackId="s" fill={STATE_COLORS.PAYOUT_VARIANCE} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* ── Exceptions + FX drift ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Exception exposure by gateway"
          subtitle="Variance summed as absolute exposure — a +500 surplus and a −500 shortfall are two things to explain, not zero."
          icon={AlertTriangle}
          empty={exceptions.length === 0 ? "No exceptions. Every credit either settled or is waiting on its file." : undefined}
        >
          <div className="overflow-hidden rounded-xl border border-[#EAE3D6]">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-[#FBF8F1]">
                  <th className="px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Gateway</th>
                  <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Variance</th>
                  <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Missing orders</th>
                  <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Credits</th>
                </tr>
              </thead>
              <tbody>
                {exceptions.map((e) => (
                  <tr key={e.gateway} className="border-t border-[#EAE3D6]">
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 font-medium text-[#1F1B16]">
                        <i className="h-2.5 w-2.5 rounded-full" style={{ background: gatewayColor(e.gateway) }} />
                        {e.gateway}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[#A6472F]">{aed2(e.varianceAed)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#1F1B16]">{e.unresolvedOrders || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#8A8175]">{e.lineCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>

        <ChartCard
          title="Cross-border FX"
          subtitle="Where the bank's real wire rate differed from our estimate. Drift is a conversion artifact — nobody charged you that. The FX fee is what the gateway genuinely kept."
          icon={TrendingUp}
          empty={drift.length === 0 ? "No cross-border payouts in this range — everything settled in AED." : undefined}
        >
          <div className="overflow-hidden rounded-xl border border-[#EAE3D6]">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-[#FBF8F1]">
                  <th className="px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Payout</th>
                  <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Rate</th>
                  <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">Drift</th>
                  <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wider text-[#8A8175]">FX fee</th>
                </tr>
              </thead>
              <tbody>
                {drift.slice(0, 8).map((d) => (
                  <tr key={d.id} className="border-t border-[#EAE3D6]">
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 font-medium text-[#1F1B16]">
                        <i className="h-2.5 w-2.5 rounded-full" style={{ background: gatewayColor(d.gateway) }} />
                        {d.gateway}
                      </span>
                      <div className="text-[11px] text-[#8A8175]">{d.date?.slice(0, 10)} · {d.currency}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[#1F1B16]">
                      {d.fxRate ?? "—"}
                      <div className="text-[10.5px] font-sans text-[#8A8175]">
                        {d.fxSource === "bank" ? "bank-quoted" : "estimate"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[#8A8175]">{aed2(d.rateDriftAed)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[#1F1B16]">{aed2(d.fxFeeAed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
