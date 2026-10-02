"use client";

/* Sales funnel ribbon + checkout conversion gauge (dark cards).
 *
 * Store view: Shopify sessions → added to cart → reached checkout → bought
 * (ShopifyQL, only the sites whose token has read_reports — the rest are
 * named under the ribbon). Ads view: what Meta reports for the same days.
 * The ribbon's thickness is sqrt-scaled so the last stages stay visible; the
 * stage with the biggest drop is lifted out as the insight column. */

import { motion } from "framer-motion";
import { ArrowRight, Info } from "lucide-react";
import { useMemo, useState } from "react";
import type { SummedFunnel } from "@/lib/dashboard/command-center";
import { compact, fmt } from "../overview/kit";

export type AdFunnelTotals = {
  spend: number; value: number; impressions: number; clicks: number; landingPageViews: number;
  addToCart: number; checkout: number; purchases: number;
};

export const DARK_CARD =
  "relative overflow-hidden rounded-[30px] bg-[#13111D] text-white shadow-[0_30px_60px_-34px_rgba(19,17,29,0.75)]";

type Stage = { label: string; value: number };

const W = 900;
const H = 300;
const TOP = 70;

/** A ribbon flat within each column, easing between columns; thickness ~ sqrt(value). */
function ribbonPath(values: number[]): string {
  const n = values.length;
  const max = Math.max(values[0], 1);
  const col = W / n;
  const t = col * 0.22;
  const mid = TOP + (H - TOP) / 2;
  const h = values.map((v) => 12 + 90 * Math.sqrt(Math.max(v, 0) / max));
  let d = `M 0 ${mid - h[0]}`;
  for (let i = 0; i < n; i++) {
    const edge = (i + 1) * col;
    if (i < n - 1) {
      d += ` L ${edge - t} ${mid - h[i]} C ${edge} ${mid - h[i]}, ${edge} ${mid - h[i + 1]}, ${edge + t} ${mid - h[i + 1]}`;
    } else d += ` L ${W} ${mid - h[i]}`;
  }
  d += ` L ${W} ${mid + h[n - 1]}`;
  for (let i = n - 1; i >= 0; i--) {
    const edge = i * col;
    if (i > 0) {
      d += ` L ${edge + t} ${mid + h[i]} C ${edge} ${mid + h[i]}, ${edge} ${mid + h[i - 1]}, ${edge - t} ${mid + h[i - 1]}`;
    } else d += ` L 0 ${mid + h[0]}`;
  }
  return `${d} Z`;
}

