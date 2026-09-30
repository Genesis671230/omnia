// The Orders page's analytics: sales per website (counted with the one sale
// rule — lib/orders/sale-rule.ts), each site's ad spend and ad-attributed
// funnel per platform, and the same figures for the period before, so every
// number carries a trend. Pure — the route fetches, this adds up.
//
// A "site" is a storefront a customer visits. omniastores.com moved from
// WooCommerce to Shopify Main in Sept 2026, so the MAIN site also carries the
// WOO store's orders and its ad account (still tagged WOO) — one site, one
// history.

import { dubaiDayKey, dubaiDayRange } from "@/lib/dubai-day";
import { isCountedSale, isReversedOrder } from "./sale-rule";

export type SiteConfig = { code: string; label: string; domain: string; stores: string[] };

export const SITES: SiteConfig[] = [
  { code: "MAIN", label: "Shopify Main", domain: "omniastores.com", stores: ["MAIN", "WOO"] },
  { code: "UAE", label: "Shopify UAE", domain: "UAE store", stores: ["UAE"] },
  { code: "KSA", label: "Shopify KSA", domain: "KSA store", stores: ["KSA"] },
  { code: "WA", label: "WhatsApp store", domain: "WhatsApp orders", stores: ["WA"] },
];

export type AnalyticsOrder = {
  store_id: string;
  order_date: string | null;
  gross_aed: number | null;
  financial_status: string | null;
  gateway?: string | null;
};

export type AnalyticsAdRow = {
  platform: string;
  store_id: string;
  campaign_id: string;
  campaign_name: string;
  date: string;
  /** Already in AED. */
  spend: number;
  value: number;
  impressions: number;
  clicks: number;
  purchases: number;
  landing_page_views: number;
  view_content: number;
  add_to_cart: number;
  initiate_checkout: number;
};

export type AdFunnel = {
  spend: number; value: number; impressions: number; clicks: number; landingPageViews: number;
  viewContent: number; addToCart: number; checkout: number; purchases: number;
  /** Platform-reported purchase value ÷ spend. Never averaged with real ROAS. */
  pixelRoas: number | null;
};

export type SiteAnalytics = {
  code: string; label: string; domain: string;
  orders: number; revenue: number; aov: number; cancelled: number;
  prev: { orders: number; revenue: number };
  daily: { day: string; orders: number; revenue: number }[];
  ads: { platform: string; funnel: AdFunnel }[];
  adsTotal: AdFunnel;
  /** Real sales ÷ ad spend for the site. */
  salesRoas: number | null;
  topCampaigns: { platform: string; name: string; spend: number; purchases: number; addToCart: number; pixelRoas: number | null }[];
};

export type OrdersAnalytics = {
  range: { fromDay: string; toDay: string; prevFromDay: string; prevToDay: string };
  totals: {
    orders: number; revenue: number; aov: number; cancelled: number; adSpend: number; salesRoas: number | null;
    prev: { orders: number; revenue: number; aov: number; cancelled: number; adSpend: number };
  };
  daily: ({ day: string; orders: number; revenue: number; adSpend: number } & Record<string, number | string>)[];
  sites: SiteAnalytics[];
};

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const ratio = (a: number, b: number) => (b > 0 ? r2(a / b) : null);

function emptyFunnel(): AdFunnel {
  return { spend: 0, value: 0, impressions: 0, clicks: 0, landingPageViews: 0, viewContent: 0, addToCart: 0, checkout: 0, purchases: 0, pixelRoas: null };
}
function addTo(f: AdFunnel, r: AnalyticsAdRow) {
  f.spend += r.spend; f.value += r.value; f.impressions += r.impressions; f.clicks += r.clicks;
  f.landingPageViews += r.landing_page_views; f.viewContent += r.view_content;
  f.addToCart += r.add_to_cart; f.checkout += r.initiate_checkout; f.purchases += r.purchases;
}
function finish(f: AdFunnel): AdFunnel {
  return { ...f, spend: r2(f.spend), value: r2(f.value), pixelRoas: ratio(f.value, f.spend) };
}

