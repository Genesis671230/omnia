// TikTok Ads API (Business API) — targets the WooCommerce/.com site.
//
// Reference: https://business-api.tiktok.com/portal/docs?id=1738864928123970
// (Reporting > Integrated Report). Long-lived access token, no refresh flow.

import type { AdPlatform, DateRange, NormalizedInsight } from "./types";

const BASE = "https://business-api.tiktok.com/open_api/v1.3";

export function tiktokConfigured(): boolean {
  return Boolean(process.env.TIKTOK_ACCESS_TOKEN && process.env.TIKTOK_ADVERTISER_ID);
}

type TikTokReportItem = {
  dimensions: { campaign_id: string; stat_time_day: string };
  metrics: {
    campaign_name: string;
    spend: string;
    impressions: string;
    clicks: string;
    conversion: string;
    total_complete_payment_rate?: string;
    currency?: string;
  };
};

// campaign status isn't part of the report endpoint — fetched separately via
// the campaign/get/ endpoint, best effort (same reasoning as Meta's).
async function fetchCampaignStatuses(advertiserId: string, accessToken: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const qs = new URLSearchParams({
      advertiser_id: advertiserId,
      page_size: "1000",
      fields: JSON.stringify(["campaign_id", "operation_status"]),
    });
    const res = await fetch(`${BASE}/campaign/get/?${qs.toString()}`, {
      headers: { "Access-Token": accessToken },
      cache: "no-store",
    });
    if (!res.ok) return map;
    const json = await res.json();
    for (const c of json.data?.list ?? []) {
      map.set(String(c.campaign_id), String(c.operation_status || "unknown").toLowerCase());
    }
  } catch {
    // best effort only
  }
  return map;
}

export async function fetchInsights(range: DateRange): Promise<NormalizedInsight[]> {
  if (!tiktokConfigured()) return [];
  const platform: AdPlatform = "tiktok";
  const advertiserId = process.env.TIKTOK_ADVERTISER_ID!;
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN!;

  const statuses = await fetchCampaignStatuses(advertiserId, accessToken);

  const out: NormalizedInsight[] = [];
  let page = 1;
  for (;;) {
    const qs = new URLSearchParams({
      advertiser_id: advertiserId,
      report_type: "BASIC",
      data_level: "AUCTION_CAMPAIGN",
      dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
      metrics: JSON.stringify(["campaign_name", "spend", "impressions", "clicks", "conversion", "currency"]),
      start_date: range.from,
      end_date: range.to,
      page: String(page),
      page_size: "1000",
    });
    const res = await fetch(`${BASE}/report/integrated/get/?${qs.toString()}`, {
      headers: { "Access-Token": accessToken },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`TikTok API HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    if (json.code !== 0) throw new Error(`TikTok API error ${json.code}: ${json.message}`);

    const items: TikTokReportItem[] = json.data?.list ?? [];
    for (const item of items) {
      out.push({
        platform,
        accountId: advertiserId,
        campaignId: item.dimensions.campaign_id,
        campaignName: item.metrics.campaign_name,
        campaignStatus: statuses.get(item.dimensions.campaign_id) ?? "unknown",
        date: item.dimensions.stat_time_day.slice(0, 10),
        spend: Number(item.metrics.spend || 0),
        currency: item.metrics.currency || "AED",
        impressions: Number(item.metrics.impressions || 0),
        clicks: Number(item.metrics.clicks || 0),
        conversions: Number(item.metrics.conversion || 0),
        // TikTok's Basic report doesn't carry conversion value directly —
        // it requires the VALUE report type. Left at 0 until that's needed;
        // conversions (count) is still meaningful on its own.
        conversionValue: 0,
      });
    }

    const totalPages = json.data?.page_info?.total_page ?? 1;
    if (page >= totalPages || items.length === 0) break;
    page += 1;
  }
  return out;
}
