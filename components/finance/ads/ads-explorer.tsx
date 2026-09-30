"use client";

/* Ads — the Marketing page. Meta, read live (lib/integrations/ads/meta-explorer.ts):
 *
 *   KPI row            spend, pixel purchases, purchase value, ROAS, CPA, CTR — with daily sparklines
 *   Performance by day spend against purchase value, ROAS beside it
 *   Peak hours         when ads get clicks and purchases (Dubai time)
 *   Who responds       age × gender, women mirrored against men
 *   AI analyst         a stored review of the whole account, with history
 *   Best creatives     the ads that convert, with their creative
 *   Campaigns          campaign → ad set → ad, running or all with delivery
 *   Tracking           pixels (last fired) and the tags each site loads
 *
 * Every purchase figure here is what Meta's pixel attributes to ads; the
 * store's real sales live on the Orders page. */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ExplorerData } from "@/lib/integrations/ads/meta-explorer";
import type { PixelStatus, SiteTags } from "@/lib/integrations/ads/tracking-check";
import { Card, Eyebrow, Seg, compact, fmt } from "@/components/finance/dashboard-v2/overview/kit";
import { ui } from "@/components/finance/dashboard-v2/overview/ui";
import { shortDate } from "@/components/finance/dashboard-v2/types";
import { PeakBars } from "@/components/finance/charts/peak-bars";
import { AudienceCard } from "./audience-card";
import { AnalystCard } from "./analyst-card";
import { CreativesCard } from "./creatives-card";
import { CampaignTree } from "./campaign-tree";
import { TrackingCard } from "./tracking-card";

type Range = "7d" | "14d" | "30d" | "mtd";
export type ExplorerResponse = ExplorerData & { rangeKey: Range; tracking: { pixels: PixelStatus[]; sites: SiteTags[] } };

const RANGES: [Range, string][] = [["7d", "7 days"], ["14d", "14 days"], ["30d", "30 days"], ["mtd", "This month"]];

