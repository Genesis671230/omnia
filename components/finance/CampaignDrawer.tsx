"use client";

/* Campaign drill-down — opens when a campaign row is clicked. Shows the REAL
   day-by-day series from /api/ads/campaign/{id}:
     1. daily spend + pixel-ROAS dual-axis trend (ranked #1)
     2. funnel drop-off, stage-to-stage (ranked #2)
     3. per-day table
   ROAS shown is PIXEL (platform self-reported). Settled ROAS is store-level
   only — no campaign attribution exists — and that's stated, not hidden.

   Also exports CampaignScatter (spend vs ROAS, bubble = conversions) for the
   marketing panel's platform-efficiency section (ranked #3). */

import { AnimatePresence, motion } from "framer-motion";
import {
  X, Loader2, TrendingUp, Filter, AlertTriangle, ExternalLink, Info,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, Cell,
} from "recharts";

const PLATFORM_LABEL: Record<string, string> = { meta: "Meta", google: "Google", tiktok: "TikTok", snap: "Snapchat" };
const PLATFORM_COLOR: Record<string, string> = { meta: "#1877F2", google: "#4285F4", tiktok: "#00C4C4", snap: "#E4C000" };

const aed = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v || 0);
const aed2 = (v: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", minimumFractionDigits: 2 }).format(v || 0);
const num = (v: number) => new Intl.NumberFormat("en-US").format(v || 0);
const roas = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}x`);
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

type DailyRow = {
  date: string; spend: number; impressions: number; clicks: number; conversions: number;
  conversion_value: number; pixel_roas: number | null; cost_per_click: number | null; ctr: number | null;
  funnel: { landing_page_views: number; view_content: number; add_to_cart: number; initiate_checkout: number };
};
type Detail = {
  campaign: { campaign_id: string; platform: string; store_id: string; campaign_name: string; campaign_status: string; account_id: string } | null;
  daily: DailyRow[];
  totals: {
    spend: number; impressions: number; clicks: number; conversions: number; conversion_value: number;
    pixel_roas: number | null; cost_per_conversion: number | null; active_days: number;
    funnel: { landing_page_views: number; view_content: number; add_to_cart: number; initiate_checkout: number; purchase: number };
  } | null;
};

/* ── shared dark tooltip ────────────────────────────────────────────────── */
function Tip({ active, payload, label, rows }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="cd-tip">
      <div className="cd-tip-label">{label}</div>
      {(rows ?? payload).map((p: any, i: number) => (
        <div key={i} className="cd-tip-row"><span style={{ background: p.color }} />{p.name}: <b>{p.fmt ? p.fmt(p.value) : p.value}</b></div>
      ))}
    </div>
  );
}

/* ── #2 funnel drop-off ─────────────────────────────────────────────────── */
function FunnelViz({ f }: { f: Detail["totals"] extends null ? never : NonNullable<Detail["totals"]>["funnel"] }) {
  const stages = [
    { label: "Landing views", value: f.landing_page_views },
    { label: "View content", value: f.view_content },
    { label: "Add to cart", value: f.add_to_cart },
    { label: "Checkout", value: f.initiate_checkout },
    { label: "Purchase", value: f.purchase },
  ];
  const top = stages[0].value || 1;
  if (stages.every((s) => s.value === 0)) return <p className="cd-quiet">No funnel data for this campaign (platform reports funnel stages for Meta only).</p>;

  return (
    <div className="funnel-viz">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const drop = prev && prev > 0 ? 1 - s.value / prev : null;
        const widthPct = (s.value / top) * 100;
        const bigLeak = drop !== null && drop >= 0.9;
        return (
          <div key={s.label} className="fv-stage">
            <div className="fv-meta">
              <span className="fv-label">{s.label}</span>
              <span className="fv-val">{num(s.value)}</span>
            </div>
            <div className="fv-bar-track">
              <div className={`fv-bar ${bigLeak ? "leak" : ""}`} style={{ width: `${widthPct}%` }} />
            </div>
            {drop !== null && drop > 0 && (
              <span className={`fv-drop ${bigLeak ? "bad" : ""}`}>
                {bigLeak && <AlertTriangle size={10} />}−{(drop * 100).toFixed(0)}% drop-off from previous stage
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── the drawer ─────────────────────────────────────────────────────────── */
export function CampaignDrawer({ campaignId, days, onClose }: { campaignId: string; days: number; onClose: () => void }) {
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  console.log("CampaignDrawer mounted", campaignId);
  useEffect(() => {
    console.log("Fetching campaign", campaignId);
    setLoading(true);
    fetch(`/api/ads/campaign/${encodeURIComponent(campaignId)}?days=${days}`)
      .then((r) => r.json()).then(setData).then(console.log).catch(() => setData(null)).finally(() => setLoading(false));
  }, [campaignId, days]);

  const c = data?.campaign, t = data?.totals;
  const color = c ? PLATFORM_COLOR[c.platform] ?? "#888" : "#888";

  return (
    <AnimatePresence>
      <motion.div className="cd-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
        <motion.div className="cd-drawer" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
          transition={{ type: "spring", stiffness: 320, damping: 34 }} onClick={(e) => e.stopPropagation()}>
          <style>{DRAWER_CSS}</style>
          <div className="cd-flare" style={{ background: `linear-gradient(180deg, ${color}22, transparent)` }} />

          {loading ? (
            <div className="cd-loading"><Loader2 size={20} className="spin" /> Loading campaign…</div>
          ) : !c || !t ? (
            <div className="cd-loading">No data for this campaign in the selected window.<button className="cd-close-btn" onClick={onClose}><X size={16} /></button></div>
          ) : (
            <>
              <header>
                <div>
                  <span className="cd-plat" style={{ color }}>
                    <i style={{ background: color }} />{PLATFORM_LABEL[c.platform] ?? c.platform}
                    <span className={`cd-status ${c.campaign_status.toLowerCase()}`}>{c.campaign_status}</span>
                  </span>
                  <h2>{c.campaign_name}</h2>
                  <span className="cd-sub">{c.store_id} · {t.active_days} active day{t.active_days === 1 ? "" : "s"} · acct {c.account_id}</span>
                </div>
                <button className="cd-close-btn" onClick={onClose}><X size={16} /></button>
              </header>

              {/* KPI strip */}
              <div className="cd-kpis">
                <div><span>Spend</span><b>{aed(t.spend)}</b></div>
                <div><span>ROAS <em>pixel</em></span><b>{roas(t.pixel_roas)}</b></div>
                <div><span>Conversions</span><b>{num(Math.round(t.conversions))}</b></div>
                <div><span>Cost / conv.</span><b>{t.cost_per_conversion != null ? aed2(t.cost_per_conversion) : "—"}</b></div>
                <div><span>Clicks</span><b>{num(t.clicks)}</b></div>
                <div><span>Impressions</span><b>{num(t.impressions)}</b></div>
              </div>

              {/* #1 daily spend + ROAS trend */}
              <section className="cd-section">
                <h3><TrendingUp size={14} /> Daily spend & pixel ROAS</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={data!.daily} margin={{ left: -8, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid vertical={false} stroke="rgba(0,0,0,.06)" />
                    <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 10, fill: "#9a8b73" }} axisLine={false} tickLine={false} minTickGap={20} />
                    <YAxis yAxisId="spend" tick={{ fontSize: 10, fill: "#9a8b73" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <YAxis yAxisId="roas" orientation="right" tick={{ fontSize: 10, fill: "#9a8b73" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}x`} />
                    <Tooltip content={<Tip rows={undefined} />} cursor={{ fill: "rgba(0,0,0,.03)" }}
                      formatter={(val: any, name: string) => name === "Spend" ? aed(val) : `${val}x`} />
                    <Bar yAxisId="spend" dataKey="spend" name="Spend" fill={color} fillOpacity={0.25} radius={[3, 3, 0, 0]} barSize={14} />
                    <Line yAxisId="roas" type="monotone" dataKey="pixel_roas" name="ROAS" stroke={color} strokeWidth={2.5} dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
                <p className="cd-note"><Info size={11} /> ROAS is pixel (platform-reported). Settled ROAS isn't available per campaign — see the store card for money that actually landed.</p>
              </section>

              {/* #2 funnel drop-off */}
              <section className="cd-section">
                <h3><Filter size={14} /> Funnel drop-off</h3>
                <FunnelViz f={t.funnel} />
              </section>

              {/* per-day table */}
              <section className="cd-section">
                <h3>Day by day</h3>
                <div className="cd-table-wrap">
                  <table>
                    <thead><tr><th>Date</th><th className="num">Spend</th><th className="num">Clicks</th><th className="num">Conv.</th><th className="num">ROAS</th><th className="num">CPC</th></tr></thead>
                    <tbody>
                      {[...data!.daily].reverse().map((d) => (
                        <tr key={d.date}>
                          <td>{dayLabel(d.date)}</td>
                          <td className="num mono">{aed(d.spend)}</td>
                          <td className="num mono">{num(d.clicks)}</td>
                          <td className="num mono">{num(Math.round(d.conversions))}</td>
                          <td className="num mono">{roas(d.pixel_roas)}</td>
                          <td className="num mono">{d.cost_per_click != null ? aed2(d.cost_per_click) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/* ── #3 platform/campaign efficiency scatter — spend vs ROAS, bubble=conv ── */
export function CampaignScatter({ campaigns }: {
  campaigns: { campaign_id: string; campaign_name: string; platform: string; spend: number; conversions: number; pixel_roas: number | null }[];
}) {
  const points = campaigns
    .filter((c) => c.spend > 0 && c.pixel_roas != null)
    .map((c) => ({ x: c.spend, y: c.pixel_roas as number, z: Math.max(c.conversions, 1), name: c.campaign_name, platform: c.platform }));
  if (points.length === 0) return null;

  return (
    <div className="scatter-card">
      <div className="scatter-head">
        <h3>Spend vs ROAS efficiency</h3>
        <span>bubble size = conversions · top-left is best (low spend, high return)</span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ left: 4, right: 12, top: 12, bottom: 20 }}>
          <CartesianGrid stroke="rgba(0,0,0,.06)" />
          <XAxis type="number" dataKey="x" name="Spend" tick={{ fontSize: 10, fill: "#9a8b73" }} axisLine={false} tickLine={false}
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} label={{ value: "Spend (AED)", position: "insideBottom", offset: -10, fontSize: 11, fill: "#9a8b73" }} />
          <YAxis type="number" dataKey="y" name="ROAS" tick={{ fontSize: 10, fill: "#9a8b73" }} axisLine={false} tickLine={false}
            tickFormatter={(v) => `${v}x`} label={{ value: "Pixel ROAS", angle: -90, position: "insideLeft", fontSize: 11, fill: "#9a8b73" }} />
          <ZAxis type="number" dataKey="z" range={[60, 600]} name="Conversions" />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }: any) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload;
            return (
              <div className="cd-tip">
                <div className="cd-tip-label">{p.name}</div>
                <div className="cd-tip-row"><span style={{ background: PLATFORM_COLOR[p.platform] }} />Spend: <b>{aed(p.x)}</b></div>
                <div className="cd-tip-row">ROAS: <b>{p.y.toFixed(2)}x</b></div>
                <div className="cd-tip-row">Conversions: <b>{num(Math.round(p.z))}</b></div>
              </div>
            );
          }} />
          <Scatter data={points}>
            {points.map((p, i) => <Cell key={i} fill={PLATFORM_COLOR[p.platform] ?? "#888"} fillOpacity={0.55} stroke={PLATFORM_COLOR[p.platform] ?? "#888"} />)}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

