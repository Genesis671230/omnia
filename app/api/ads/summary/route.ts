import { NextResponse } from "next/server";
import { AdInsightsRepository } from "@/lib/repositories/ad-insights.repository";
import { OrdersRepository } from "@/lib/repositories/orders.repository";

const STORES = ["WOO", "KSA", "UAE"];
const cancelled = new Set(["voided", "refunded", "cancelled"]);

// GET /api/ads/summary?days=30&store=ALL — per-store ad spend/conversions
// (Meta/Google/TikTok/Snap) next to actual store revenue for the same
// window, plus a per-campaign breakdown for the marketing table.
//
// REVERSAL (2026-07-17, founder-approved): the 2026-07-15 spec forbade
// computing a "true ROAS" at all. The founder asked for one. We now return
// BOTH — pixel_roas (Meta's self-reported attribution) and settled_roas
// (real store revenue / spend) — each labeled by source, never averaged into
// one figure. The original caution was well-founded: this connector was
// overcounting conversions 8x and would have reported 28.55x against a real
// 4.76x. Showing both keeps that gap visible instead of hiding it in a mean.
// See docs/superpowers/specs/2026-07-17-meta-ads-correctness-design.md.
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
      // Two ROAS figures, never averaged into one. pixel_roas is Meta's own
      // attribution; settled_roas is money that actually reached the store.
      // They measure different things and the gap between them is the point.
      pixel_roas: spend > 0 ? +(pixelValue / spend).toFixed(2) : null,
      settled_roas: spend > 0 ? +(revenue / spend).toFixed(2) : null,
    };
  });

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
    .map((c) => ({ ...c, spend: +c.spend.toFixed(2), conversions: +c.conversions.toFixed(2), conversion_value: +c.conversion_value.toFixed(2) }))
    .sort((a, b) => b.spend - a.spend);

  return NextResponse.json({ window: { days, from, to, store: storeFilter }, stores, campaigns });
}