export function buildOrdersAnalytics(input: {
  orders: AnalyticsOrder[];
  ads: AnalyticsAdRow[];
  fromDay: string; toDay: string; prevFromDay: string; prevToDay: string;
  sites?: SiteConfig[];
}): OrdersAnalytics {
  const sites = input.sites ?? SITES;
  const siteOf = new Map(sites.flatMap((s) => s.stores.map((st) => [st, s.code] as const)));
  const days = dubaiDayRange(input.fromDay, input.toDay);
  const inCur = (d: string) => d >= input.fromDay && d <= input.toDay;
  const inPrev = (d: string) => d >= input.prevFromDay && d <= input.prevToDay;

  type Acc = { orders: number; revenue: number; cancelled: number; prevOrders: number; prevRevenue: number; prevCancelled: number; daily: Map<string, { orders: number; revenue: number }> };
  const acc = new Map<string, Acc>(sites.map((s) => [s.code, {
    orders: 0, revenue: 0, cancelled: 0, prevOrders: 0, prevRevenue: 0, prevCancelled: 0,
    daily: new Map(days.map((d) => [d, { orders: 0, revenue: 0 }])),
  }]));

  for (const o of input.orders) {
    const site = siteOf.get(o.store_id);
    const day = dubaiDayKey(o.order_date);
    if (!site || !day) continue;
    const a = acc.get(site)!;
    const counted = isCountedSale(o);
    const reversed = isReversedOrder(o);
    const amount = Number(o.gross_aed) || 0;
    if (inCur(day)) {
      if (counted) {
        a.orders += 1; a.revenue += amount;
        const d = a.daily.get(day)!; d.orders += 1; d.revenue += amount;
      } else if (reversed) a.cancelled += 1;
    } else if (inPrev(day)) {
      if (counted) { a.prevOrders += 1; a.prevRevenue += amount; } else if (reversed) a.prevCancelled += 1;
    }
  }

  const adsBySite = new Map<string, Map<string, AdFunnel>>();
  const campaigns = new Map<string, { site: string; platform: string; name: string; f: AdFunnel }>();
  const adSpendByDay = new Map<string, number>();
  let prevAdSpend = 0;
  for (const r of input.ads) {
    const site = siteOf.get(r.store_id);
    if (!site) continue;
    if (inPrev(r.date)) { prevAdSpend += r.spend; continue; }
    if (!inCur(r.date)) continue;
    const byPlatform = adsBySite.get(site) ?? new Map<string, AdFunnel>();
    const f = byPlatform.get(r.platform) ?? emptyFunnel();
    addTo(f, r);
    byPlatform.set(r.platform, f);
    adsBySite.set(site, byPlatform);
    const c = campaigns.get(r.campaign_id) ?? { site, platform: r.platform, name: r.campaign_name, f: emptyFunnel() };
    addTo(c.f, r);
    campaigns.set(r.campaign_id, c);
    adSpendByDay.set(r.date, (adSpendByDay.get(r.date) ?? 0) + r.spend);
  }

  const siteRows: SiteAnalytics[] = sites.map((s) => {
    const a = acc.get(s.code)!;
    const platforms = [...(adsBySite.get(s.code) ?? new Map()).entries()]
      .map(([platform, f]) => ({ platform, funnel: finish(f) }))
      .sort((x, y) => y.funnel.spend - x.funnel.spend);
    const total = emptyFunnel();
    for (const p of platforms) {
      for (const k of ["spend", "value", "impressions", "clicks", "landingPageViews", "viewContent", "addToCart", "checkout", "purchases"] as const) total[k] += p.funnel[k];
    }
    const adsTotal = finish(total);
    return {
      code: s.code, label: s.label, domain: s.domain,
      orders: a.orders, revenue: r2(a.revenue), aov: a.orders ? r2(a.revenue / a.orders) : 0, cancelled: a.cancelled,
      prev: { orders: a.prevOrders, revenue: r2(a.prevRevenue) },
      daily: days.map((day) => ({ day, orders: a.daily.get(day)!.orders, revenue: r2(a.daily.get(day)!.revenue) })),
      ads: platforms,
      adsTotal,
      salesRoas: ratio(a.revenue, adsTotal.spend),
      topCampaigns: [...campaigns.values()]
        .filter((c) => c.site === s.code)
        .map((c) => ({ platform: c.platform, name: c.name, spend: r2(c.f.spend), purchases: c.f.purchases, addToCart: c.f.addToCart, pixelRoas: ratio(c.f.value, c.f.spend) }))
        .sort((x, y) => y.spend - x.spend)
        .slice(0, 5),
    };
  });

  const sum = (f: (s: SiteAnalytics) => number) => siteRows.reduce((t, s) => t + f(s), 0);
  const orders = sum((s) => s.orders);
  const revenue = r2(sum((s) => s.revenue));
  const adSpend = r2(sum((s) => s.adsTotal.spend));
  const prevOrders = sum((s) => s.prev.orders);
  const prevRevenue = r2(sum((s) => s.prev.revenue));

  return {
    range: { fromDay: input.fromDay, toDay: input.toDay, prevFromDay: input.prevFromDay, prevToDay: input.prevToDay },
    totals: {
      orders, revenue, aov: orders ? r2(revenue / orders) : 0, cancelled: sum((s) => s.cancelled), adSpend, salesRoas: ratio(revenue, adSpend),
      prev: {
        orders: prevOrders, revenue: prevRevenue, aov: prevOrders ? r2(prevRevenue / prevOrders) : 0,
        cancelled: [...acc.values()].reduce((t, a) => t + a.prevCancelled, 0), adSpend: r2(prevAdSpend),
      },
    },
    daily: days.map((day, i) => {
      const row: { day: string; orders: number; revenue: number; adSpend: number } & Record<string, number | string> = {
        day, orders: 0, revenue: 0, adSpend: r2(adSpendByDay.get(day) ?? 0),
      };
      for (const s of siteRows) {
        row[s.code] = s.daily[i].revenue;
        row.orders += s.daily[i].orders;
        row.revenue = r2(row.revenue + s.daily[i].revenue);
      }
      return row;
    }),
    sites: siteRows,
  };
}

