"use client";

/* Orders analytics — the top of the Orders page.
 *
 *   KPI row        orders, sales, average order, ad spend → sales ROAS, each
 *                  against the period before
 *   Sales overview daily sales stacked by website, orders and ad spend beside
 *   Websites       one card per storefront: Shopify's own session funnel
 *                  (visits → cart → checkout → purchase), where visits come
 *                  from, and the ads driving it per platform
 *   Channels       every ad platform's connection state — a channel with no
 *                  credentials says so and stays out of the numbers
 *
 * Data: GET /api/orders/analytics (lib/orders/orders-analytics.ts). Sales use
 * the one sale rule; ad purchases are what each platform reports and are never
 * added to sales. */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CircleDashed, Loader2, PlugZap, RefreshCw } from "lucide-react";
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { OrdersAnalytics, SkuRow, TimeOfDay } from "@/lib/orders/orders-analytics";
import { Card, Eyebrow, Seg, compact, fmt } from "@/components/finance/dashboard-v2/overview/kit";
import { ui } from "@/components/finance/dashboard-v2/overview/ui";
import { STORE_COLOR, shortDate } from "@/components/finance/dashboard-v2/types";
import { SiteCard, type SiteWithFunnel } from "./site-card";
import { TimeOfDayCard, TopSkusCard } from "./sales-insights";

type Range = "7d" | "30d" | "mtd" | "90d";
type Channel = { platform: string; label: string; status: "connected" | "error" | "not_connected"; message: string; lastSyncAt: string | null };
export type AnalyticsResponse = Omit<OrdersAnalytics, "sites"> & { sites: SiteWithFunnel[]; channels: Channel[]; topSkus: SkuRow[]; timeOfDay: TimeOfDay };

const RANGES: [Range, string][] = [["7d", "7 days"], ["30d", "30 days"], ["mtd", "This month"], ["90d", "90 days"]];

