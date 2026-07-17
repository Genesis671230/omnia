// Snapchat Marketing API — targets the Shopify UAE store.
//
// Reference: https://marketingapi.snapchat.com/docs/#measurement
// (Stats > Ad Account Stats, daily granularity, broken down by campaign).
// Long-lived access token, no refresh flow.
//
// Snap's stats response nests campaign-level daily stats under
// timeseries_stats[0].timeseries_stat.breakdown_stats.campaign[], each with
// its own `timeseries` array of {start_time, stats}. This nesting has shifted
// across Snap API versions before — verify against a live response during
// setup rather than trusting this blindly.

import type { AdPlatform, DateRange, NormalizedInsight, PlatformFetchResult } from "./types";

const BASE = "https://adsapi.snapchat.com/v1";

export function snapConfigured(): boolean {
  return Boolean(process.env.SNAP_ACCESS_TOKEN && process.env.SNAP_AD_ACCOUNT_ID);
}

type SnapDailyStat = {
  start_time: string;
  stats: {
    spend?: number;                       // micro-currency units
    impressions?: number;
    swipes?: number;
    conversion_purchases?: number;
    conversion_purchases_value?: number;  // micro-currency units
  };
};

type SnapCampaignBreakdown = {
  id: string;
  timeseries?: SnapDailyStat[];
};

// campaign name/status come from a separate campaigns list endpoint — the
// stats endpoint only returns ids.
async function fetchCampaignMeta(adAccountId: string, accessToken: string): Promise<Map<string, { name: string; status: string }>> {
  const map = new Map<string, { name: string; status: string }>();
  try {
    const res = await fetch(`${BASE}/adaccounts/${adAccountId}/campaigns`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return map;
    const json = await res.json();
    for (const entry of json.campaigns ?? []) {
      const c = entry.campaign;
      if (c?.id) map.set(c.id, { name: c.name || c.id, status: String(c.status || "unknown").toLowerCase() });
    }
  } catch {
    // best effort only
  }
  return map;
}

export async function fetchInsights(range: DateRange): Promise<PlatformFetchResult> {
  if (!snapConfigured()) return { insights: [], errors: [] };
  const platform: AdPlatform = "snap";
  const adAccountId = process.env.SNAP_AD_ACCOUNT_ID!;
  const accessToken = process.env.SNAP_ACCESS_TOKEN!;

  const meta = await fetchCampaignMeta(adAccountId, accessToken);

  const fields = ["spend", "impressions", "swipes", "conversion_purchases", "conversion_purchases_value"].join(",");
  const qs = new URLSearchParams({
    granularity: "DAY",
    breakdown: "campaign",
    start_time: `${range.from}T00:00:00.000-00:00`,
    end_time: `${range.to}T23:59:59.999-00:00`,
    fields,
  });

  const res = await fetch(`${BASE}/adaccounts/${adAccountId}/stats?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Snap API HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const campaignBreakdowns: SnapCampaignBreakdown[] =
    json.timeseries_stats?.[0]?.timeseries_stat?.breakdown_stats?.campaign ?? [];

  const out: NormalizedInsight[] = [];
  for (const cb of campaignBreakdowns) {
    const info = meta.get(cb.id) ?? { name: cb.id, status: "unknown" };
    for (const day of cb.timeseries ?? []) {
      out.push({
        platform,
        accountId: adAccountId,
        campaignId: cb.id,
        campaignName: info.name,
        campaignStatus: info.status,
        date: day.start_time.slice(0, 10),
        spend: Number(day.stats.spend || 0) / 1_000_000,
        currency: "AED",
        impressions: Number(day.stats.impressions || 0),
        clicks: Number(day.stats.swipes || 0),
        conversions: Number(day.stats.conversion_purchases || 0),
        conversionValue: Number(day.stats.conversion_purchases_value || 0) / 1_000_000,
      });
    }
  }
    // Single-account platform: a failure here is a total platform failure, which
  // this connector already signals by throwing. Hence errors is always empty.
  return { insights: out, errors: [] };
}