/* ── what sells, and when ─────────────────────────────────────────────────── */

export type LineItem = { qty?: number; sku?: string | null; title?: string | null; image_url?: string | null; total_aed?: number | null; stock?: number | null };
export type SkuRow = {
  sku: string; title: string; imageUrl: string | null; units: number; revenue: number; orders: number; avgPrice: number;
  stock: number | null; prevRevenue: number;
  /** vs the previous period: new / rising (≥ +20%) / falling (≤ −20%) / steady. */
  trend: "new" | "rising" | "steady" | "falling";
};
export type TimeOfDay = {
  /** 96 quarter-hours, Dubai time, summed over the period. */
  slots: { slot: number; label: string; orders: number; revenue: number }[];
  /** The best 3 hours (12 consecutive slots, wrapping midnight). */
  peak: { fromSlot: number; toSlot: number; label: string; revenue: number; orders: number; share: number };
};

const DUBAI_MS = 4 * 3600_000;
const slotOf = (iso: string) => {
  const t = new Date(iso.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).getTime() + DUBAI_MS;
  const d = new Date(t);
  return d.getUTCHours() * 4 + Math.floor(d.getUTCMinutes() / 15);
};
const slotLabel = (s: number) => `${String(Math.floor(s / 4) % 24).padStart(2, "0")}:${String((s % 4) * 15).padStart(2, "0")}`;

export function buildSalesInsights(input: {
  orders: (AnalyticsOrder & { line_items?: LineItem[] | null })[];
  fromDay: string; toDay: string; prevFromDay: string; prevToDay: string;
  limit?: number;
}): { topSkus: SkuRow[]; timeOfDay: TimeOfDay } {
  const cur = new Map<string, SkuRow>();
  const prev = new Map<string, number>();
  const slots = Array.from({ length: 96 }, (_, slot) => ({ slot, label: slotLabel(slot), orders: 0, revenue: 0 }));

  for (const o of input.orders) {
    const day = dubaiDayKey(o.order_date);
    if (!day || !o.order_date || !isCountedSale(o)) continue;
    const inCur = day >= input.fromDay && day <= input.toDay;
    const inPrev = day >= input.prevFromDay && day <= input.prevToDay;
    if (!inCur && !inPrev) continue;
    if (inCur) {
      const s = slots[slotOf(o.order_date)];
      s.orders += 1;
      s.revenue += Number(o.gross_aed) || 0;
    }
    for (const li of o.line_items ?? []) {
      const key = (li.sku || li.title || "").trim();
      if (!key) continue;
      const amount = Number(li.total_aed) || 0;
      if (inPrev) { prev.set(key, (prev.get(key) ?? 0) + amount); continue; }
      const row = cur.get(key) ?? {
        sku: li.sku || "", title: li.title || key, imageUrl: li.image_url || null, units: 0, revenue: 0, orders: 0,
        avgPrice: 0, stock: li.stock ?? null, prevRevenue: 0, trend: "steady" as const,
      };
      row.units += Number(li.qty) || 1;
      row.revenue += amount;
      row.orders += 1;
      if (!row.imageUrl && li.image_url) row.imageUrl = li.image_url;
      cur.set(key, row);
    }
  }

  const topSkus = [...cur.entries()]
    .map(([key, r]) => {
      const p = prev.get(key) ?? 0;
      const change = p > 0 ? (r.revenue - p) / p : null;
      const trend: SkuRow["trend"] = change == null ? "new" : change >= 0.2 ? "rising" : change <= -0.2 ? "falling" : "steady";
      return { ...r, revenue: r2(r.revenue), avgPrice: r.units ? r2(r.revenue / r.units) : 0, prevRevenue: r2(p), trend };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, input.limit ?? 10);

  const total = slots.reduce((s, x) => s + x.revenue, 0);
  let best = { from: 0, revenue: -1, orders: 0 };
  for (let start = 0; start < 96; start++) {
    let revenue = 0; let orders = 0;
    for (let k = 0; k < 12; k++) { const s = slots[(start + k) % 96]; revenue += s.revenue; orders += s.orders; }
    if (revenue > best.revenue) best = { from: start, revenue, orders };
  }
  const toSlot = (best.from + 11) % 96;
  return {
    topSkus,
    timeOfDay: {
      slots: slots.map((s) => ({ ...s, revenue: r2(s.revenue) })),
      peak: {
        fromSlot: best.from, toSlot, label: `${slotLabel(best.from)}–${slotLabel((toSlot + 1) % 96)}`,
        revenue: r2(Math.max(best.revenue, 0)), orders: best.orders, share: total > 0 ? r2(best.revenue / total) : 0,
      },
    },
  };
}
