import { NextResponse } from "next/server";
import { AdInsightsRepository } from "@/lib/repositories/ad-insights.repository";

// GET /api/ads/campaign/{id}?days=30 — the real day-by-day insight series for a
// single campaign, powering the drill-down drawer (trend lines, per-day table,
// campaign funnel). All fields are real ad_insights rows; nothing synthesized.
//
// NOTE ON ROAS: daily ROAS here is PIXEL only (conversion_value / spend).
// Settled ROAS can't be computed per campaign — orders carry no campaign
// attribution — so it stays store-level in the summary route. Do not add a
// per-campaign settled figure here; it would be fabricated.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }>  }) {
  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1), 365);
  const { id } = await params;
  const campaignId = decodeURIComponent(id);

  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);


  const rows = (await AdInsightsRepository.listInsights(from, to))
    .filter((r) => r.campaign_id === campaignId)
    .sort((a, b) => a.date.localeCompare(b.date));

    console.log({
      campaignId,
      totalRows: rows.length,
      matchingRows: rows.filter(r => r.campaign_id === campaignId).length,
    });
  if (rows.length === 0) {
    return NextResponse.json({ campaign: null, daily: [], totals: null }, { status: 404 });
  }

  const meta = rows[0];
  const daily = rows.map((r) => ({
    date: r.date,
    spend: +r.spend.toFixed(2),
    impressions: r.impressions,
    clicks: r.clicks,
    conversions: +r.conversions.toFixed(2),
    conversion_value: +r.conversion_value.toFixed(2),
    // per-day pixel ROAS + efficiency
    pixel_roas: r.spend > 0 ? +(r.conversion_value / r.spend).toFixed(2) : null,
    cost_per_click: r.clicks > 0 ? +(r.spend / r.clicks).toFixed(2) : null,
    ctr: r.impressions > 0 ? +(r.clicks / r.impressions).toFixed(4) : null,
    funnel: {
      landing_page_views: r.landing_page_views,
      view_content: r.view_content,
      add_to_cart: r.add_to_cart,
      initiate_checkout: r.initiate_checkout,
    },
  }));

  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  const spend = sum((r) => r.spend), value = sum((r) => r.conversion_value);
  const funnel = {
    landing_page_views: sum((r) => r.landing_page_views),
    view_content: sum((r) => r.view_content),
    add_to_cart: sum((r) => r.add_to_cart),
    initiate_checkout: sum((r) => r.initiate_checkout),
    purchase: sum((r) => r.conversions),
  };

  return NextResponse.json({
    campaign: {
      campaign_id: meta.campaign_id, platform: meta.platform, store_id: meta.store_id,
      campaign_name: meta.campaign_name, campaign_status: meta.campaign_status,
      account_id: meta.account_id,
    },
    daily,
    totals: {
      spend: +spend.toFixed(2),
      impressions: sum((r) => r.impressions),
      clicks: sum((r) => r.clicks),
      conversions: +sum((r) => r.conversions).toFixed(2),
      conversion_value: +value.toFixed(2),
      pixel_roas: spend > 0 ? +(value / spend).toFixed(2) : null,
      cost_per_conversion: funnel.purchase > 0 ? +(spend / funnel.purchase).toFixed(2) : null,
      active_days: rows.length,
      funnel,
    },
  });
}