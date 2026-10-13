"use client";

/* The day drawer's chart view: one day at a glance.
   ring (how much is in the bank) · gateway donut · per-gateway received vs
   pending bars · why the rest is pending · what to do about it · sales by hour. */

import { motion } from "framer-motion";
import { FileUp, Landmark, Truck } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toDayMoney } from "@/lib/orders/day-money";
import type { LedgerDay, LedgerStatus } from "../day-sales-drawer";
import { GatewayDonut } from "./gateway-donut";
import { FILL, ProgressRing, aed, compact, gatewayColor, pct } from "./kit";

const STATUS_COLOR: Record<LedgerStatus, string> = {
  received: "#10B981", in_review: "#F59E0B", awaiting_bank: "#3B82F6", awaiting_payout: "#06B6D4", no_payout_file: "#F43F5E", cod: "#A855F7", adjusted: "#94A3B8",
};
const STATUS_LABEL: Record<LedgerStatus, string> = {
  received: "Received in bank", in_review: "Needs confirming", awaiting_bank: "Awaiting bank credit",
  awaiting_payout: "Charged · payout pending", no_payout_file: "Payout file not uploaded", cod: "Cash on delivery", adjusted: "Returned / refunded",
};

export function DayCharts({ day, onFilter }: { day: LedgerDay; onFilter: (s: LedgerStatus, gateway?: string) => void }) {
  const m = toDayMoney(day);
  const share = m.soldAed ? m.receivedAed / m.soldAed : 0;
  const statuses = (Object.keys(STATUS_COLOR) as LedgerStatus[]).filter((s) => day.statusCounts[s]?.orders > 0);

  // What to do: group the blocking orders by gateway.
  const todo = new Map<string, { kind: "file" | "bank" | "cod"; gateway: string; orders: number; amount: number }>();
  for (const o of day.orderList) {
    const kind = o.status === "no_payout_file" ? "file" : o.status === "awaiting_bank" || o.status === "in_review" ? "bank" : o.status === "cod" ? "cod" : null;
    if (!kind) continue;
    const k = `${kind}|${o.gateway}`;
    const t = todo.get(k) ?? { kind, gateway: o.gateway, orders: 0, amount: 0 };
    t.orders += 1; t.amount += o.grossAed;
    todo.set(k, t);
  }
  const todos = [...todo.values()].sort((a, b) => (a.kind === b.kind ? b.amount - a.amount : a.kind.localeCompare(b.kind) * -1));

  // Sales by Dubai hour (order_date is offset-less UTC).
  const hours = Array.from({ length: 24 }, (_, h) => ({ h, amount: 0, orders: 0 }));
  for (const o of day.orderList) {
    const utcH = Number((o.orderDate ?? "").slice(11, 13));
    if (Number.isNaN(utcH)) continue;
    const h = (utcH + 4) % 24;
    hours[h].amount += o.grossAed; hours[h].orders += 1;
  }

  return (
    <div className="space-y-4 font-[family-name:var(--os-font)] text-slate-900">
      {/* headline */}
      <div className="flex items-center gap-5 rounded-3xl border border-slate-200 bg-gradient-to-b from-[#F3F7FE] to-[#E4EDFC] p-4">
        <ProgressRing value={share} size={80} stroke={8} />
        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          {[
            ["Sold", m.soldAed],
            ["Received", m.receivedAed],
            ["Pending", m.pendingAed],
            [`≈ Fee · ${pct(m.feeRate)}`, m.feeAed],
          ].map(([l, v]) => (
            <div key={l as string}>
              <dt className="text-[11.5px] text-slate-500">{l}</dt>
              <dd className="text-[18px] font-semibold tabular-nums text-slate-900" title={aed(v as number)}>{compact(v as number)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* what to do */}
      {todos.length > 0 && (
        <div className="rounded-3xl border border-slate-200 bg-white p-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">To close this day</div>
          <ul className="space-y-1.5">
            {todos.map((t) => {
              const Icon = t.kind === "file" ? FileUp : t.kind === "bank" ? Landmark : Truck;
              const text = t.kind === "file" ? `Upload the ${t.gateway} payout file` : t.kind === "bank" ? `Match the ${t.gateway} payout to its bank credit` : "Wait for the courier's COD remittance";
              return (
                <li key={`${t.kind}${t.gateway}`}>
                  <button
                    onClick={() => onFilter(t.kind === "file" ? "no_payout_file" : t.kind === "bank" ? "awaiting_bank" : "cod", t.gateway)}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12.5px] transition hover:bg-slate-50"
                  >
                    <Icon size={14} className="text-slate-500" />
                    <i className="h-2 w-2 rounded-full" style={{ background: gatewayColor(t.gateway) }} />
                    <span className="flex-1 font-medium">{text}</span>
                    <span className="tabular-nums text-slate-500">{t.orders} orders</span>
                    <b className="font-semibold tabular-nums" title={aed(t.amount)}>AED {compact(t.amount)}</b>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* gateway mix */}
        <div className="rounded-3xl border border-slate-200 bg-white p-4">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Gateway mix</div>
          <GatewayDonut gateways={m.byGateway} size={150} compactLegend />
        </div>

        {/* received vs pending per gateway */}
        <div className="rounded-3xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between text-[11px]">
            <span className="font-semibold uppercase tracking-[0.08em] text-slate-500">In bank by gateway</span>
            <span className="flex gap-2 text-slate-500"><span><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: FILL.received }} />received</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: FILL.pending }} />pending</span></span>
          </div>
          <ul className="space-y-3">
            {m.byGateway.map((g) => (
              <li key={g.gateway}>
                <div className="mb-1 flex items-center justify-between text-[12.5px]">
                  <span className="inline-flex items-center gap-1.5 font-medium"><i className="h-2 w-2 rounded-full" style={{ background: gatewayColor(g.gateway) }} />{g.gateway}<span className="font-normal text-slate-400">· {g.orders}</span></span>
                  <span className="tabular-nums"><b>{compact(g.receivedAed)}</b><span className="text-slate-400"> / {compact(g.soldAed)}</span></span>
                </div>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <motion.i initial={{ width: 0 }} animate={{ width: `${(g.receivedAed / g.soldAed) * 100}%` }} transition={{ duration: 0.6 }} className="block h-full" style={{ background: FILL.received }} />
                  <motion.i initial={{ width: 0 }} animate={{ width: `${(g.pendingAed / g.soldAed) * 100}%` }} transition={{ duration: 0.6, delay: 0.1 }} className="block h-full" style={{ background: FILL.pending }} />
                </div>
                
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* status */}
      <div className="rounded-3xl border border-slate-200 bg-white p-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Where each order’s money is</div>
        <div className="mb-3 flex h-3 gap-0.5 overflow-hidden rounded-full">
          {statuses.map((s) => (
            <motion.i key={s} initial={{ flexGrow: 0 }} animate={{ flexGrow: day.statusCounts[s].grossAed }} transition={{ duration: 0.7 }} className="block min-w-[4px]" style={{ background: STATUS_COLOR[s] }} />
          ))}
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {statuses.map((s) => (
            <button key={s} onClick={() => onFilter(s)} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-left text-[12.5px] transition hover:bg-slate-50">
              <i className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
              <span className="flex-1 text-slate-600">{STATUS_LABEL[s]}</span>
              <span className="tabular-nums text-slate-400">{day.statusCounts[s].orders}</span>
              <b className="tabular-nums">{compact(day.statusCounts[s].grossAed)}</b>
            </button>
          ))}
        </div>
      </div>

      {/* by hour */}
      <div className="rounded-3xl border border-slate-200 bg-white p-4">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Sales by hour · Dubai</div>
        <div className="h-[120px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hours} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="h" tickLine={false} axisLine={false} interval={2} tick={{ fontSize: 10.5, fill: "#8793AB" }} tickFormatter={(h) => `${h}:00`} />
              <YAxis hide />
              <Tooltip
                cursor={{ fill: "#EEF2FA" }}
                content={({ active, payload }) => {
                  const r = payload?.[0]?.payload as (typeof hours)[number] | undefined;
                  if (!active || !r) return null;
                  return <div className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[12px] shadow-lg"><b>{r.h}:00–{r.h + 1}:00</b> · {r.orders} orders · {aed(r.amount)}</div>;
                }}
              />
              <Bar dataKey="amount" fill="#93A7D0" radius={[4, 4, 0, 0]} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
