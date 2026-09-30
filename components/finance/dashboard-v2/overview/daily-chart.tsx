"use client";

/* The daily bar chart. Two views of the same bars (one axis, AED):
   • by gateway — each day's sales stacked in its gateways' fixed colours
   • received / pending — the same total split into what's in the bank
   Under every day sits its progress ring (received share), so "how much of
   this day has landed" reads without hovering. Click a day to inspect it,
   double-click to open its orders. */

import { Bar, BarChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DayMoney } from "@/lib/orders/day-money";
import { FILL, ProgressRing, aed, compact, dayLong, gatewayColor, pct } from "./kit";

export type ChartMode = "gateway" | "status";
type Row = { day: string; n: number; money: DayMoney | null } & Record<string, number | string | DayMoney | null>;

function Tick({ x, y, payload, rows, selected, today }: {
  x?: number; y?: number; payload?: { value: string }; rows: Map<string, DayMoney | null>; selected: string | null; today: string;
}) {
  const day = payload?.value ?? "";
  const m = rows.get(day) ?? null;
  const n = Number(day.slice(8, 10));
  const sel = day === selected;
  return (
    <g transform={`translate(${x},${y})`} className="group p-2">
      <text y={12} textAnchor="middle" className="tabular-nums" fontSize={11} fontWeight={sel ? 700 : 500} fill={sel ? "#0F1B3D" : day > today ? "#B6C1D6" : "#5E6B85"}>
        {n}
      </text>
      {m && m.soldAed > 0 && (
        <foreignObject  x={-11} y={18} width={22} height={22}>
          <ProgressRing value={m.receivedAed / m.soldAed} size={20} stroke={3} label={false} />
        </foreignObject>
      )}
    </g>
  );
}

function Tip({ active, payload, mode }: { active?: boolean; payload?: { payload: Row }[]; mode: ChartMode }) {
  const m = payload?.[0]?.payload.money as DayMoney | null | undefined;
  if (!active || !m) return null;
  return (
    <div className="min-w-[230px] rounded-2xl border border-slate-200 bg-white p-3.5 text-[12.5px] shadow-[0_18px_40px_-16px_rgba(15,27,61,0.35)]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <b className="text-[13px] text-slate-900">{dayLong(m.day)}</b>
        <span className="text-slate-500">{m.orders} orders</span>
      </div>
      <div className="mb-2 text-[20px] font-semibold tracking-tight text-slate-900 tabular-nums">{aed(m.soldAed)}</div>
      {mode === "gateway" && (
        <div className="mb-2 space-y-1 border-b border-slate-100 pb-2">
          {m.byGateway.map((g) => (
            <div key={g.gateway} className="flex items-center gap-2">
              <i className="h-2.5 w-2.5 rounded-full" style={{ background: gatewayColor(g.gateway) }} />
              <span className="text-slate-600">{g.gateway}</span>
              <span className="ml-auto tabular-nums text-slate-900">{aed(g.soldAed)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-1">
        <div className="flex justify-between"><span className="text-slate-600">Received</span><b className="tabular-nums text-[#047857]">{aed(m.receivedAed)}</b></div>
        <div className="flex justify-between"><span className="text-slate-600">Pending</span><b className="tabular-nums text-[#B45309]">{aed(m.pendingAed)}</b></div>
        <div className="flex justify-between"><span className="text-slate-600">≈ Gateway fee</span><b className="tabular-nums text-[#BE123C]">{aed(m.feeAed)} · {pct(m.feeRate)}</b></div>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">Click to inspect · double-click for orders</p>
    </div>
  );
}

export function DailyChart({
  days, money, mode, gateways, selected, today, onSelect, onOpen, height = 300,
}: {
  days: string[];
  money: Map<string, DayMoney>;
  mode: ChartMode;
  gateways: string[];
  selected: string | null;
  today: string;
  onSelect: (day: string) => void;
  onOpen: (day: string) => void;
  height?: number;
}) {
  const rows: Row[] = days.map((day) => {
    const m = money.get(day) ?? null;
    const row: Row = { day, n: Number(day.slice(8, 10)), money: m };
    if (mode === "gateway") for (const g of gateways) row[g] = m?.byGateway.find((x) => x.gateway === g)?.soldAed ?? 0;
    else { row.received = m?.receivedAed ?? 0; row.pending = m?.pendingAed ?? 0; }
    return row;
  });
  const byDay = new Map(rows.map((r) => [r.day, r.money]));
  const series = mode === "gateway"
    ? gateways.map((g) => ({ key: g, color: gatewayColor(g) }))
    : [{ key: "received", color: FILL.received }, { key: "pending", color: FILL.pending }];
  const barSize = Math.max(Math.min(Math.floor(420 / Math.max(days.length, 1)), 16), 5); // thin bars, like the reference

  return (
    <div style={{ height }} className="w-full select-none">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
          barCategoryGap="22%"
          onClick={(e) => { const d = e?.activeLabel as string | undefined; if (d && money.has(d)) onSelect(d); }}
          onDoubleClick={(e: { activeLabel?: string } | null) => { const d = e?.activeLabel; if (d && money.has(d)) onOpen(d); }}
        >
          <CartesianGrid vertical={false} stroke="#EEF1F6" strokeDasharray="2 6" />
          <XAxis
            dataKey="day"
            interval={0}
            tickLine={false}
            axisLine={false}
            height={46}
            tick={<Tick rows={byDay} selected={selected} today={today} />}
          />
          <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(v) => compact(Number(v))} tick={{ fontSize: 11, fill: "#5E6B85" }} />
          {selected && <ReferenceArea x1={selected} x2={selected} fill="#E8EEFB" fillOpacity={1} ifOverflow="extendDomain" radius={10} />}
          <Tooltip cursor={{ fill: "#EEF2FA", radius: 8 }} content={<Tip mode={mode} />} wrapperStyle={{ outline: "none", zIndex: 20 }} />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId="a"
              fill={s.color}
              maxBarSize={barSize}
              radius={i === series.length - 1 ? [5, 5, 0, 0] : [0, 0, 0, 0]}
              stroke="#fff"
              strokeWidth={0.5}
              isAnimationActive
              animationDuration={650}
              style={{ cursor: "pointer" }}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
