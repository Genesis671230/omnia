import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { adRangeFor } from "@/lib/ads-range";
import { fetchStoreFunnel, fetchStoreLeakDetail } from "@/lib/integrations/shopify-analytics";
import { auditPage } from "@/lib/storefront/page-audit";
import { funnelSteps, productHandle, productLeaks } from "@/lib/storefront/funnel-leaks";
import { storefrontFor } from "@/lib/storefront/sites";
import { latestRoasts, RoastError, runSiteRoast } from "@/lib/ai/site-roast";

export const runtime = "nodejs";
export const maxDuration = 300;

// GET  /api/storefront/roast?site=ae          → the latest roasts of that site
// POST /api/storefront/roast {site, url, range} → a new AI teardown of the page,
//      stored and returned. Read-only on the store.
export async function GET(req: Request) {
  const site = storefrontFor(new URL(req.url).searchParams.get("site"));
  if (!site) return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  try {
    return NextResponse.json({ roasts: await latestRoasts(site.code) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { site?: string; url?: string; range?: string };
  const site = storefrontFor(body.site);
  if (!site) return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  const { from, to } = adRangeFor(body.range ?? "30d");
  try {
    const [page, funnel, detail] = await Promise.all([
      auditPage(body.url || site.origin),
      fetchStoreFunnel(site.storeCode, from, to),
      fetchStoreLeakDetail(site.storeCode, from, to),
    ]);
    const leaks = detail.status === "ok" ? productLeaks(detail.landingPages) : [];
    const handle = productHandle(new URL(page.redirectedFrom ?? page.url).pathname);
    const result = await runSiteRoast({
      site: site.label,
      page,
      funnel: funnel.status === "ok" ? { status: "ok", steps: funnelSteps(funnel.totals) } : { status: funnel.status, message: funnel.message },
      devices: detail.status === "ok" ? detail.devices : undefined,
      // This page's own row first, then the worst others for context.
      productLeaks: [...leaks.filter((l) => l.handle === handle), ...leaks.filter((l) => l.handle !== handle)],
      range: { from, to },
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof RoastError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof Anthropic.RateLimitError) return NextResponse.json({ error: "AI is rate-limited right now — try again in a minute." }, { status: 429 });
    if (e instanceof Anthropic.APIConnectionError) return NextResponse.json({ error: "Couldn't reach the AI service." }, { status: 502 });
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: `AI error ${e.status ?? ""}: ${e.message}` }, { status: 502 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