const DRAWER_CSS = `
  .cd-overlay { position: fixed; inset: 0; background: rgba(31,27,22,.5); backdrop-filter: blur(2px); z-index: 70; display: flex; justify-content: flex-end; }
  .cd-drawer { position: relative; background: var(--card, #fff); width: 100%; max-width: 720px; height: 100%; overflow-y: auto; box-shadow: -16px 0 50px rgba(0,0,0,.25); }
  .cd-drawer * { box-sizing: border-box; }
  .cd-flare { position: absolute; top: 0; left: 0; right: 0; height: 120px; pointer-events: none; }
  .cd-loading { display: flex; align-items: center; justify-content: center; gap: 10px; height: 100%; color: var(--muted); position: relative; }
  .spin { animation: cdspin 1s linear infinite; } @keyframes cdspin { to { transform: rotate(360deg); } }
  .mono { font-variant-numeric: tabular-nums; } .num { text-align: right; }

  .cd-drawer header { position: relative; display: flex; justify-content: space-between; align-items: flex-start; padding: 22px 24px 16px; border-bottom: 1px solid var(--line); }
  .cd-plat { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; }
  .cd-plat i { width: 9px; height: 9px; border-radius: 50%; }
  .cd-status { font-size: 9.5px; font-weight: 600; padding: 2px 7px; border-radius: 5px; background: rgba(0,0,0,.06); color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin-left: 4px; }
  .cd-status.active { background: rgba(47,143,91,.12); color: #2f8f5b; }
  .cd-status.paused { background: rgba(217,131,36,.12); color: #b56a15; }
  .cd-drawer header h2 { font-size: 19px; margin: 8px 0 4px; line-height: 1.25; }
  .cd-sub { font-size: 11.5px; color: var(--muted); }
  .cd-close-btn { border: 1px solid var(--line); background: var(--card); border-radius: 9px; padding: 7px; cursor: pointer; color: var(--muted); display: flex; }
  .cd-close-btn:hover { border-color: var(--gold); color: var(--gold-deep); }

  .cd-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--line); border-bottom: 1px solid var(--line); }
  .cd-kpis > div { background: var(--card); padding: 12px 16px; display: flex; flex-direction: column; gap: 3px; }
  .cd-kpis span { font-size: 10.5px; color: var(--muted); } .cd-kpis span em { font-style: normal; opacity: .7; font-size: 9px; text-transform: uppercase; }
  .cd-kpis b { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }

  .cd-section { padding: 18px 24px; border-bottom: 1px solid var(--line); }
  .cd-section h3 { display: flex; align-items: center; gap: 7px; font-size: 13px; margin: 0 0 14px; }
  .cd-note { display: flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--muted); margin: 10px 0 0; }
  .cd-quiet { font-size: 12px; color: var(--muted); }

  .funnel-viz { display: flex; flex-direction: column; gap: 12px; }
  .fv-stage { display: flex; flex-direction: column; gap: 4px; }
  .fv-meta { display: flex; justify-content: space-between; font-size: 12px; }
  .fv-label { color: var(--ink); font-weight: 500; } .fv-val { font-variant-numeric: tabular-nums; color: var(--muted); }
  .fv-bar-track { height: 22px; background: rgba(0,0,0,.04); border-radius: 6px; overflow: hidden; }
  .fv-bar { height: 100%; background: linear-gradient(90deg, #6b8caf, #8aa9c8); border-radius: 6px; transition: width .5s ease; }
  .fv-bar.leak { background: linear-gradient(90deg, #c0392b, #d9694f); }
  .fv-drop { font-size: 10.5px; color: var(--muted); display: inline-flex; align-items: center; gap: 4px; }
  .fv-drop.bad { color: #c0392b; font-weight: 600; }

  .cd-table-wrap { overflow-x: auto; }
  .cd-table-wrap table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .cd-table-wrap th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--line); }
  .cd-table-wrap td { padding: 7px 8px; border-bottom: 1px solid var(--line); }

  .cd-tip { background: #211D18; color: #F7F2E8; border-radius: 9px; padding: 8px 11px; font-size: 11.5px; box-shadow: 0 6px 20px rgba(0,0,0,.28); }
  .cd-tip-label { font-weight: 600; margin-bottom: 4px; max-width: 220px; }
  .cd-tip-row { display: flex; align-items: center; gap: 6px; } .cd-tip-row span { width: 8px; height: 8px; border-radius: 2px; }

  .scatter-card { border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; background: var(--card); }
  .scatter-head { margin-bottom: 8px; }
  .scatter-head h3 { font-size: 14px; margin: 0; } .scatter-head span { font-size: 11.5px; color: var(--muted); }
`;
