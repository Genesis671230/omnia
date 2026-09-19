import type { MetadataRoute } from "next";
import { ALL_PAGES } from "@/lib/ramza/pages";
import { absoluteUrl, ramzaPath } from "@/lib/ramza/site";

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

  return [...landing, ...pages];
}
