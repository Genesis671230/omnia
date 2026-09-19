/* Single source of truth for RAMZA's public identity.
   Every canonical URL, sitemap entry, breadcrumb and JSON-LD node derives from
   here, so they cannot drift apart the way hand-maintained SEO wiring does. */

/* Trailing slash stripped once, here, rather than at every call site. */
export const RAMZA_ORIGIN = (
  process.env.NEXT_PUBLIC_RAMZA_ORIGIN || "https://ramza.ai"
).replace(/\/+$/, "");

export const RAMZA_EMAIL = process.env.NEXT_PUBLIC_RAMZA_EMAIL || "hello@ramza.ai";
export const RAMZA_LEGAL_LINE = process.env.LEGAL_LINE || "Lexoro Solutions LLC";

export const BRAND = {
  name: "RAMZA",
  legalName: RAMZA_LEGAL_LINE,
  tagline: "Payout reconciliation for Gulf e-commerce",
  /* Kept short enough to survive SERP truncation at ~60 chars once the page
     title is prepended. */
  suffix: "RAMZA",
} as const;

/* Absolute URL for a path relative to the site root. Accepts "/ramza",
   "ramza", or a already-absolute URL (returned untouched). */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${RAMZA_ORIGIN}${clean}`;
}

/* Every RAMZA content page lives under /ramza/<path>. One helper so the prefix
   is never spelled out by hand. */
export function ramzaPath(path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, "");
  return clean ? `/ramza/${clean}` : "/ramza";
}
