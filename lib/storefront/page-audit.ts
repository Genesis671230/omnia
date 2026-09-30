// What a shopper actually gets on a storefront page, read from its HTML:
// load weight, the buy box (price, add to cart, BNPL, WhatsApp), trust
// signals (reviews, delivery, returns), image hygiene and the visible copy.
// Pure extraction (auditHtml) + one fetch (auditPage) — the AI roast reads
// these facts, never guesses them.

import { allowedStorefrontUrl } from "./sites";

export type PageAudit = {
  url: string;
  /** Set when the page asked for redirected somewhere else (a product 301 → homepage is a dead ad click). */
  redirectedFrom: string | null;
  status: number;
  fetchMs: number;
  htmlKb: number;
  title: string;
  metaDescription: string;
  h1: string[];
  lang: string;
  isProductPage: boolean;
  price: string | null;
  compareAtPrice: string | null;
  hasAddToCart: boolean;
  hasBuyNow: boolean;
  bnpl: string[];
  hasWhatsApp: boolean;
  hasReviews: boolean;
  reviewCount: number | null;
  mentionsDelivery: boolean;
  mentionsReturns: boolean;
  mentionsCod: boolean;
  hasSizeOrVariantPicker: boolean;
  images: number;
  imagesWithoutAlt: number;
  lazyImages: number;
  scripts: number;
  thirdPartyScriptHosts: string[];
  popups: string[];
  productImages: string[];
  visibleText: string;
};

const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const has = (re: RegExp, s: string) => re.test(s);

export function auditHtml(url: string, html: string, meta: { status: number; fetchMs: number }): PageAudit {
  const lower = html.toLowerCase();
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const text = strip(body);
  const textLower = text.toLowerCase();

  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
  const hosts = new Set<string>();
  const pageHost = new URL(url).hostname;
  for (const s of scripts) {
    const src = /src=["']([^"']+)["']/i.exec(s)?.[1];
    if (!src) continue;
    try {
      const h = new URL(src, url).hostname;
      if (h !== pageHost && !h.endsWith("shopify.com") && !h.endsWith("shopifycdn.com")) hosts.add(h);
    } catch { /* relative junk */ }
  }

  // Shopify themes print the product JSON-LD; price and reviews come from it when present.
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join(" ");
  const ldPrice = /"price"\s*:\s*"?([\d.,]+)"?/.exec(ld)?.[1] ?? null;
  const ldReviews = /"reviewCount"\s*:\s*"?(\d+)"?/.exec(ld)?.[1];
  const ogImages = [...html.matchAll(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi)].map((m) => m[1]);

  const popups: string[] = [];
  if (has(/klaviyo/, lower)) popups.push("Klaviyo");
  if (has(/privy|justuno|optinmonster|popup/, lower)) popups.push("popup script");
  if (has(/spin[- ]?(to|the)[- ]?win|wheelio/, lower)) popups.push("spin-to-win");

  const bnpl = ["tabby", "tamara", "postpay", "cashew", "spotii"].filter((b) => has(new RegExp(b), lower));

  return {
    url,
    redirectedFrom: null,
    status: meta.status,
    fetchMs: meta.fetchMs,
    htmlKb: Math.round(html.length / 1024),
    title: strip(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ""),
    metaDescription: /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? "",
    h1: [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => strip(m[1])).filter(Boolean).slice(0, 3),
    lang: /<html[^>]+lang=["']([^"']+)["']/i.exec(html)?.[1] ?? "",
    isProductPage: /\/products\//.test(new URL(url).pathname),
    price: ldPrice,
    compareAtPrice: /compare[_-]?at[_-]?price[^\d]{0,40}([\d.,]+)/i.exec(html)?.[1] ?? null,
    hasAddToCart: has(/add[ _-]?to[ _-]?(cart|bag)|name=["']add["']|أضف إلى السلة|اضف الى السلة/i, html),
    hasBuyNow: has(/buy (it )?now|shopify-payment-button|اشتر(ي)? الآن/i, html),
    bnpl,
    hasWhatsApp: has(/wa\.me|api\.whatsapp|whatsapp/i, lower),
    hasReviews: Boolean(ldReviews) || has(/judge\.me|jdgm|loox|yotpo|stamped|okendo|reviews?\.io|aggregateRating/i, html),
    reviewCount: ldReviews ? Number(ldReviews) : null,
    mentionsDelivery: has(/deliver|shipping|توصيل|شحن/i, textLower),
    mentionsReturns: has(/return|refund|exchange|استرجاع|استبدال/i, textLower),
    mentionsCod: has(/cash on delivery|\bcod\b|الدفع عند الاستلام/i, textLower),
    hasSizeOrVariantPicker: has(/variant-(radios|picker|selects)|<select[^>]+(option|variant)|product-form__input/i, html),
    images: imgs.length,
    imagesWithoutAlt: imgs.filter((i) => !/\balt=["'][^"']+["']/i.test(i)).length,
    lazyImages: imgs.filter((i) => /loading=["']lazy["']/i.test(i)).length,
    scripts: scripts.length,
    thirdPartyScriptHosts: [...hosts].slice(0, 25),
    popups,
    productImages: [...new Set(ogImages.map((s) => (s.startsWith("//") ? `https:${s}` : s.replace(/^http:/, "https:"))))].slice(0, 3),
    visibleText: text.slice(0, 6000),
  };
}

export async function auditPage(rawUrl: string): Promise<PageAudit> {
  const url = allowedStorefrontUrl(rawUrl);
  if (!url) throw new Error("Only omniastores.com, omniastores.ae and sa.omniastores.ae pages can be audited.");
  const started = Date.now();
  const res = await fetch(url.href, {
    headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" },
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
  });
  const html = await res.text();
  const finalUrl = res.url || url.href;
  const audit = auditHtml(finalUrl, html, { status: res.status, fetchMs: Date.now() - started });
  const moved = new URL(finalUrl).pathname.replace(/\/$/, "") !== url.pathname.replace(/\/$/, "");
  return moved ? { ...audit, redirectedFrom: url.href, isProductPage: /\/products\//.test(url.pathname) } : audit;
}
