import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { toAed } from "@/lib/fx";
import { addDubaiDays, dubaiDayBoundsUtc, dubaiMonthBounds, dubaiToday } from "@/lib/dubai-day";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { AdInsightsRepository } from "@/lib/repositories/ad-insights.repository";
import { fetchStoreFunnel, type StoreFunnel } from "@/lib/integrations/shopify-analytics";
import { metaConfigured } from "@/lib/integrations/ads/meta";
import { googleAdsConfigured } from "@/lib/integrations/ads/google";
import { tiktokConfigured } from "@/lib/integrations/ads/tiktok";
import { snapConfigured } from "@/lib/integrations/ads/snap";
import { buildOrdersAnalytics, buildSalesInsights, SITES, type AnalyticsAdRow, type LineItem } from "@/lib/orders/orders-analytics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/orders/analytics?range=7d|30d|90d|mtd
//   → OrdersAnalytics (lib/orders/orders-analytics.ts) plus, per site, the
//     store's own Shopify session funnel, and the status of every ad channel.
// Sales use the one sale rule; ad figures are what each platform reports
// (pixel purchases / value), never mixed into real sales.

const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
type RangeKey = keyof typeof RANGES | "mtd";

const CHANNELS = [
  { platform: "meta", label: "Meta", configured: metaConfigured, credentials: "META_MAIN_ACCESS_TOKEN + META_MAIN_AD_ACCOUNT_IDS" },
  { platform: "google", label: "Google Ads", configured: googleAdsConfigured, credentials: "GOOGLE_ADS_* (developer token, OAuth client, refresh token, customer id)" },
  { platform: "tiktok", label: "TikTok", configured: tiktokConfigured, credentials: "TIKTOK_ACCESS_TOKEN + TIKTOK_ADVERTISER_ID" },
  { platform: "snap", label: "Snapchat", configured: snapConfigured, credentials: "SNAP_ACCESS_TOKEN + SNAP_AD_ACCOUNT_ID" },
] as const;

function periodFor(range: RangeKey, today: string) {
  if (range === "mtd") {
    const { fromDay } = dubaiMonthBounds(today, 0);
    const prev = dubaiMonthBounds(today, 1);
    const elapsed = Number(today.slice(8, 10));
    // Month to date against the same number of days of last month.
    return { fromDay, toDay: today, prevFromDay: prev.fromDay, prevToDay: addDubaiDays(prev.fromDay, elapsed - 1) };
  }
  const days = RANGES[range];
  const fromDay = addDubaiDays(today, -(days - 1));
  return { fromDay, toDay: today, prevFromDay: addDubaiDays(fromDay, -days), prevToDay: addDubaiDays(fromDay, -1) };
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("range") ?? "30d";
  const range: RangeKey = raw === "mtd" || raw in RANGES ? (raw as RangeKey) : "30d";
  const today = dubaiToday();
  const w = periodFor(range, today);

  try {
    const [orders, adRows, runs, funnels] = await Promise.all([
      OrdersRepository.listInWindow({ from: dubaiDayBoundsUtc(w.prevFromDay).fromUtc }),
      AdInsightsRepository.listInsights(w.prevFromDay, w.toDay),
      supabase.from("ad_sync_runs").select("started_at, platform_results").order("started_at", { ascending: false }).limit(1),
      Promise.all(SITES.map(async (s) => [s.code, await fetchStoreFunnel(s.code, w.fromDay, w.toDay)] as const)),
    ]);

    const ads: AnalyticsAdRow[] = adRows.map((r) => ({
      platform: r.platform, store_id: r.store_id, campaign_id: r.campaign_id, campaign_name: r.campaign_name, date: r.date,
      spend: toAed(Number(r.spend) || 0, r.currency || "AED"),
      value: toAed(Number(r.conversion_value) || 0, r.currency || "AED"),
      impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0, purchases: Number(r.conversions) || 0,
      landing_page_views: Number(r.landing_page_views) || 0, view_content: Number(r.view_content) || 0,
      add_to_cart: Number(r.add_to_cart) || 0, initiate_checkout: Number(r.initiate_checkout) || 0,
    }));

    const analytics = buildOrdersAnalytics({
      orders: orders.map((o) => ({ store_id: o.store_id, order_date: o.order_date, gross_aed: o.gross_aed, financial_status: o.financial_status, gateway: o.gateway })),
      ads, ...w,
    });

    const insights = buildSalesInsights({
      orders: orders.map((o) => ({ store_id: o.store_id, order_date: o.order_date, gross_aed: o.gross_aed, financial_status: o.financial_status, gateway: o.gateway, line_items: (o as { line_items?: LineItem[] | null }).line_items ?? null })),
      ...w,
    });

    const lastRun = runs.data?.[0];
    const errors = new Map(((lastRun?.platform_results ?? []) as { platform: string; error?: string }[]).map((p) => [p.platform, p.error ?? ""]));
    const channels = CHANNELS.map((c) => {
      const configured = c.configured();
      const error = errors.get(c.platform) || "";
      return {
        platform: c.platform, label: c.label,
        status: !configured ? "not_connected" : error ? "error" : "connected",
        message: !configured ? `Add ${c.credentials} to connect.` : error,
        lastSyncAt: configured ? lastRun?.started_at ?? null : null,
      };
    });

    const funnelBySite = new Map<string, StoreFunnel>(funnels);
    return NextResponse.json({
      ...analytics,
      range: { ...analytics.range, key: range },
      sites: analytics.sites.map((s) => ({ ...s, funnel: funnelBySite.get(s.code) })),
      channels,
      ...insights,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
