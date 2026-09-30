import { NextResponse } from "next/server";
import { adRangeFor } from "@/lib/ads-range";
import { fetchStoreFunnel, fetchStoreLeakDetail } from "@/lib/integrations/shopify-analytics";
import { fetchCatalogue } from "@/lib/storefront/catalogue";
import { funnelSteps, productLeaks, worstLeak } from "@/lib/storefront/funnel-leaks";
import { STOREFRONTS, storefrontFor } from "@/lib/storefront/sites";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/storefront?site=com|ae|sa&range=7d|14d|30d|mtd
// → the site's session funnel (steps + worst leak), leak by device, product
//   landing pages ranked by visitors lost before the cart (with the real
//   product photo and price from the public catalogue), and the catalogue.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const site = storefrontFor(params.get("site")) ?? STOREFRONTS[0];
  const { key, from, to } = adRangeFor(params.get("range") ?? "30d");

  const [funnel, detail, catalogue] = await Promise.all([
    fetchStoreFunnel(site.storeCode, from, to),
    fetchStoreLeakDetail(site.storeCode, from, to),
    fetchCatalogue(site).catch((e: Error) => ({ error: e.message })),
  ]);
  const products = Array.isArray(catalogue) ? catalogue : [];
  const byHandle = new Map(products.map((p) => [p.handle, p]));

  return NextResponse.json({
    site, range: { key, from, to },
    funnel: funnel.status === "ok"
      ? { status: "ok", totals: funnel.totals, steps: funnelSteps(funnel.totals), worst: worstLeak(funnel.totals), sources: funnel.sources, daily: funnel.daily }
      : funnel,
    devices: detail.status === "ok" ? detail.devices : [],
    pageTypes: detail.status === "ok"
      ? Object.values(detail.landingPages.reduce<Record<string, { type: string; sessions: number; addedToCart: number; completed: number }>>((acc, r) => {
          const t = r.type || "Other";
          acc[t] ??= { type: t, sessions: 0, addedToCart: 0, completed: 0 };
          acc[t].sessions += r.sessions; acc[t].addedToCart += r.addedToCart; acc[t].completed += r.completed;
          return acc;
        }, {})).sort((a, b) => b.sessions - a.sessions)
      : [],
    productLeaks: detail.status === "ok"
      ? productLeaks(detail.landingPages).slice(0, 25).map((p) => ({ ...p, product: byHandle.get(p.handle) ?? null }))
      : [],
    detailStatus: detail.status === "ok" ? { status: "ok" } : detail,
    catalogue: products.slice(0, 60),
    catalogueError: Array.isArray(catalogue) ? null : catalogue.error,
  });
}
