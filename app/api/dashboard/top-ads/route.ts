import { NextResponse } from "next/server";
import { fetchMetaExplorer } from "@/lib/integrations/ads/meta-explorer";
import { metaConfigured } from "@/lib/integrations/ads/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/dashboard/top-ads?from=&to= → { ads } — the Meta ads that drove the
// most purchase value in the range, with their creative. Pixel-reported value
// (what Meta attributes), not counted store sales. Explorer is cached 15 min.
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  if (!metaConfigured()) return NextResponse.json({ ads: [], error: "Meta isn't connected" });
  const sp = new URL(request.url).searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!DAY.test(from) || !DAY.test(to)) return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
  try {
    const data = await fetchMetaExplorer(from, to);
    const campaign = new Map(data.campaigns.map((c) => [c.id, c]));
    const ads = data.ads
      .filter((a) => a.metrics.value > 0 || a.metrics.purchases > 0)
      .sort((a, b) => b.metrics.value - a.metrics.value)
      .slice(0, 6)
      .map((a) => ({
        id: a.id, name: a.name, status: a.status,
        campaign: campaign.get(a.campaignId)?.name ?? "", store: campaign.get(a.campaignId)?.store ?? "",
        image: a.creative.imageUrl || a.creative.thumbnailUrl, type: a.creative.type, title: a.creative.title,
        spend: Math.round(a.metrics.spend), value: Math.round(a.metrics.value), purchases: a.metrics.purchases,
        roas: a.metrics.roas, ctr: a.metrics.ctr,
      }));
    const total = data.ads.reduce((s, a) => s + a.metrics.value, 0);
    return NextResponse.json({ ads, totalValue: Math.round(total) });
  } catch (e) {
    return NextResponse.json({ ads: [], error: (e as Error).message }, { status: 502 });
  }
}
