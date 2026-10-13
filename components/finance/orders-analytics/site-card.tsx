"use client";

/* One website on the Orders page: its sales, and three views of how visitors
 * turn into orders —
 *   Store funnel  Shopify's own sessions → cart → checkout → purchase (all
 *                 traffic). Needs read_reports on the store's token; without
 *                 it the card says what to grant instead of showing zeros.
 *   Ad funnel     what the ad platforms report for their clicks: landing
 *                 views → product views → cart → checkout → purchase.
 *   Traffic       where visits came from (Shopify's referrer source).
 * plus the ads driving it: spend, cart adds, purchases and ROAS per platform,
 * and the top campaigns. */

import { useState } from "react";
import { motion } from "framer-motion";
import { Lock, Megaphone } from "lucide-react";
import type { AdFunnel, SiteAnalytics } from "@/lib/orders/orders-analytics";
import type { StoreFunnel } from "@/lib/integrations/shopify-analytics";
import { Card, Seg, compact, fmt } from "@/components/finance/dashboard-v2/overview/kit";
import { ui } from "@/components/finance/dashboard-v2/overview/ui";
import { STORE_COLOR } from "@/components/finance/dashboard-v2/types";

export type SiteWithFunnel = SiteAnalytics & { funnel?: StoreFunnel };
type View = "store" | "ads" | "traffic";