export function AdsExplorer() {
  const [range, setRange] = useState<Range>("7d");
  const [data, setData] = useState<ExplorerResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    fetch(`/api/ads/explorer?range=${range}${nonce ? "&fresh=1" : ""}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j as ExplorerResponse; })
      .then((j) => { if (live) setData(j); })
      .catch((e) => { if (live) setError((e as Error).message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [range, nonce]);

  const broken = data?.accounts.filter((a) => a.error) ?? [];

  return (
    <section className="space-y-5" aria-label="Ads performance">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Seg value={range} options={RANGES} onChange={setRange} />
        <div className="flex items-center gap-3">
          {data && <span className={ui.hint}>{shortDate(data.range.from)} – {shortDate(data.range.to)} · Meta · {data.accounts.filter((a) => !a.error).length} ad account{data.accounts.length === 1 ? "" : "s"} · updated {new Date(data.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>}
          <button className={ui.iconButton} onClick={() => setNonce((n) => n + 1)} disabled={loading} aria-label="Refresh from Meta">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
        </div>
      </div>

      {broken.map((a) => (
        <div key={a.id} className="flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span><b className="font-medium">{a.store} ad account {a.id}</b> isn&apos;t readable: {/Session has expired|190/.test(a.error ?? "") ? "its access token expired — generate a new one to see its campaigns." : a.error}</span>
        </div>
      ))}
      {error && <Card><p className="text-[13px] text-rose-700">Couldn&apos;t load ads: {error}</p></Card>}
      {!data && !error && (
        <Card><p className="inline-flex items-center gap-2 text-[13px] text-slate-500"><Loader2 size={14} className="animate-spin" /> Reading campaigns, ad sets and ads from Meta… the first load takes ~20 seconds.</p></Card>
      )}

      {data && (
        <motion.div key={data.range.from} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
          <KpiRow data={data} />
          <DailyCard data={data} />
          <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
            <PeakHoursCard data={data} />
            <AudienceCard rows={data.demographics} />
          </div>
          <AnalystCard range={range} />
          <CreativesCard ads={data.ads} />
          <CampaignTree data={data} />
          <TrackingCard tracking={data.tracking} />
        </motion.div>
      )}
    </section>
  );
}

/* ── KPIs ──────────────────────────────────────────────────────────────── */

function Spark({ values }: { values: number[] }) {
  const max = Math.max(...values, 0);
  return (
    <div className="mt-4 flex h-8 items-end justify-between gap-[3px]" aria-hidden>
      {values.map((v, i) => (
        <motion.span key={i} initial={{ height: 3 }} animate={{ height: max > 0 ? `${Math.max((v / max) * 100, 10)}%` : 3 }}
          transition={{ delay: 0.02 * i, duration: 0.4 }}
          className={`w-full max-w-[12px] flex-1 rounded-full ${i === values.length - 1 ? "bg-indigo-600" : "bg-indigo-600/30"}`} />
      ))}
    </div>
  );
}

function KpiRow({ data }: { data: ExplorerResponse }) {
  const d = data.daily;
  const sum = (k: "spend" | "purchases" | "value" | "linkClicks" | "impressions" | "addToCart") => d.reduce((s, x) => s + x[k], 0);
  const spend = sum("spend"), purchases = sum("purchases"), value = sum("value"), clicks = sum("linkClicks"), impressions = sum("impressions"), carts = sum("addToCart");
  const cards = [
    { label: "Spend", value: `AED ${compact(spend)}`, exact: `AED ${fmt(spend, 2)}`, series: d.map((x) => x.spend), foot: `${fmt(data.ads.filter((a) => a.status === "ACTIVE").length)} ads running` },
    { label: "Purchases", value: fmt(purchases), series: d.map((x) => x.purchases), foot: `${fmt(carts)} add to carts` },
    { label: "Purchase value", value: `AED ${compact(value)}`, exact: `AED ${fmt(value, 2)}`, series: d.map((x) => x.value), foot: "as the pixel attributes it" },
    { label: "ROAS", value: spend ? `${(value / spend).toFixed(2)}×` : "—", series: d.map((x) => x.roas ?? 0), foot: "purchase value ÷ spend" },
    { label: "Cost per purchase", value: purchases ? `AED ${fmt(spend / purchases)}` : "—", series: d.map((x) => x.cpa ?? 0), foot: purchases ? `CPC AED ${(spend / Math.max(clicks, 1)).toFixed(2)}` : "" },
    { label: "Click-through", value: impressions ? `${((clicks / impressions) * 100).toFixed(2)}%` : "—", series: d.map((x) => x.ctr ?? 0), foot: `${compact(clicks)} link clicks` },
  ];
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {cards.map((c, i) => (
        <Card key={c.label} delay={0.03 * i}>
          <Eyebrow>{c.label}</Eyebrow>
          <p className={`mt-3 ${ui.number}`} title={c.exact}>{c.value}</p>
          <Spark values={c.series} />
          <p className={`mt-3 ${ui.hint}`}>{c.foot}</p>
        </Card>
      ))}
    </div>
  );
}

/* ── performance by day ────────────────────────────────────────────────── */

function DayTip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number; color?: string; name: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl bg-white px-3.5 py-2.5 text-[12px] shadow-[0_12px_32px_-12px_rgba(15,23,42,0.35)] ring-1 ring-slate-100">
      <p className="mb-1 font-medium text-slate-900">{label ? shortDate(label) : ""}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-slate-600">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}:{" "}
          <b className="font-medium tabular-nums text-slate-900">{p.dataKey === "roas" ? `${Number(p.value).toFixed(2)}×` : p.dataKey === "purchases" ? fmt(p.value) : `AED ${fmt(p.value)}`}</b>
        </p>
      ))}
    </div>
  );
}

function DailyCard({ data }: { data: ExplorerResponse }) {
  const [metric, setMetric] = useState<"money" | "roas">("money");
  const best = [...data.daily].filter((d) => d.spend > 0).sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))[0];
  return (
    <Card delay={0.1}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>Performance by day</Eyebrow>
          <p className={`mt-1 ${ui.caption}`}>
            Spend against the purchase value it brought{best ? <> · best day <b className="font-medium text-slate-900">{shortDate(best.date)}</b> at {best.roas?.toFixed(2)}×</> : null}
          </p>
        </div>
        <Seg value={metric} options={[["money", "Spend & value"], ["roas", "ROAS"]]} onChange={setMetric} />
      </div>
      <div className="mt-5 h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data.daily} margin={{ left: -4, right: 8, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="ads-value" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4F46E5" stopOpacity={0.35} /><stop offset="100%" stopColor="#4F46E5" stopOpacity={0.02} /></linearGradient>
              <linearGradient id="ads-spend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#94A3B8" stopOpacity={0.35} /><stop offset="100%" stopColor="#94A3B8" stopOpacity={0.02} /></linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(15,23,42,.06)" />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis yAxisId="money" hide={metric !== "money"} tickFormatter={(v) => compact(v)} tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} width={44} />
            <YAxis yAxisId="roas" hide={metric !== "roas"} tickFormatter={(v) => `${v}×`} tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} width={36} />
            <Tooltip content={<DayTip />} cursor={{ stroke: "rgba(79,70,229,.25)", strokeWidth: 1 }} />
            {/* Recharts 2 only sees direct children — series go in as an array, not a fragment. */}
            {metric === "money"
              ? [
                  <Area key="value" yAxisId="money" type="monotone" dataKey="value" name="Purchase value" stroke="#4F46E5" strokeWidth={2.2} fill="url(#ads-value)" />,
                  <Area key="spend" yAxisId="money" type="monotone" dataKey="spend" name="Spend" stroke="#94A3B8" strokeWidth={2} fill="url(#ads-spend)" />,
                ]
              : <Line yAxisId="roas" type="monotone" dataKey="roas" name="ROAS" stroke="#4F46E5" strokeWidth={2.4} dot={{ r: 3, fill: "#4F46E5" }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

/* ── peak hours ────────────────────────────────────────────────────────── */

function PeakHoursCard({ data }: { data: ExplorerResponse }) {
  const [metric, setMetric] = useState<"purchases" | "linkClicks" | "spend">("purchases");
  const values = data.hourly.map((h) => h[metric]);
  // Best 3 consecutive hours, wrapping midnight.
  let best = 0; let bestSum = -1;
  for (let s = 0; s < 24; s++) {
    const sum = values[s] + values[(s + 1) % 24] + values[(s + 2) % 24];
    if (sum > bestSum) { bestSum = sum; best = s; }
  }
  const total = values.reduce((a, b) => a + b, 0);
  const label = `${String(best).padStart(2, "0")}:00–${String((best + 3) % 24).padStart(2, "0")}:00`;
  const unit = metric === "purchases" ? "purchases" : metric === "linkClicks" ? "clicks" : "of spend";
  return (
    <Card delay={0.12}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>Peak hours</Eyebrow>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className={ui.number}>{label}</span>
            {total > 0 && <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11.5px] font-medium text-indigo-700">{Math.round((bestSum / total) * 100)}% {unit}</span>}
          </div>
          <p className={`mt-1 ${ui.caption}`}>Dubai time, summed over the period</p>
        </div>
        <Seg value={metric} options={[["purchases", "Purchases"], ["linkClicks", "Clicks"], ["spend", "Spend"]]} onChange={setMetric} />
      </div>
      <div className="mt-6 pb-5">
        <PeakBars
          values={values}
          labels={data.hourly.map((h) => `${String(h.hour).padStart(2, "0")}:00`)}
          highlight={[best, (best + 2) % 24]}
          peakLabel={`Peak ${label}`}
          tickEvery={3}
          format={(v) => (metric === "spend" ? `AED ${fmt(v)}` : `${fmt(v)} ${metric === "purchases" ? "purchases" : "clicks"}`)}
        />
      </div>
    </Card>
  );
}
