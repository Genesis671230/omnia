"use client";

/* Top products (showcase), ads driving revenue (creatives), courier lanes
 * (road: OnTrack in the UAE · air: SMSA to KSA and the Gulf). */

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ChevronDown, ChevronUp, ImageOff, Loader2, Plane, Truck } from "lucide-react";
import { useState } from "react";
import type { LaneStats } from "@/lib/dashboard/command-center";
import type { SkuRow } from "@/lib/orders/orders-analytics";
import { compact, fmt, pct } from "../overview/kit";
import { DARK_CARD } from "./funnel";

const WHITE_CARD = "rounded-[30px] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_44px_-26px_rgba(15,23,42,0.22)]";

function Thumb({ src, alt, className }: { src: string | null; alt: string; className: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <div className={`${className} grid place-items-center bg-white/10 text-white/40`}><ImageOff size={18} /></div>;
  // eslint-disable-next-line @next/next/no-img-element -- remote shop / Meta CDN images
  return <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} className={`${className} object-cover`} />;
}

/* ── top products ──────────────────────────────────────────────────────── */

const TREND: Record<SkuRow["trend"], { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-sky-400/20 text-sky-100" },
  rising: { label: "▲ Rising", cls: "bg-emerald-400/20 text-emerald-100" },
  steady: { label: "Steady", cls: "bg-white/10 text-white/80" },
  falling: { label: "▼ Falling", cls: "bg-rose-400/20 text-rose-100" },
};

