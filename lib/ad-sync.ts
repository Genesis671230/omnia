// Shared ad-platform-insights-fetch logic — pulls campaign performance from
// whichever platform APIs are configured and upserts them. Used by both the
// on-demand API route (POST /api/integrations/ads) and the persistent
// in-app scheduler, so there is exactly one place this logic lives. Mirrors
// lib/payout-sync.ts.

import { metaConfigured, fetchInsights as fetchMetaInsights } from "@/lib/integrations/ads/meta";
import { googleAdsConfigured, fetchInsights as fetchGoogleInsights } from "@/lib/integrations/ads/google";
import { tiktokConfigured, fetchInsights as fetchTiktokInsights } from "@/lib/integrations/ads/tiktok";
import { snapConfigured, fetchInsights as fetchSnapInsights } from "@/lib/integrations/ads/snap";
import { storeForAccount } from "@/lib/ads-accounts";
import { AdInsightsRepository } from "@/lib/repositories/ad-insights.repository";
import type { NormalizedInsight, DateRange } from "@/lib/integrations/ads/types";

export type AdPlatformSyncResult = { platform: string; fetched: number; saved: number; error?: string };

type PlatformClient = {
  name: string;
  configured: () => boolean;
  fetch: (range: DateRange) => Promise<NormalizedInsight[]>;
};

const PLATFORMS: PlatformClient[] = [
  { name: "meta", configured: metaConfigured, fetch: fetchMetaInsights },
  { name: "google", configured: googleAdsConfigured, fetch: fetchGoogleInsights },
  { name: "tiktok", configured: tiktokConfigured, fetch: fetchTiktokInsights },
  { name: "snap", configured: snapConfigured, fetch: fetchSnapInsights },
];

// Rolling window of `days` (default: today + yesterday) — ad platforms
// revise same-day stats as the day progresses, so re-pulling yesterday on
// every cycle keeps those numbers from going stale.
export async function syncAdInsights(days = 2): Promise<AdPlatformSyncResult[]> {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const range: DateRange = { from, to };

  const results: AdPlatformSyncResult[] = [];
  for (const platform of PLATFORMS) {
    if (!platform.configured()) continue;
    try {
      const insights = await platform.fetch(range);
      const withStore = insights.map((i) => ({ ...i, store: storeForAccount(i.platform, i.accountId) }));
      const saved = await AdInsightsRepository.upsertInsights(withStore);
      results.push({ platform: platform.name, fetched: insights.length, saved });
    } catch (e) {
      results.push({ platform: platform.name, fetched: 0, saved: 0, error: (e as Error).message });
    }
  }
  return results;
}