export function OrdersAnalyticsPanel() {
  const [range, setRange] = useState<Range>("30d");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    fetch(`/api/orders/analytics?range=${range}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j as AnalyticsResponse; })
      .then((j) => { if (live) setData(j); })
      .catch((e) => { if (live) setError((e as Error).message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [range, nonce]);

  return (
    <section className="mb-8 space-y-5" aria-label="Orders analytics">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Seg value={range} options={RANGES} onChange={setRange} />
        <div className="flex items-center gap-3">
          {data && <span className={ui.hint}>{shortDate(data.range.fromDay)} – {shortDate(data.range.toDay)} · vs {shortDate(data.range.prevFromDay)} – {shortDate(data.range.prevToDay)}</span>}
          <button className={ui.iconButton} onClick={() => setNonce((n) => n + 1)} disabled={loading} aria-label="Refresh analytics">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
        </div>
      </div>

      {error && <Card><p className="text-[13px] text-[#A6472F]">Couldn&apos;t load analytics: {error}</p></Card>}
      {!data && !error && <Card><p className="inline-flex items-center gap-2 text-[13px] text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading sales, funnels and ads…</p></Card>}

      {data && (
        <>
          <KpiRow data={data} />
          <SalesOverview data={data} />
          <TimeOfDayCard data={data.timeOfDay} />
          <TopSkusCard rows={data.topSkus} />
          <div className="grid gap-5 xl:grid-cols-2">
            {data.sites.map((s, i) => <SiteCard key={s.code} site={s} delay={0.05 * i} />)}
          </div>
          <Channels channels={data.channels} />
        </>
      )}
    </section>
  );
}

/* ── KPI row ─────────────────────────────────────────────────────────────── */

function delta(cur: number, prev: number): number | null {
  return prev > 0 ? (cur - prev) / prev : null;
}

function DeltaBadge({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value == null || !Number.isFinite(value)) return <span className={ui.hint}>new</span>;
  const good = invert ? value < 0 : value >= 0;
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[11.5px] font-medium tabular-nums ${good ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
      {value >= 0 ? "+" : ""}{(value * 100).toFixed(Math.abs(value) < 0.1 ? 1 : 0)}%
    </span>
  );
}

/** The reference's pill row, carrying the period's own daily figures: 16
 *  pills, each one a stretch of days, height = that stretch's value. */
function Spark({ values }: { values: number[] }) {
  const n = 16;
  const size = Math.max(Math.ceil(values.length / n), 1);
  const buckets: number[] = [];
  for (let i = 0; i < values.length; i += size) buckets.push(values.slice(i, i + size).reduce((a, b) => a + b, 0) / Math.min(size, values.length - i));
  const max = Math.max(...buckets, 0);
  return (
    <div className="mt-4 flex h-9 items-end gap-[3px]" aria-hidden>
      {buckets.map((v, i) => (
        <motion.span
          key={i}
          initial={{ height: 4 }}
          animate={{ height: max > 0 ? `${Math.max((v / max) * 100, 12)}%` : 4 }}
          transition={{ delay: 0.02 * i, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className={`flex-1 rounded-full ${i === buckets.length - 1 ? "bg-[#2563EB]" : "bg-[#2563EB]/35"}`}
        />
      ))}
    </div>
  );
}

function KpiRow({ data }: { data: AnalyticsResponse }) {
  const t = data.totals;
  const d = data.daily;
  const cards = [
    { label: "Orders", series: d.map((x) => x.orders), value: fmt(t.orders), exact: `${fmt(t.orders)} counted orders`, cur: t.orders, prev: t.prev.orders, foot: `${fmt(t.cancelled)} cancelled` },
    { label: "Sales", series: d.map((x) => x.revenue), value: `AED ${compact(t.revenue)}`, exact: `AED ${fmt(t.revenue, 2)}`, cur: t.revenue, prev: t.prev.revenue, foot: `last period AED ${compact(t.prev.revenue)}` },
    { label: "Average order", series: d.map((x) => (x.orders ? x.revenue / x.orders : 0)), value: `AED ${fmt(t.aov)}`, exact: `AED ${fmt(t.aov, 2)}`, cur: t.aov, prev: t.prev.aov, foot: `last period AED ${fmt(t.prev.aov)}` },
    {
      label: "Ad spend", series: d.map((x) => x.adSpend), value: `AED ${compact(t.adSpend)}`, exact: `AED ${fmt(t.adSpend, 2)}`, cur: t.adSpend, prev: t.prev.adSpend, invert: true,
      foot: t.salesRoas != null ? `${t.salesRoas.toFixed(1)}× sales per AED of ads` : "no ad spend recorded",
    },
  ];
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c, i) => (
        <Card key={c.label} delay={0.04 * i}>
          <Eyebrow>{c.label}</Eyebrow>
          <div className="mt-3 flex items-baseline gap-2.5">
            <span className={ui.number} title={c.exact}>{c.value}</span>
            <DeltaBadge value={delta(c.cur, c.prev)} invert={c.invert} />
          </div>
          <Spark values={c.series} />
          <p className={`mt-3 ${ui.hint}`}>{c.foot}</p>
        </Card>
      ))}
    </div>
  );
}

/* ── Sales overview chart ─────────────────────────────────────────────────── */

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color?: string; dataKey?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl bg-white px-3.5 py-2.5 text-[12px] shadow-[0_12px_32px_-12px_rgba(15,23,42,0.35)] ring-1 ring-slate-100">
      <p className="mb-1 font-medium text-slate-900">{label ? shortDate(label) : ""}</p>
      {payload.filter((p) => Number(p.value) > 0).map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-slate-600">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <b className="font-medium tabular-nums text-slate-900">{p.dataKey === "orders" ? fmt(p.value) : `AED ${fmt(p.value)}`}</b>
        </p>
      ))}
    </div>
  );
}

function SalesOverview({ data }: { data: AnalyticsResponse }) {
  const [metric, setMetric] = useState<"sales" | "orders">("sales");
  const t = data.totals;
  const sites = data.sites.filter((s) => s.revenue > 0 || s.orders > 0);
  const summary = [
    { label: "Orders", value: fmt(t.orders), d: delta(t.orders, t.prev.orders) },
    { label: "Sales", value: `AED ${compact(t.revenue)}`, d: delta(t.revenue, t.prev.revenue) },
    { label: "Cancelled", value: fmt(t.cancelled), d: delta(t.cancelled, t.prev.cancelled), invert: true },
    { label: "Avg. order", value: `AED ${fmt(t.aov)}`, d: delta(t.aov, t.prev.aov) },
  ];
  return (
    <Card delay={0.1}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>Sales overview</Eyebrow>
          <p className={`mt-1 ${ui.caption}`}>Daily sales by website, with orders and ad spend</p>
        </div>
        <Seg value={metric} options={[["sales", "Sales"], ["orders", "Orders"]]} onChange={setMetric} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {summary.map((s) => (
          <div key={s.label} className="rounded-2xl bg-slate-50 px-4 py-3">
            <p className={ui.hint}>{s.label}</p>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-[17px] font-medium tabular-nums text-slate-900">{s.value}</span>
              <DeltaBadge value={s.d} invert={s.invert} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data.daily} margin={{ left: -4, right: 8, top: 8, bottom: 0 }}>
            <defs>
              {sites.map((s) => (
                <linearGradient key={s.code} id={`oa-${s.code}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={STORE_COLOR[s.code]} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={STORE_COLOR[s.code]} stopOpacity={0.04} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(15,23,42,.06)" />
            <XAxis dataKey="day" tickFormatter={shortDate} tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis yAxisId="money" hide={metric !== "sales"} tickFormatter={(v) => compact(v)} tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} width={44} />
            <YAxis yAxisId="count" orientation="right" hide={metric !== "orders"} tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} width={32} />
            <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(37,99,235,.05)" }} />
            {/* Recharts 2 finds series among its direct children only — a
                fragment would hide them, so the series go in as an array. */}
            {metric === "sales"
              ? [
                  ...sites.map((s) => (
                    <Area key={s.code} yAxisId="money" type="monotone" dataKey={s.code} name={s.label} stackId="sales"
                      stroke={STORE_COLOR[s.code]} strokeWidth={2} fill={`url(#oa-${s.code})`} />
                  )),
                  <Line key="adSpend" yAxisId="money" type="monotone" dataKey="adSpend" name="Ad spend" stroke="#0F1B3D" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />,
                ]
              : <Bar yAxisId="count" dataKey="orders" name="Orders" fill="#2563EB" radius={[8, 8, 8, 8]} maxBarSize={18} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {sites.map((s) => (
          <span key={s.code} className="inline-flex items-center gap-1.5 text-[12px] text-slate-500">
            <span className="h-2 w-2 rounded-full" style={{ background: STORE_COLOR[s.code] }} />{s.label}
          </span>
        ))}
        {metric === "sales" && <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500"><span className="h-0 w-3 border-t-2 border-dashed border-[#0F1B3D]" />Ad spend</span>}
      </div>
    </Card>
  );
}

/* ── Ad channels ─────────────────────────────────────────────────────────── */

function Channels({ channels }: { channels: Channel[] }) {
  return (
    <Card delay={0.2}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Ad channels</Eyebrow>
        <span className={ui.hint}>A channel shows in the funnels above once its credentials are added and it syncs.</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {channels.map((c) => (
          <div key={c.platform} className="rounded-2xl bg-slate-50 px-4 py-3" title={c.message || undefined}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[14px] font-medium text-slate-900">{c.label}</span>
              {c.status === "connected" ? (
                <span className="inline-flex items-center gap-1 text-[12px] text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Syncing</span>
              ) : c.status === "error" ? (
                <span className="inline-flex items-center gap-1 text-[12px] text-amber-700"><AlertTriangle size={12} />Needs attention</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[12px] text-slate-400"><CircleDashed size={12} />Not connected</span>
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-slate-500">
              {c.status === "not_connected" ? <><PlugZap size={11} className="mr-1 inline" />{c.message}</> : c.status === "error" ? friendly(c.message) : "Spend, clicks and purchases update every sync."}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Platform errors are long JSON; keep the part a person can act on. */
function friendly(message: string): string {
  if (/Session has expired|OAuthException.*190/.test(message)) {
    const acct = /(act_\d+)/.exec(message)?.[1];
    return `The access token${acct ? ` for ${acct}` : ""} expired — generate a new one; data for that account stopped at the expiry date.`;
  }
  if (/advertiser_id: Not a valid integer/.test(message)) return "TIKTOK_ADVERTISER_ID isn't a valid advertiser id — copy the numeric id from TikTok Ads Manager.";
  return message.slice(0, 180);
}