export function FunnelRibbon({ funnel, ads, label }: { funnel: SummedFunnel | null; ads: AdFunnelTotals | null; label: string }) {
  const [view, setView] = useState<"store" | "ads">("store");
  const stages: Stage[] = useMemo(() => {
    if (view === "ads") {
      return ads ? [
        { label: "Ad clicks", value: ads.clicks },
        { label: "Landing views", value: ads.landingPageViews },
        { label: "Add to cart", value: ads.addToCart },
        { label: "Purchases", value: ads.purchases },
      ] : [];
    }
    return funnel ? [
      { label: "Sessions", value: funnel.sessions },
      { label: "Added to cart", value: funnel.addedToCart },
      { label: "Reached checkout", value: funnel.reachedCheckout },
      { label: "Purchased", value: funnel.completed },
    ] : [];
  }, [view, funnel, ads]);

  // The step that loses the largest share of people.
  const leak = useMemo(() => {
    let worst = -1, rate = 1;
    for (let i = 1; i < stages.length; i++) {
      const r = stages[i - 1].value ? stages[i].value / stages[i - 1].value : 1;
      if (r < rate) { rate = r; worst = i; }
    }
    return worst;
  }, [stages]);
  const empty = !stages.length || stages[0].value === 0;
  const col = 100 / Math.max(stages.length, 1);

  return (
    <div className={`${DARK_CARD} min-h-[400px]`}>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_90%_at_100%_40%,rgba(91,61,245,0.55),transparent_60%),radial-gradient(45%_70%_at_0%_60%,rgba(242,112,94,0.35),transparent_60%)]" />
      <div className="relative flex items-start justify-between px-7 pt-6">
        <div>
          <h3 className="text-[26px] font-light tracking-[-0.02em]">Sales funnel</h3>
          <p className="mt-1 text-[12.5px] text-white/50">{view === "store" ? "Shopify store sessions" : "Meta ads"} · {label}</p>
        </div>
        <div className="flex rounded-full bg-white/10 p-1">
          {(["store", "ads"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-full px-3 py-1 text-[12px] ${view === v ? "bg-white text-[#13111D]" : "text-white/70"}`}>
              {v === "store" ? "Store" : "Ads"}
            </button>
          ))}
        </div>
      </div>

      {empty ? (
        <div className="relative px-7 py-16 text-[13px] text-white/50">{funnel || ads ? "No funnel data for this range." : "Loading the funnel…"}</div>
      ) : (
        <div className="relative mt-2 h-[300px]">
          {/* insight column — the biggest drop */}
          {leak > 0 && (
            <motion.div key={`${view}-${leak}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }}
              className="absolute bottom-0 top-0 z-0 rounded-t-[18px] bg-white"
              style={{ left: `${leak * col}%`, width: `${col}%` }} />
          )}
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 z-10 h-full w-full">
            <defs>
              <linearGradient id="ribbon" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#5B3DF5" />
                <stop offset="50%" stopColor="#B25CC9" />
                <stop offset="100%" stopColor="#F2705E" />
              </linearGradient>
              <clipPath id="reveal"><motion.rect key={view} x="0" y="0" height={H} initial={{ width: 0 }} animate={{ width: W }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }} /></clipPath>
            </defs>
            {stages.slice(1).map((_, i) => (
              <line key={i} x1={((i + 1) * W) / stages.length} x2={((i + 1) * W) / stages.length} y1={0} y2={H} stroke="rgba(255,255,255,0.12)" />
            ))}
            <path d={ribbonPath(stages.map((s) => s.value))} fill="url(#ribbon)" opacity={0.92} clipPath="url(#reveal)" />
          </svg>
          <div className="absolute inset-0 z-20 grid" style={{ gridTemplateColumns: `repeat(${stages.length}, 1fr)` }}>
            {stages.map((s, i) => {
              const prev = i ? stages[i - 1].value : 0;
              const rate = i && prev ? s.value / prev : null;
              const on = i === leak;
              return (
                <div key={s.label} className={`flex flex-col justify-between px-5 pb-4 pt-1 ${on ? "text-[#13111D]" : ""}`}>
                  <div>
                    <div className={`text-[13px] ${on ? "text-slate-500" : "text-white/60"}`}>{s.label}</div>
                    <div className="mt-1 text-[30px] font-light tabular-nums tracking-[-0.02em]" title={fmt(s.value)}>{compact(s.value)}</div>
                    {rate != null && <div className={`mt-0.5 text-[12px] ${on ? "text-rose-500" : "text-white/50"}`}>{(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}% of previous</div>}
                  </div>
                  {on && (
                    <div className="flex items-center justify-between text-[12.5px] font-medium">
                      Biggest drop · {(100 - (rate ?? 0) * 100).toFixed(0)}% leave here <ArrowRight size={14} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {view === "store" && funnel && funnel.missing.length > 0 && (
        <div className="relative flex items-center gap-1.5 px-7 pb-5 text-[11.5px] text-white/45">
          <Info size={12} /> {funnel.sites.join(" + ") || "No site"} only — {funnel.missing.map((m) => m.site).join(", ")} need the read_reports scope on their Shopify token.
        </div>
      )}
    </div>
  );
}

/* ── conversion gauge ──────────────────────────────────────────────────── */

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const p = (t: number) => [cx - r * Math.cos(Math.PI * t), cy - r * Math.sin(Math.PI * t)];
  const [x0, y0] = p(from);
  const [x1, y1] = p(to);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${to - from > 1 ? 1 : 0} 1 ${x1} ${y1}`;
}

export function ConversionGauge({ funnel, ads, label }: { funnel: SummedFunnel | null; ads: AdFunnelTotals | null; label: string }) {
  const checkout = funnel && funnel.reachedCheckout ? funnel.completed / funnel.reachedCheckout : null;
  const session = funnel && funnel.sessions ? funnel.completed / funnel.sessions : null;
  const roas = ads && ads.spend ? ads.value / ads.spend : null;
  const v = Math.min(Math.max(checkout ?? 0, 0), 1);
  return (
    <div className={`${DARK_CARD} flex min-h-[400px] flex-col px-7 pb-6 pt-6`}>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_20%_100%,rgba(242,112,94,0.25),transparent_60%)]" />
      <h3 className="relative text-[22px] font-light tracking-[-0.02em]">Checkout conversion</h3>
      <p className="relative mt-1 text-[12.5px] text-white/50">Checkouts that became orders · {label}</p>
      <div className="relative mx-auto mt-4 w-full max-w-[300px]">
        <svg viewBox="0 0 240 140" className="w-full">
          <defs>
            <linearGradient id="gauge" x1="0" x2="1">
              <stop offset="0%" stopColor="#F2705E" />
              <stop offset="100%" stopColor="#8B5CF6" />
            </linearGradient>
          </defs>
          <path d={arc(120, 125, 100, 0, 1)} stroke="rgba(255,255,255,0.08)" strokeWidth={26} fill="none" />
          <motion.path d={arc(120, 125, 100, 0, 1)} stroke="url(#gauge)" strokeWidth={26} fill="none"
            initial={{ pathLength: 0 }} animate={{ pathLength: v }} transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }} />
        </svg>
        <div className="absolute inset-x-0 bottom-1 text-center">
          <div className="text-[34px] font-light tabular-nums tracking-[-0.03em]">{checkout == null ? "—" : `${(checkout * 100).toFixed(1)}%`}</div>
        </div>
      </div>
      <div className="relative mt-auto grid grid-cols-2 gap-3 pt-4">
        <div className="rounded-2xl bg-white/[0.06] px-4 py-3">
          <div className="text-[11.5px] text-white/50">Visit → order</div>
          <div className="mt-1 text-[18px] tabular-nums">{session == null ? "—" : `${(session * 100).toFixed(2)}%`}</div>
        </div>
        <div className="rounded-2xl bg-white/[0.06] px-4 py-3">
          <div className="text-[11.5px] text-white/50">Meta ROAS (pixel)</div>
          <div className="mt-1 text-[18px] tabular-nums">{roas == null ? "—" : `${roas.toFixed(2)}×`}</div>
        </div>
      </div>
    </div>
  );
}
