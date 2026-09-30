import { NextResponse } from "next/server";
import { adRangeFor } from "@/lib/ads-range";
import { fetchMetaExplorer } from "@/lib/integrations/ads/meta-explorer";
import { trackingCheck } from "@/lib/integrations/ads/tracking-check";
import { metaConfigured } from "@/lib/integrations/ads/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/ads/explorer?range=7d|14d|30d|mtd[&fresh=1]
//   → Meta campaigns / ad sets / ads with creatives and performance, the
//     account's daily, hourly and age × gender breakdowns, and the tracking
//     check (pixels + site tags). Read live from Meta, cached 15 min.

export async function GET(request: Request) {
  if (!metaConfigured()) return NextResponse.json({ error: "Meta isn't connected — add META_MAIN_ACCESS_TOKEN and META_MAIN_AD_ACCOUNT_IDS." }, { status: 503 });
  const url = new URL(request.url);
  const { key, from, to } = adRangeFor(url.searchParams.get("range") ?? "7d");
  try {
    const [data, tracking] = await Promise.all([
      fetchMetaExplorer(from, to, { fresh: url.searchParams.get("fresh") === "1" }),
      trackingCheck(),
    ]);
    return NextResponse.json({ ...data, rangeKey: key, tracking });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
