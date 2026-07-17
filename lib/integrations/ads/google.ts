// Google Ads API — covers Search/Display/Shopping and YouTube campaigns
// under one customer account, targeting the WooCommerce/.com site.
//
// Reference: https://developers.google.com/google-ads/api/docs/query/overview
// Google Ads has no simple long-lived server token — a one-time OAuth grant
// mints a refresh token (GOOGLE_ADS_REFRESH_TOKEN), which this file exchanges
// for a short-lived access token on every sync. That exchange is the only
// OAuth-shaped step in this connector; everything else is the same
// "set it in .env once" model as the other platforms.

import type { AdPlatform, DateRange, NormalizedInsight, PlatformFetchResult } from "./types";

const API_VERSION = "v18";
const BASE = `https://googleads.googleapis.com/${API_VERSION}`;

export function googleAdsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN &&
    process.env.GOOGLE_ADS_CLIENT_ID &&
    process.env.GOOGLE_ADS_CLIENT_SECRET &&
    process.env.GOOGLE_ADS_CUSTOMER_ID,
  );
}

async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google OAuth token refresh HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.access_token as string;
}

type GoogleAdsRow = {
  campaign: { id: string; name: string; status: string };
  segments: { date: string };
  metrics: {
    costMicros: string;
    impressions: string;
    clicks: string;
    conversions: number;
    conversionsValue: number;
  };
};

export async function fetchInsights(range: DateRange): Promise<PlatformFetchResult> {
  if (!googleAdsConfigured()) return { insights: [], errors: [] };
  const platform: AdPlatform = "google";
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID!.replace(/-/g, "");
  const accessToken = await getAccessToken();

  const query = `
    SELECT campaign.id, campaign.name, campaign.status, segments.date,
           metrics.cost_micros, metrics.impressions, metrics.clicks,
           metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${range.from}' AND '${range.to}'
  `.trim();

  const res = await fetch(`${BASE}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Ads API HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const rows: GoogleAdsRow[] = json.results ?? [];

  // Single-account platform: a failure here is a total platform failure, which
  // this connector already signals by throwing. Hence errors is always empty.
  return {
    insights: rows.map((r) => ({
      platform,
      accountId: customerId,
      campaignId: String(r.campaign.id),
      campaignName: r.campaign.name,
      campaignStatus: String(r.campaign.status || "unknown").toLowerCase(),
      date: r.segments.date,
      spend: Number(r.metrics.costMicros || 0) / 1_000_000,
      currency: "AED",
      impressions: Number(r.metrics.impressions || 0),
      clicks: Number(r.metrics.clicks || 0),
      conversions: Number(r.metrics.conversions || 0),
      conversionValue: Number(r.metrics.conversionsValue || 0),
    })),
    errors: [],
  };
}
