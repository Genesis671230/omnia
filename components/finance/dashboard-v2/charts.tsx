"use client";

/* Chart grid — stacked revenue area with per-store gradients, gateway donut
   with centred total, and an image-led top-products carousel. All data is the
   /api/dashboard payload; charts are presentation only. */

import { Package } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import type { Dash } from "./types";
import { STORE_COLOR, GATEWAY_COLOR, aed, compact, shortDate } from "./types";

function DarkTip({ active, payload, label, money = true }: { active?: boolean; payload?: { name: string; value: number; color?: string; payload?: Record<string, unknown> }[]; label?: string; money?: boolean }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => Number(p.value) > 0);
  return (
    <div className="dv2-tip">
      {label && <div className="dv2-tip-label">{typeof label === "string" && label.includes("-") ? shortDate(label) : label}</div>}
      {rows.map((p, i) => (
        <div key={i} className="dv2-tip-row">
          <span style={{ background: p.color }} />{p.name}: <b>{money ? aed(Number(p.value)) : Number(p.value).toLocaleString()}</b>
        </div>
      ))}
    </div>
  );
}

export function RevenueArea({ trend, stores }: { trend: Dash["trend"]; stores: string[] }) {
  const rows = trend.map((t) => ({ date: t.date, ...t.byStore }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={rows} margin={{ left: -6, right: 10, top: 10, bottom: 0 }}>
        <defs>
          {stores.map((s) => (
            <linearGradient key={s} id={`grad-${s}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={STORE_COLOR[s]} stopOpacity={0.55} />
              <stop offset="100%" stopColor={STORE_COLOR[s]} stopOpacity={0.06} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="rgba(0,0,0,.05)" />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: "#9a8b73" }} axisLine={false} tickLine={false} minTickGap={26} />
        <YAxis tickFormatter={(v) => compact(v)} tick={{ fontSize: 10, fill: "#9a8b73" }} axisLine={false} tickLine={false} width={44} />
        <Tooltip content={<DarkTip />} cursor={{ stroke: "rgba(124,58,237,.25)", strokeWidth: 24 }} />
        {stores.map((s) => (
          <Area key={s} type="monotone" dataKey={s} stackId="rev" name={s}
            stroke={STORE_COLOR[s]} strokeWidth={2} fill={`url(#grad-${s})`} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function GatewayDonut({ gateways, total }: { gateways: Dash["gateways"]; total: number }) {
  const data = gateways.map((g) => ({ name: g.gateway, value: g.revenue, share: g.share }));
  return (
    <div className="dv2-donut">
      <div className="dv2-donut-chart">
        <ResponsiveContainer width="100%" height={210}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92}
              paddingAngle={2} strokeWidth={0} animationDuration={700}>
              {data.map((d) => <Cell key={d.name} fill={GATEWAY_COLOR[d.name] ?? "#94a3b8"} />)}
            </Pie>
            <Tooltip content={<DarkTip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="dv2-donut-center">
          <b>{aed(total)}</b>
          <span>total</span>
        </div>
      </div>
      <div className="dv2-donut-legend">
        {data.map((d) => (
          <div key={d.name}>
            <i style={{ background: GATEWAY_COLOR[d.name] ?? "#94a3b8" }} />
            <span className="dv2-lg-name">{d.name}</span>
            <b>{d.share}%</b>
          </div>
        ))}
        {data.length === 0 && <p className="dv2-quiet">No orders in this window.</p>}
      </div>
    </div>
  );
}

export function TopProductsCarousel({ products }: { products: Dash["topProducts"] }) {
  if (products.length === 0) {
    return <p className="dv2-quiet">No line items in this window — run a sync to pull products with each order.</p>;
  }
  const max = Math.max(...products.map((p) => p.revenue), 1);
  return (
    <div className="dv2-prods">
      {products.map((p, i) => (
        <article key={p.sku || p.title} className="dv2-prod" style={{ animationDelay: `${i * 50}ms` }}>
          <span className="dv2-prod-rank">#{i + 1}</span>
          {p.image_url ? (
            <img src={p.image_url} alt="" loading="lazy" />
          ) : (
            <span className="dv2-prod-empty"><Package size={22} /></span>
          )}
          <div className="dv2-prod-body">
            <h4 title={p.title}>{p.title}</h4>
            <div className="dv2-prod-meter"><i style={{ width: `${(p.revenue / max) * 100}%` }} /></div>
            <div className="dv2-prod-row">
              <b>{aed(p.revenue)}</b>
              <span>{p.qty} sold</span>
            </div>
            <div className="dv2-prod-stores">
              {p.stores.map((s) => <em key={s} style={{ color: STORE_COLOR[s], borderColor: `${STORE_COLOR[s]}55` }}>{s}</em>)}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export const CHARTS_CSS = `
  .dv2-tip { background: #211D18; color: #F7F2E8; border-radius: 10px; padding: 9px 12px; font-size: 11.5px; box-shadow: 0 8px 24px rgba(0,0,0,.3); }
  .dv2-tip-label { font-weight: 700; margin-bottom: 5px; }
  .dv2-tip-row { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
  .dv2-tip-row span { width: 8px; height: 8px; border-radius: 2.5px; flex-shrink: 0; }
  .dv2-tip-row b { margin-left: auto; padding-left: 12px; font-variant-numeric: tabular-nums; }
  .dv2-quiet { color: #8A8175; font-size: 13px; line-height: 1.5; margin: 0; }

  .dv2-donut { display: flex; align-items: center; gap: 18px; }
  .dv2-donut-chart { position: relative; flex: 1; min-width: 0; }
  .dv2-donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; }
  .dv2-donut-center b { font-family: Georgia, serif; font-size: 17px; color: #1F1B16; }
  .dv2-donut-center span { font-size: 10.5px; color: #8A8175; text-transform: uppercase; letter-spacing: .08em; }
  .dv2-donut-legend { display: flex; flex-direction: column; gap: 8px; min-width: 150px; }
  .dv2-donut-legend > div { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .dv2-donut-legend i { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
  .dv2-lg-name { color: #1F1B16; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .dv2-donut-legend b { font-variant-numeric: tabular-nums; color: #8A8175; font-weight: 600; }

  .dv2-prods { display: flex; gap: 12px; overflow-x: auto; padding: 4px 2px 10px; scrollbar-width: thin; }
  .dv2-prod { position: relative; flex: 0 0 168px; background: #fff; border: 1px solid #EAE3D6; border-radius: 16px; overflow: hidden;
    display: flex; flex-direction: column; opacity: 0; transform: translateY(8px); animation: dv2prodin .4s ease forwards;
    transition: transform .18s ease, box-shadow .18s ease; }
  @keyframes dv2prodin { to { opacity: 1; transform: translateY(0); } }
  .dv2-prod:hover { transform: translateY(-4px); box-shadow: 0 14px 30px -14px rgba(76,29,149,.35); }
  .dv2-prod-rank { position: absolute; top: 8px; left: 8px; z-index: 1; font-size: 10px; font-weight: 800; color: #fff;
    background: linear-gradient(120deg, #7c3aed, #a855f7); border-radius: 999px; padding: 3px 8px; }
  .dv2-prod img { width: 100%; height: 118px; object-fit: cover; background: #F6F1E7; }
  .dv2-prod-empty { width: 100%; height: 118px; display: flex; align-items: center; justify-content: center; background: #F6F1E7; color: #C9BFAE; }
  .dv2-prod-body { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px 12px; }
  .dv2-prod h4 { margin: 0; font-size: 12px; line-height: 1.35; color: #1F1B16; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.6em; }
  .dv2-prod-meter { height: 5px; border-radius: 999px; background: #F6F1E7; overflow: hidden; }
  .dv2-prod-meter i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #7c3aed, #c084fc); }
  .dv2-prod-row { display: flex; justify-content: space-between; align-items: baseline; }
  .dv2-prod-row b { font-size: 13px; color: #1F1B16; font-variant-numeric: tabular-nums; }
  .dv2-prod-row span { font-size: 11px; color: #8A8175; }
  .dv2-prod-stores { display: flex; gap: 4px; flex-wrap: wrap; }
  .dv2-prod-stores em { font-style: normal; font-size: 9.5px; font-weight: 700; border: 1px solid; border-radius: 6px; padding: 1px 6px; }

  @media (max-width: 700px) { .dv2-donut { flex-direction: column; } }
`;