export function TopProducts({ skus, label }: { skus: SkuRow[] | null; label: string }) {
  const [i, setI] = useState(0);
  const list = (skus ?? []).slice(0, 5);
  const cur = list[i % Math.max(list.length, 1)];
  return (
    <div className={`${DARK_CARD} flex h-full min-h-[380px] flex-col bg-[#1B1640] px-6 pb-5 pt-6`}>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_100%_0%,rgba(91,61,245,0.6),transparent_60%),radial-gradient(70%_60%_at_0%_100%,rgba(242,112,94,0.3),transparent_60%)]" />
      <div className="relative">
        <h3 className="text-[22px] font-light tracking-[-0.02em]">Top {list.length || 5} products</h3>
        <p className="mt-1 text-[12.5px] text-white/50">By revenue · {label}</p>
      </div>
      {!skus ? (
        <div className="relative mt-8 flex items-center gap-2 text-[13px] text-white/50"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : !cur ? (
        <div className="relative mt-8 text-[13px] text-white/50">No product sales in this range.</div>
      ) : (
        <>
          <div className="relative mt-5 flex items-center gap-3 rounded-[24px] bg-white/[0.08] p-3 backdrop-blur-md">
            <AnimatePresence mode="wait">
              <motion.div key={cur.sku + i} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={{ duration: 0.35 }}
                className="flex min-w-0 flex-1 items-center gap-4">
                <Thumb src={cur.imageUrl} alt={cur.title} className="h-24 w-24 shrink-0 rounded-[18px]" />
                <div className="min-w-0">
                  <div className="text-[30px] font-light leading-none tabular-nums tracking-[-0.02em]">{fmt(cur.units)} <span className="text-[15px] text-white/60">sold</span></div>
                  <div className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug text-white/70" title={cur.title}>{cur.title}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                    <span className="rounded-full bg-white px-2 py-0.5 font-medium text-[#1B1640]">AED {compact(cur.revenue)}</span>
                    <span className={`rounded-full px-2 py-0.5 ${TREND[cur.trend].cls}`}>{TREND[cur.trend].label}</span>
                    {cur.stock != null && <span className="text-white/50">{fmt(cur.stock)} in stock</span>}
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
            <div className="flex flex-col gap-2">
              <button aria-label="Previous product" onClick={() => setI((x) => (x - 1 + list.length) % list.length)} className="grid h-9 w-9 place-items-center rounded-full bg-white text-[#1B1640]"><ChevronUp size={16} /></button>
              <button aria-label="Next product" onClick={() => setI((x) => (x + 1) % list.length)} className="grid h-9 w-9 place-items-center rounded-full bg-white text-[#1B1640]"><ChevronDown size={16} /></button>
            </div>
          </div>
          <div className="relative mt-auto flex gap-2 pt-5">
            {list.map((s, k) => (
              <button key={s.sku} onClick={() => setI(k)} title={`${s.title} · ${fmt(s.units)} sold`}
                className={`relative h-12 flex-1 overflow-hidden rounded-xl ring-2 transition ${k === i % list.length ? "ring-white" : "ring-transparent opacity-60 hover:opacity-100"}`}>
                <Thumb src={s.imageUrl} alt={s.title} className="h-full w-full" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── ads driving revenue ───────────────────────────────────────────────── */

export type TopAd = {
  id: string; name: string; status: string; campaign: string; store: string; image: string | null; type: string; title: string;
  spend: number; value: number; purchases: number; roas: number | null; ctr: number | null;
};

export function TopAds({ data, label }: { data: { ads: TopAd[]; totalValue?: number; error?: string } | null; label: string }) {
  const maxValue = Math.max(...(data?.ads ?? []).map((a) => a.value), 1);
  return (
    <div className={`${WHITE_CARD} px-6 pb-6 pt-6`}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-[22px] font-light tracking-[-0.02em] text-slate-900">Ads driving revenue</h3>
          <p className="mt-1 text-[12.5px] text-slate-500">Meta ads by purchase value the pixel attributes to them · {label}</p>
        </div>
        {data?.totalValue ? <span className="text-[12.5px] text-slate-500">All ads: AED {compact(data.totalValue)} attributed</span> : null}
      </div>
      {!data ? (
        <div className="mt-6 flex items-center gap-2 text-[13px] text-slate-500"><Loader2 size={14} className="animate-spin" /> Reading Meta (first load takes ~20 s)…</div>
      ) : data.error && !data.ads.length ? (
        <div className="mt-6 text-[13px] text-[#A6472F]">{data.error}</div>
      ) : !data.ads.length ? (
        <div className="mt-6 text-[13px] text-slate-500">No ad drove purchases in this range.</div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {data.ads.map((a, k) => (
            <motion.div key={a.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: k * 0.06 }}
              className="group overflow-hidden rounded-[22px] bg-slate-50">
              <div className="relative aspect-square overflow-hidden">
                <Thumb src={a.image} alt={a.name} className="h-full w-full transition duration-500 group-hover:scale-105" />
                <span className="absolute left-2 top-2 rounded-full bg-[#13111D]/80 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">#{k + 1}</span>
                {a.roas != null && <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-[#13111D]">{a.roas.toFixed(1)}× ROAS</span>}
              </div>
              <div className="px-3 pb-3 pt-2.5">
                <div className="truncate text-[13px] font-medium text-slate-900" title={a.name}>{a.name}</div>
                <div className="truncate text-[11px] text-slate-500" title={a.campaign}>{a.campaign}</div>
                <div className="mt-2 flex items-baseline justify-between text-[12px]">
                  <span className="text-[16px] font-light tabular-nums text-slate-900">AED {compact(a.value)}</span>
                  <span className="text-slate-500">{fmt(a.purchases)} buys</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <motion.div className="h-full rounded-full bg-gradient-to-r from-[#5B3DF5] to-[#F2705E]" initial={{ width: 0 }} animate={{ width: `${(a.value / maxValue) * 100}%` }} transition={{ duration: 0.9, delay: 0.2 + k * 0.05 }} />
                </div>
                <div className="mt-1 text-[11px] text-slate-400">Spend AED {compact(a.spend)}</div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── courier lanes ─────────────────────────────────────────────────────── */

const LANE = {
  road: { icon: Truck, color: "#F2705E", track: "rgba(242,112,94,0.25)", route: "Dubai warehouse → doorsteps across the UAE", sheet: "Local orders" },
  air: { icon: Plane, color: "#8B5CF6", track: "rgba(139,92,246,0.25)", route: "Dubai → KSA & the Gulf", sheet: "SMSA Orders" },
} as const;

function LaneRow({ s, share, delay }: { s: LaneStats; share: number; delay: number }) {
  const L = LANE[s.lane];
  const Icon = L.icon;
  const max = Math.max(...s.daily.map((d) => d.orders), 1);
  const perOrder = s.feesAed != null && s.feeOrders ? s.feesAed / s.feeOrders : null;
  return (
    <div className="rounded-[24px] bg-slate-50 p-5">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-2xl text-white" style={{ background: L.color }}><Icon size={20} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium text-slate-900">{s.courier} <span className="font-normal text-slate-500">· {s.lane === "road" ? "by road" : "by air"}</span></div>
          <div className="truncate text-[12px] text-slate-500">{L.route}{s.topDestinations.length > 1 ? ` (${s.topDestinations.map((d) => `${d.country} ${d.orders}`).join(" · ")})` : ""}</div>
        </div>
        <div className="text-right">
          <div className="text-[26px] font-light leading-none tabular-nums text-slate-900">{fmt(s.orders)}</div>
          <div className="text-[11.5px] text-slate-500">orders · {pct(share)}</div>
        </div>
      </div>

      {/* the lane: a vehicle travelling a dashed route */}
      <div className="relative mt-4 h-10">
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full" style={{ backgroundImage: `repeating-linear-gradient(90deg, ${L.track} 0 12px, transparent 12px 20px)` }} />
        {s.lane === "air" && <svg aria-hidden viewBox="0 0 100 20" preserveAspectRatio="none" className="absolute inset-0 h-full w-full"><path d="M0 18 Q50 -8 100 18" fill="none" stroke={L.track} strokeWidth={0.6} strokeDasharray="2 2" /></svg>}
        <motion.div className="absolute top-1/2 -translate-y-1/2" initial={{ left: "-4%" }} animate={{ left: ["-4%", "100%"], y: s.lane === "air" ? [0, -10, 0] : 0 }}
          transition={{ duration: s.lane === "air" ? 5 : 7, repeat: Infinity, ease: "easeInOut", delay }}>
          <div className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-md" style={{ color: L.color }}><Icon size={16} /></div>
        </motion.div>
      </div>

      {/* orders per day */}
      <div className="mt-2 flex h-14 items-end gap-[3px]" aria-label="Orders per day">
        {s.daily.map((d, k) => (
          <motion.div key={d.day} title={`${d.day}: ${d.orders} orders`} className="flex-1 rounded-t-[3px]"
            style={{ background: L.color, opacity: 0.35 + 0.65 * (d.orders / max) }}
            initial={{ height: 0 }} animate={{ height: `${Math.max((d.orders / max) * 100, d.orders ? 6 : 2)}%` }} transition={{ duration: 0.6, delay: k * 0.012 }} />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-[12px]">
        <div>
          <div className="text-slate-500">Sales shipped</div>
          <div className="mt-0.5 text-[15px] tabular-nums text-slate-900">AED {compact(s.salesAed)}</div>
        </div>
        <div>
          <div className="text-slate-500">Courier fees</div>
          {s.feesAed == null ? (
            <div className="mt-0.5 text-[12.5px] text-slate-400" title={s.lane === "air" ? "SMSA's invoices aren't uploaded anywhere yet" : "No OnTrack COD vouchers for these orders"}>
              {s.lane === "air" ? "SMSA invoices not uploaded" : "No vouchers yet"}
            </div>
          ) : (
            <div className="mt-0.5 text-[15px] tabular-nums text-slate-900" title={`From OnTrack COD vouchers covering ${s.feeOrders} orders`}>
              AED {compact(s.feesAed)} <span className="text-[11.5px] text-slate-500">≈ {perOrder?.toFixed(0)}/order · {s.feeOrders} vouchered</span>
            </div>
          )}
        </div>
        <div>
          <div className="text-slate-500">In dispatch sheet</div>
          {s.logged < 0 ? (
            <div className="mt-0.5 text-[12.5px] text-slate-400">Sheet unreadable</div>
          ) : (
            <div className={`mt-0.5 flex items-center gap-1 text-[15px] tabular-nums ${s.orders && s.logged / s.orders < 0.9 ? "text-[#B45309]" : "text-slate-900"}`}
              title={`"${L.sheet}" tab`}>
              {s.orders && s.logged / s.orders < 0.9 && <AlertTriangle size={13} />}{fmt(s.logged)} / {fmt(s.orders)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function CourierLanes({ lanes, label }: { lanes: LaneStats[] | null; label: string }) {
  const total = (lanes ?? []).reduce((n, l) => n + l.orders, 0);
  return (
    <div className={`${WHITE_CARD} h-full px-6 pb-6 pt-6`}>
      <h3 className="text-[22px] font-light tracking-[-0.02em] text-slate-900">On the road &amp; in the air</h3>
      <p className="mt-1 text-[12.5px] text-slate-500">Orders handed to each courier, their fees, and the dispatch sheet · {label}</p>
      {!lanes ? (
        <div className="mt-6 flex items-center gap-2 text-[13px] text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {lanes.map((s, k) => <LaneRow key={s.lane} s={s} share={total ? s.orders / total : 0} delay={k * 1.4} />)}
        </div>
      )}
    </div>
  );
}

/* ── ad clicks: what the money bought, step by step ────────────────────── */

export function AdClicks({ ads, label }: { ads: { spend: number; value: number; impressions: number; clicks: number; landingPageViews: number; addToCart: number; checkout: number; purchases: number } | null; label: string }) {
  const per = (a: number, b: number) => (b ? a / b : null);
  const tiles = ads ? [
    { k: "Spend", v: `AED ${compact(ads.spend)}`, s: `${compact(ads.impressions)} impressions` },
    { k: "Clicks", v: compact(ads.clicks), s: `CTR ${((per(ads.clicks, ads.impressions) ?? 0) * 100).toFixed(2)}%` },
    { k: "Cost per click", v: per(ads.spend, ads.clicks) == null ? "—" : `AED ${per(ads.spend, ads.clicks)!.toFixed(2)}`, s: `CPM AED ${((per(ads.spend, ads.impressions) ?? 0) * 1000).toFixed(0)}` },
    { k: "Landing views", v: compact(ads.landingPageViews), s: `${pct(per(ads.landingPageViews, ads.clicks) ?? 0)} of clicks land` },
    { k: "Add to cart", v: compact(ads.addToCart), s: `${pct(per(ads.addToCart, ads.landingPageViews) ?? 0)} of landings` },
    { k: "Checkouts", v: compact(ads.checkout), s: `${pct(per(ads.checkout, ads.addToCart) ?? 0)} of carts` },
    { k: "Purchases", v: fmt(ads.purchases), s: `CPA AED ${per(ads.spend, ads.purchases)?.toFixed(0) ?? "—"}` },
    { k: "Pixel value", v: `AED ${compact(ads.value)}`, s: `ROAS ${per(ads.value, ads.spend)?.toFixed(2) ?? "—"}×` },
  ] : [];
  return (
    <div className={`${WHITE_CARD} h-full px-6 pb-6 pt-6`}>
      <h3 className="text-[22px] font-light tracking-[-0.02em] text-slate-900">Clicks to checkout</h3>
      <p className="mt-1 text-[12.5px] text-slate-500">Every Meta ad step, what it cost and how many moved on · {label}</p>
      {!ads ? (
        <div className="mt-6 flex items-center gap-2 text-[13px] text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {tiles.map((t, i) => (
            <motion.div key={t.k} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="rounded-2xl bg-slate-50 px-4 py-3">
              <div className="text-[11.5px] text-slate-500">{t.k}</div>
              <div className="mt-1 text-[20px] font-light tabular-nums text-slate-900">{t.v}</div>
              <div className="mt-0.5 text-[11px] text-slate-400">{t.s}</div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
