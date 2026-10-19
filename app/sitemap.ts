import type { MetadataRoute } from "next";
import { ALL_PAGES, HUBS, pagesInFamily } from "@/lib/ramza/pages";
import { absoluteUrl, ramzaPath } from "@/lib/ramza/site";
import { ogImagePath } from "@/lib/ramza/seo";

/* Derived from the page registry rather than hand-maintained, so a page can
   never be live but missing from the sitemap (or listed here after being
   removed). The private Omnia app routes are deliberately absent — they are
   session-gated in middleware.ts and have nothing to offer a crawler. */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const landing: MetadataRoute.Sitemap = [
    {
      url: absoluteUrl(ramzaPath("")),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];

  /* Corporate Tax penalty pages (static routes, not in the registry). */
  const ctPaths = [
    "penalty-checker", "corporate-tax-penalties", "reconsideration",
    "late-registration-waiver", "services", "contact", "payout-reconciliation", "reconcile", "brand",
  ];
  landing.push(...ctPaths.map((p) => ({
    url: absoluteUrl(ramzaPath(p)),
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: p === "penalty-checker" ? 0.95 : p === "brand" ? 0.3 : 0.85,
  })));

  /* Commercial-intent pages outrank explainers in priority, matching how we
     actually want crawl budget spent. */
  const priorityFor = (family: string) =>
    family === "reconciliation" ? 0.9 : family === "vs" ? 0.8 : family === "market" ? 0.8 : 0.6;

  const pages: MetadataRoute.Sitemap = ALL_PAGES.map((page) => ({
    url: absoluteUrl(ramzaPath(page.path)),
    lastModified: new Date(page.updated),
    changeFrequency: "monthly" as const,
    priority: priorityFor(page.family),
  }));

  /* Hubs change whenever a page in them does, so their lastModified is the
     newest page's — never "now", which teaches crawlers to ignore the field. */
  const hubs: MetadataRoute.Sitemap = HUBS.map((hub) => {
    const newest = pagesInFamily(hub.family).map((p) => p.updated).sort().at(-1);
    return {
      url: absoluteUrl(ramzaPath(hub.path)),
      lastModified: newest ? new Date(newest) : now,
      changeFrequency: "weekly" as const,
      priority: 0.85,
    };
  });

  /* Image entries: each content page's generated social card, so the cards
     can surface in image search alongside the page. */
  ALL_PAGES.forEach((page, i) => { pages[i].images = [absoluteUrl(ogImagePath(page.path))]; });

  return [...landing, ...hubs, ...pages];
}
