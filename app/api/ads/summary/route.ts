import { NextResponse } from "next/server";
import { AdInsightsRepository } from "@/lib/repositories/ad-insights.repository";
import { OrdersRepository } from "@/lib/repositories/orders.repository";

const STORES = ["WOO", "KSA", "UAE"];
const cancelled = new Set(["voided", "refunded", "cancelled"]);

// GET /api/ads/summary?days=30&store=ALL — per-store ad spend/conversions
// (Meta/Google/TikTok/Snap) next to actual store revenue for the same window,
// a per-PLATFORM spend-efficiency breakdown, and a per-campaign table.
//
// ROAS honesty (2026-07-17 spec): pixel_roas = platform self-reported;
// settled_roas = real store revenue / spend. Never averaged into one.
//
// Per-platform note: pixel_roas IS computable per platform (conversion_value
// lives on ad_insights, which carries `platform`). settled_roas is NOT —
// store revenue can't be attributed to a platform (no click-to-order link in
// this data, same limitation as blended CAC). So the platform breakdown
// deliberately OMITS settled ROAS rather than fabricate a per-platform split;
// settled ROAS stays store-level only.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1), 365);
  const storeFilter = (url.searchParams.get("store") || "ALL").toUpperCase();

  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [insightRows, orders] = await Promise.all([
    AdInsightsRepository.listInsights(from, to),
    OrdersRepository.listAll(),
  ]);

  const scopedInsights = insightRows.filter((r) => storeFilter === "ALL" || r.store_id === storeFilter);

  const fromIso = new Date(from + "T00:00:00Z").toISOString();
  const scopedOrders = orders.filter((o) =>
    Boolean(o.order_date) && o.order_date! >= fromIso && !cancelled.has(o.financial_status) &&
    (storeFilter === "ALL" || o.store_id === storeFilter),
  );

  const storesToShow = storeFilter === "ALL" ? STORES : [storeFilter];
  const stores = storesToShow.map((store) => {
    const rows = scopedInsights.filter((r) => r.store_id === store);
    const storeOrders = scopedOrders.filter((o) => o.store_id === store);
    const revenue = storeOrders.reduce((s, o) => s + Number(o.gross_aed || 0), 0);
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const purchases = rows.reduce((s, r) => s + r.conversions, 0);
    const pixelValue = rows.reduce((s, r) => s + r.conversion_value, 0);
    return {
      store,
      spend_aed: +spend.toFixed(2),
      impressions: rows.reduce((s, r) => s + r.impressions, 0),
      clicks: rows.reduce((s, r) => s + r.clicks, 0),
      conversions: +purchases.toFixed(2),
      conversion_value_aed: +pixelValue.toFixed(2),
      store_revenue_aed: +revenue.toFixed(2),
      order_count: storeOrders.length,
      funnel: {
        landing_page_views: rows.reduce((s, r) => s + r.landing_page_views, 0),
        view_content: rows.reduce((s, r) => s + r.view_content, 0),
        add_to_cart: rows.reduce((s, r) => s + r.add_to_cart, 0),
        initiate_checkout: rows.reduce((s, r) => s + r.initiate_checkout, 0),
        purchase: +purchases.toFixed(2),
      },
      cost_per_purchase_aed: purchases > 0 ? +(spend / purchases).toFixed(2) : null,
      pixel_roas: spend > 0 ? +(pixelValue / spend).toFixed(2) : null,
      settled_roas: spend > 0 ? +(revenue / spend).toFixed(2) : null,
    };
  });

  // ── per-PLATFORM spend-efficiency aggregate ──────────────────────────────
  // Real fields only. NO settled_roas here (see header note). pixel_roas and
  // the cost-per-* efficiency numbers are all sourced from ad_insights, which
  // carries the platform tag, so these are honest.
  const byPlatform = new Map<string, {
    platform: string; spend: number; impressions: number; clicks: number;
    conversions: number; conversion_value: number; campaigns: Set<string>;
  }>();
  for (const r of scopedInsights) {
    const p = byPlatform.get(r.platform) ?? {
      platform: r.platform, spend: 0, impressions: 0, clicks: 0,
      conversions: 0, conversion_value: 0, campaigns: new Set<string>(),
    };
    p.spend += r.spend;
    p.impressions += r.impressions;
    p.clicks += r.clicks;
    p.conversions += r.conversions;
    p.conversion_value += r.conversion_value;
    p.campaigns.add(r.campaign_id);
    byPlatform.set(r.platform, p);
  }

  const totalSpend = [...byPlatform.values()].reduce((s, p) => s + p.spend, 0);
  const platforms = [...byPlatform.values()]
    .map((p) => ({
      platform: p.platform,
      spend_aed: +p.spend.toFixed(2),
      spend_share: totalSpend > 0 ? +(p.spend / totalSpend).toFixed(4) : 0,
      impressions: p.impressions,
      clicks: p.clicks,
      conversions: +p.conversions.toFixed(2),
      conversion_value_aed: +p.conversion_value.toFixed(2),
      campaign_count: p.campaigns.size,
      ctr: p.impressions > 0 ? +(p.clicks / p.impressions).toFixed(4) : null,
      cost_per_click_aed: p.clicks > 0 ? +(p.spend / p.clicks).toFixed(2) : null,
      cost_per_conversion_aed: p.conversions > 0 ? +(p.spend / p.conversions).toFixed(2) : null,
      // pixel ROAS only — platform self-reported value / spend. Labeled as
      // pixel everywhere in the UI so it's never mistaken for settled money.
      pixel_roas: p.spend > 0 ? +(p.conversion_value / p.spend).toFixed(2) : null,
    }))
    .sort((a, b) => b.spend_aed - a.spend_aed);

  // ── per-campaign table (unchanged) ───────────────────────────────────────
  const byCampaign = new Map<string, {
    campaign_id: string; platform: string; store_id: string; campaign_name: string;
    campaign_status: string; spend: number; impressions: number; clicks: number;
    conversions: number; conversion_value: number;
  }>();
  for (const r of scopedInsights) {
    const c = byCampaign.get(r.campaign_id) ?? {
      campaign_id: r.campaign_id, platform: r.platform, store_id: r.store_id,
      campaign_name: r.campaign_name, campaign_status: r.campaign_status,
      spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0,
    };
    c.spend += r.spend;
    c.impressions += r.impressions;
    c.clicks += r.clicks;
    c.conversions += r.conversions;
    c.conversion_value += r.conversion_value;
    byCampaign.set(r.campaign_id, c);
  }

  const campaigns = [...byCampaign.values()]
    .map((c) => ({
      ...c,
      spend: +c.spend.toFixed(2),
      conversions: +c.conversions.toFixed(2),
      conversion_value: +c.conversion_value.toFixed(2),
      // per-campaign pixel ROAS + cost-per-conversion, for the sortable table
      pixel_roas: c.spend > 0 ? +(c.conversion_value / c.spend).toFixed(2) : null,
      cost_per_conversion: c.conversions > 0 ? +(c.spend / c.conversions).toFixed(2) : null,
    }))
    .sort((a, b) => b.spend - a.spend);

  return NextResponse.json({
    window: { days, from, to, store: storeFilter },
    platforms,
    stores,
    campaigns,
  });
}