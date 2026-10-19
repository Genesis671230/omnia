import type { Metadata } from "next";
import { RAMZA_ORIGIN, absoluteUrl } from "@/lib/ramza/site";

/* Metadata for the RAMZA Corporate Tax pages. `path` is the site path, e.g.
   "/ramza/reconsideration". Titles are absolute so the omnia app's
   "%s · Omnia Finance OS" template never gets appended. */
export function ctMetadata(path: string, title: string, description: string): Metadata {
  const url = absoluteUrl(path);
  return {
    metadataBase: new URL(RAMZA_ORIGIN),
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { title, description, type: "website", url, siteName: "RAMZA", locale: "en_AE" },
    twitter: { card: "summary_large_image", title, description },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    },
  };
}
