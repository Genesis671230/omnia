import { NextResponse } from "next/server";
import { metaConfigured, metaTokenStatus } from "@/lib/integrations/ads/meta";
import { googleAdsConfigured } from "@/lib/integrations/ads/google";
import { tiktokConfigured } from "@/lib/integrations/ads/tiktok";
import { snapConfigured } from "@/lib/integrations/ads/snap";
import { syncAdInsights } from "@/lib/ad-sync";
import { AdSyncRunsRepository } from "@/lib/repositories/ad-sync-runs.repository";

export const maxDuration = 60;

// GET /api/integrations/ads — which ad platform APIs are configured, plus
// the most recent run of the persistent ad-sync scheduler (manual or
// automatic) so the UI can show founders when campaign data was last pulled.
export async function GET() {
  const [lastRun, metaTokens] = await Promise.all([
    AdSyncRunsRepository.getLatest(),
    metaConfigured() ? metaTokenStatus() : Promise.resolve([]),
  ]);
  return NextResponse.json({
    meta: metaConfigured(),
    google: googleAdsConfigured(),
    tiktok: tiktokConfigured(),
    snap: snapConfigured(),
    metaTokens,
    lastRun,
  });
}

// POST /api/integrations/ads — pull campaign insights directly from
// configured platform APIs for the last N days. Also used on-demand by
// founders; the scheduler calls syncAdInsights directly.
export async function POST(request: Request) {
  const { days = 2 } = await request.json().catch(() => ({}));
  const platformResults = await syncAdInsights(days);
  await AdSyncRunsRepository.record({ trigger: "manual", platformResults });

  if (platformResults.length === 0) {
    return NextResponse.json({
      results: [],
      message: "No ad platform APIs configured — set META_MAIN_ACCESS_TOKEN/META_KSA_ACCESS_TOKEN, GOOGLE_ADS_*, TIKTOK_ACCESS_TOKEN, or SNAP_ACCESS_TOKEN in .env.",
    });
  }

  return NextResponse.json({ results: platformResults });
}
