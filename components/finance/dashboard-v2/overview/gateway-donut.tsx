"use client";

/* Gateway mix as a donut + a legend that carries every number (identity is
   never colour-alone). Hover a slice or a legend row to focus it; the centre
   shows that gateway's sales and how much of it has reached the bank. */

import { motion } from "framer-motion";
import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import type { GatewayMoney } from "@/lib/orders/day-money";
import { aed, compact, gatewayColor, pct } from "./kit";

export function GatewayDonut({ gateways, size = 190, compactLegend = false }: { gateways: GatewayMoney[]; size?: number; compactLegend?: boolean }) {
  const [focus, setFocus] = useState<string | null>(null);
  const total = gateways.reduce((s, g) => s + g.soldAed, 0);
  const f = gateways.find((g) => g.gateway === focus) ?? null;
  const center = f ?? { gateway: "All gateways", soldAed: total, receivedAed: gateways.reduce((s, g) => s + g.receivedAed, 0) };

  if (total <= 0) return <p className="py-10 text-center text-[13px] text-slate-500">No sales in this range.</p>;

  return (
    <div className={`flex ${compactLegend ? "flex-col items-center gap-4" : "flex-col items-center gap-5 sm:flex-row sm:items-center"}`}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={gateways}
              dataKey="soldAed"
              nameKey="gateway"
              innerRadius="68%"
              outerRadius="100%"
              paddingAngle={1.5}
              stroke="#fff"
              strokeWidth={2}
              cornerRadius={4}
              isAnimationActive
              animationDuration={700}
              onMouseEnter={(_, i) => setFocus(gateways[i]?.gateway ?? null)}
              onMouseLeave={() => setFocus(null)}
            >
              {gateways.map((g) => (
                <Cell key={g.gateway} fill={gatewayColor(g.gateway)} fillOpacity={focus && focus !== g.gateway ? 0.25 : 1} style={{ transition: "fill-opacity .2s", cursor: "pointer" }} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <motion.span key={center.gateway} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} className="text-[11px] font-medium text-slate-500">
            {center.gateway}
          </motion.span>
          <span className="text-[22px] font-semibold tracking-tight text-slate-900 tabular-nums">{compact(center.soldAed)}</span>
          <span className="text-[11px] text-slate-500 tabular-nums">{pct(center.soldAed ? center.receivedAed / center.soldAed : 0)} received</span>
        </div>
      </div>

      <ul className="w-full min-w-0 flex-1 space-y-1">
        {gateways.map((g) => (
          <li
            key={g.gateway}
            onMouseEnter={() => setFocus(g.gateway)}
            onMouseLeave={() => setFocus(null)}
            className={`grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5 rounded-xl px-2 py-1.5 text-[12.5px] transition-colors ${focus === g.gateway ? "bg-slate-100" : ""}`}
          >
            <i className="h-2.5 w-2.5 rounded-full" style={{ background: gatewayColor(g.gateway) }} />
            <span className="truncate font-medium text-slate-900">
              {g.gateway} <span className="font-normal text-slate-400">· {pct(g.soldAed / total)}</span>
            </span>
            <span className="text-right tabular-nums text-slate-900" title={aed(g.soldAed)}>{compact(g.soldAed)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
