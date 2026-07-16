import { NextResponse } from "next/server";
import { AdInsightsRepository } from "@/lib/repositories/ad-insights.repository";
import { OrdersRepository } from "@/lib/repositories/orders.repository";

const STORES = ["WOO", "KSA", "UAE"];
const cancelled = new Set(["voided", "refunded", "cancelled"]);

// GET /api/ads/summary?days=30&store=ALL — per-store ad spend/conversions
// (Meta/Google/TikTok/Snap) next to actual store revenue for the same
// window, plus a per-campaign breakdown for the marketing table. Spend and
// store revenue are shown as two distinct numbers — deliberately not
// blended into one computed "true ROAS" (see docs/superpowers/specs/
// 2026-07-15-ad-platform-connectors-design.md).
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
    const revenue = scopedOrders.filter((o) => o.store_id === store).reduce((s, o) => s + Number(o.gross_aed || 0), 0);
    return {
      store,
      spend_aed: +rows.reduce((s, r) => s + r.spend, 0).toFixed(2),
      impressions: rows.reduce((s, r) => s + r.impressions, 0),
      clicks: rows.reduce((s, r) => s + r.clicks, 0),
      conversions: +rows.reduce((s, r) => s + r.conversions, 0).toFixed(2),
      conversion_value_aed: +rows.reduce((s, r) => s + r.conversion_value, 0).toFixed(2),
      store_revenue_aed: +revenue.toFixed(2),
      order_count: scopedOrders.filter((o) => o.store_id === store).length,
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
