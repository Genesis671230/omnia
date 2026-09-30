import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { adRangeFor } from "@/lib/ads-range";
import { fetchMetaExplorer } from "@/lib/integrations/ads/meta-explorer";
import { trackingCheck } from "@/lib/integrations/ads/tracking-check";
import { loadSalesContext } from "@/lib/orders/sales-context.server";
import { AnalystError, analystInput, latestReports, runAdsAnalyst } from "@/lib/ai/ads-analyst";

export const runtime = "nodejs";
export const maxDuration = 300;

// GET  /api/ads/analyst            → the latest reports (history)
// POST /api/ads/analyst {range}    → a new review of the ad account for the
//                                    range, stored and returned. Read-only on Meta.
// lib/ai/ads-analyst.ts.

export async function GET() {
  try {
    return NextResponse.json({ reports: await latestReports(10) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { range?: string };
  const { from, to } = adRangeFor(body.range ?? "7d");
  try {
    const [explorer, sales, tracking, history] = await Promise.all([
      fetchMetaExplorer(from, to), loadSalesContext(from, to), trackingCheck(), latestReports(1),
    ]);
    if (explorer.campaigns.length === 0) return NextResponse.json({ error: "No Meta campaigns delivered in this range." }, { status: 422 });
    const result = await runAdsAnalyst(analystInput(explorer, sales, tracking, history[0] ?? null));
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AnalystError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof Anthropic.RateLimitError) return NextResponse.json({ error: "AI is rate-limited right now — try again in a minute." }, { status: 429 });
    if (e instanceof Anthropic.APIConnectionError) return NextResponse.json({ error: "Couldn't reach the AI service." }, { status: 502 });
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: `AI error ${e.status ?? ""}: ${e.message}` }, { status: 502 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
