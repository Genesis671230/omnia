// The three public storefronts, the Shopify store behind each (for the
// ShopifyQL funnel) and the only hosts the preview proxy and the page audit
// will fetch — never an arbitrary URL.

export type Storefront = { code: string; label: string; origin: string; storeCode: string; currency: string };

export const STOREFRONTS: Storefront[] = [
  { code: "com", label: "omniastores.com", origin: "https://omniastores.com", storeCode: "MAIN", currency: "AED" },
  { code: "ae", label: "omniastores.ae", origin: "https://omniastores.ae", storeCode: "UAE", currency: "AED" },
  { code: "sa", label: "sa.omniastores.ae", origin: "https://sa.omniastores.ae", storeCode: "KSA", currency: "SAR" },
];

export function storefrontFor(code: string | null | undefined): Storefront | undefined {
  return STOREFRONTS.find((s) => s.code === code);
}

/** The URL if it is http(s) on one of the storefront hosts, else null. */
export function allowedStorefrontUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.replace(/^www\./, "");
    if (!STOREFRONTS.some((s) => new URL(s.origin).hostname === host)) return null;
    u.protocol = "https:";
    return u;
  } catch {
    return null;
  }
}
