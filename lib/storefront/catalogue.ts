// A storefront's public catalogue (Shopify's /products.json — no token), for
// real product images, prices and handles next to the funnel numbers.

import type { Storefront } from "./sites";

export type CatalogueProduct = { handle: string; title: string; price: number; compareAt: number | null; image: string | null; images: number; url: string };

const CACHE_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; value: CatalogueProduct[] }>();

export async function fetchCatalogue(site: Storefront, limit = 250): Promise<CatalogueProduct[]> {
  const hit = cache.get(site.code);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const res = await fetch(`${site.origin}/products.json?limit=${limit}`, {
    headers: { "User-Agent": "Mozilla/5.0 (OmniaOS storefront audit)", Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${site.label} /products.json HTTP ${res.status}`);
  const json = (await res.json()) as { products?: Record<string, unknown>[] };
  const value = (json.products ?? []).map((p) => {
    const variants = (p.variants ?? []) as { price?: string; compare_at_price?: string | null }[];
    const images = (p.images ?? []) as { src?: string }[];
    const compare = Number(variants[0]?.compare_at_price ?? 0);
    return {
      handle: String(p.handle),
      title: String(p.title ?? ""),
      price: Number(variants[0]?.price ?? 0),
      compareAt: compare > 0 ? compare : null,
      image: images[0]?.src ? `${images[0].src.split("?")[0]}?width=240` : null,
      images: images.length,
      url: `${site.origin}/products/${p.handle}`,
    };
  });
  cache.set(site.code, { at: Date.now(), value });
  return value;
}