const PLATFORM_LABEL: Record<string, string> = { meta: "Meta", google: "Google", tiktok: "TikTok", snap: "Snapchat" };
const rate = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(a / b < 0.1 ? 1 : 0)}%` : "—");

export function SiteCard({ site, delay = 0 }: { site: SiteWithFunnel; delay?: number }) {
  const storeOk = site.funnel?.status === "ok";
  const hasAds = site.adsTotal.spend > 0 || site.adsTotal.clicks > 0;
  // Open on whatever has something to show — or on the store tab, whose
  // message says what to grant.
  const [view, setView] = useState<View>(storeOk || !hasAds ? "store" : "ads");
  const color = STORE_COLOR[site.code] ?? "#2563EB";
  const change = site.prev.revenue > 0 ? (site.revenue - site.prev.revenue) / site.prev.revenue : null;

  const tabs: [View, string][] = [["store", "Store funnel"], ["ads", "Ad funnel"], ...(storeOk ? [["traffic", "Traffic"] as [View, string]] : [])];

  return (
    <Card delay={delay} className="flex flex-col">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
            <h3 className="truncate text-[16px] font-medium text-slate-900">{site.label}</h3>
          </div>
          <p className={`mt-0.5 ${ui.hint}`}>{site.domain}</p>
        </div>
        <div className="text-right">
          <p className="text-[22px] font-light tabular-nums tracking-[-0.02em] text-slate-900" title={`AED ${fmt(site.revenue, 2)}`}>AED {compact(site.revenue)}</p>
          <p className={ui.hint}>
            {fmt(site.orders)} orders · avg AED {fmt(site.aov)}
            {change != null && <span className={change >= 0 ? " text-emerald-600" : " text-rose-600"}> · {change >= 0 ? "+" : ""}{(change * 100).toFixed(0)}%</span>}
          </p>
        </div>
      </header>

      <div className="mt-5"><Seg value={view} options={tabs} onChange={setView} /></div>

      <div className="mt-4 min-h-[188px]">
        {view === "store" && <StoreFunnelView funnel={site.funnel} color={color} orders={site.orders} />}
        {view === "ads" && (hasAds ? <AdFunnelView f={site.adsTotal} color={color} /> : <Empty text="No ad data for this website in this period. Its ad account may not be mapped yet, or its channel is disconnected — see Ad channels below." />)}
        {view === "traffic" && site.funnel?.status === "ok" && <TrafficView sources={site.funnel.sources} color={color} />}
      </div>

      <AdsDriving site={site} />
    </Card>
  );
}

function Empty({ text, icon = <Megaphone size={15} /> }: { text: string; icon?: React.ReactNode }) {
  return <p className="flex items-start gap-2 rounded-2xl bg-slate-50 px-4 py-3.5 text-[12.5px] leading-relaxed text-slate-500">{icon}<span>{text}</span></p>;
}

/** Funnel rows: each bar is its share of the first step, with the step-to-step
 *  rate beside it (where most of the drop happens is what matters). */
function FunnelBars({ steps, color }: { steps: { label: string; value: number }[]; color: string }) {
  const top = steps[0]?.value || 0;
  return (
    <ul className="space-y-2.5">
      {steps.map((s, i) => {
        const share = top > 0 ? s.value / top : 0;
        return (
          <li key={s.label} className="grid grid-cols-[112px_1fr_auto] items-center gap-3">
            <span className="text-[12.5px] text-slate-500">{s.label}</span>
            <span className="relative h-7 overflow-hidden rounded-full bg-slate-100">
              <motion.span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ background: color, opacity: 0.35 + 0.65 * (1 - i / Math.max(steps.length - 1, 1)) }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(share * 100, s.value > 0 ? 2.5 : 0)}%` }}
                transition={{ duration: 0.7, delay: 0.06 * i, ease: [0.22, 1, 0.36, 1] }}
              />
              <span className="absolute inset-y-0 left-3 flex items-center text-[12px] font-medium tabular-nums text-slate-900">{fmt(s.value)}</span>
            </span>
            <span className="w-14 text-right text-[11.5px] tabular-nums text-slate-400" title={i ? `${rate(s.value, steps[i - 1].value)} of the step before` : undefined}>
              {i === 0 ? "" : rate(s.value, steps[i - 1].value)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function StoreFunnelView({ funnel, color, orders }: { funnel?: StoreFunnel; color: string; orders: number }) {
  if (!funnel) return <Empty text="No Shopify store for this website." />;
  if (funnel.status !== "ok") return <Empty icon={<Lock size={15} />} text={funnel.message} />;
  const t = funnel.totals;
  return (
    <>
      <FunnelBars color={color} steps={[
        { label: "Sessions", value: t.sessions },
        { label: "Added to cart", value: t.addedToCart },
        { label: "Reached checkout", value: t.reachedCheckout },
        { label: "Purchased", value: t.completed },
      ]} />
      <p className={`mt-3 ${ui.hint}`}>
        Conversion {rate(t.completed, t.sessions)} · Shopify counts {fmt(t.completed)} checkouts; {fmt(orders)} counted orders include ones created by staff.
      </p>
    </>
  );
}

function AdFunnelView({ f, color }: { f: AdFunnel; color: string }) {
  return (
    <>
      <FunnelBars color={color} steps={[
        { label: "Landing views", value: f.landingPageViews },
        { label: "Product views", value: f.viewContent },
        { label: "Added to cart", value: f.addToCart },
        { label: "Checkout", value: f.checkout },
        { label: "Purchased", value: f.purchases },
      ]} />
      <p className={`mt-3 ${ui.hint}`}>As the ad platforms report it, for visitors from their ads · {fmt(f.clicks)} clicks from {compact(f.impressions)} impressions</p>
    </>
  );
}

function TrafficView({ sources, color }: { sources: { source: string; sessions: number; completed: number }[]; color: string }) {
  const max = Math.max(...sources.map((s) => s.sessions), 1);
  return (
    <ul className="space-y-2">
      {sources.map((s, i) => (
        <li key={i} className="grid grid-cols-[88px_1fr_auto] items-center gap-3 text-[12.5px]">
          <span className="capitalize text-slate-500">{s.source}</span>
          <span className="relative h-5 overflow-hidden rounded-full bg-slate-100">
            <motion.span className="absolute inset-y-0 left-0 rounded-full" style={{ background: color, opacity: 0.55 }}
              initial={{ width: 0 }} animate={{ width: `${(s.sessions / max) * 100}%` }} transition={{ duration: 0.6, delay: 0.04 * i }} />
          </span>
          <span className="w-36 text-right tabular-nums text-slate-500">
            <b className="font-medium text-slate-900">{fmt(s.sessions)}</b> · {fmt(s.completed)} bought ({rate(s.completed, s.sessions)})
          </span>
        </li>
      ))}
    </ul>
  );
}

function AdsDriving({ site }: { site: SiteWithFunnel }) {
  if (site.ads.length === 0) return null;
  return (
    <div className="mt-5 border-t border-slate-100 pt-4">
      <p className={ui.label}>Ads driving it</p>
      <table className="mt-2 w-full text-[12.5px]">
        <thead>
          <tr className="text-left">
            <th className="py-1 font-normal text-slate-400">Channel</th>
            <th className="py-1 text-right font-normal text-slate-400">Spend</th>
            <th className="py-1 text-right font-normal text-slate-400">Carts</th>
            <th className="py-1 text-right font-normal text-slate-400">Checkouts</th>
            <th className="py-1 text-right font-normal text-slate-400">Purchases</th>
            <th className="py-1 text-right font-normal text-slate-400" title="Purchase value the platform reports ÷ spend">Pixel ROAS</th>
          </tr>
        </thead>
        <tbody className="tabular-nums text-slate-900">
          {site.ads.map(({ platform, funnel: f }) => (
            <tr key={platform} className="border-t border-slate-100">
              <td className="py-1.5">{PLATFORM_LABEL[platform] ?? platform}</td>
              <td className="py-1.5 text-right" title={`AED ${fmt(f.spend, 2)}`}>AED {compact(f.spend)}</td>
              <td className="py-1.5 text-right">{fmt(f.addToCart)}</td>
              <td className="py-1.5 text-right">{fmt(f.checkout)}</td>
              <td className="py-1.5 text-right">{fmt(f.purchases)}</td>
              <td className="py-1.5 text-right">{f.pixelRoas != null ? `${f.pixelRoas.toFixed(1)}×` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {site.salesRoas != null && (
        <p className={`mt-2 ${ui.hint}`}>Sales ROAS {site.salesRoas.toFixed(1)}× — the website&apos;s counted sales ÷ its ad spend, every order included.</p>
      )}
      {site.topCampaigns.length > 0 && (
        <ul className="mt-3 space-y-1">
          {site.topCampaigns.slice(0, 3).map((c) => (
            <li key={`${c.platform}-${c.name}`} className="flex items-center justify-between gap-3 text-[12px]">
              <span className="truncate text-slate-600" title={c.name}>{c.name}</span>
              <span className="shrink-0 tabular-nums text-slate-400">AED {compact(c.spend)} · {fmt(c.purchases)} bought{c.pixelRoas != null ? ` · ${c.pixelRoas.toFixed(1)}×` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
