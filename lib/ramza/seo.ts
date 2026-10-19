import type { Metadata } from "next";
import { BRAND, RAMZA_EMAIL, RAMZA_ORIGIN, absoluteUrl, ramzaPath } from "./site";
import type { RamzaPage } from "./pages/types";
import { hubFor, pagesInFamily, type Hub } from "./pages";

/* Metadata and structured data for every RAMZA page, derived rather than
   hand-written, so canonical tags and schema cannot drift from the content. */

/* The root layout declares `title: { template: "%s · Omnia Finance OS" }`.
   Left alone, that template appends the internal product name to every public
   marketing title — "RAMZA — Payout reconciliation … · Omnia Finance OS", which
   both brands the SERP listing wrong and pushes the title past the ~60
   characters Google will render. `absolute` is the documented opt-out and every
   RAMZA page must use it. */
/* The per-page social card (app/ramza/og/[...slug]/route.tsx). */
export function ogImagePath(path: string): string {
  return `/ramza/og/${path.replace(/^\/+|\/+$/g, "")}.png`;
}

function ogImages(path: string, alt: string) {
  return [{ url: ogImagePath(path), width: 1200, height: 630, alt }];
}

function absoluteTitle(title: string): Metadata["title"] {
  return { absolute: title };
}

/* Canonical for the landing page is always bare /ramza. The page accepts
   ?h=money and ?h=books headline variants, and without this each variant is a
   separately indexable URL serving near-identical content — three URLs
   competing with each other for the same query. */
export function landingMetadata(): Metadata {
  const title = `${BRAND.name} — ${BRAND.tagline}`;
  const description =
    "RAMZA matches Tabby, Tamara, Telr, Stripe and COD payouts to your bank and closes invoices in Zoho Books automatically. Built for UAE and KSA stores.";

  return {
    metadataBase: new URL(RAMZA_ORIGIN),
    title: absoluteTitle(title),
    description,
    alternates: { canonical: ramzaPath("") },
    openGraph: {
      title,
      description,
      type: "website",
      url: absoluteUrl(ramzaPath("")),
      siteName: BRAND.name,
      locale: "en_AE",
    },
    twitter: { card: "summary_large_image", title, description },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    },
  };
}

export function pageMetadata(page: RamzaPage): Metadata {
  const url = absoluteUrl(ramzaPath(page.path));

  return {
    metadataBase: new URL(RAMZA_ORIGIN),
    title: absoluteTitle(page.title),
    description: page.description,
    alternates: { canonical: ramzaPath(page.path) },
    openGraph: {
      title: page.title,
      description: page.description,
      url,
      siteName: BRAND.name,
      locale: "en_AE",
      images: ogImages(page.path, page.h1),
      ...(page.family === "guide"
        ? { type: "article" as const, modifiedTime: page.updated, publishedTime: page.updated }
        : { type: "website" as const }),
    },
    twitter: { card: "summary_large_image", title: page.title, description: page.description, images: [ogImagePath(page.path)] },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    },
  };
}

export function hubMetadata(hub: Hub): Metadata {
  const url = absoluteUrl(ramzaPath(hub.path));
  return {
    metadataBase: new URL(RAMZA_ORIGIN),
    title: absoluteTitle(hub.title),
    description: hub.description,
    alternates: { canonical: ramzaPath(hub.path) },
    openGraph: { title: hub.title, description: hub.description, type: "website", url, siteName: BRAND.name, locale: "en_AE", images: ogImages(hub.path, hub.h1) },
    twitter: { card: "summary_large_image", title: hub.title, description: hub.description, images: [ogImagePath(hub.path)] },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    },
  };
}

/* --- JSON-LD ----------------------------------------------------------- */

/* Stable @id values so nodes reference each other instead of repeating
   themselves — how Google prefers a knowledge graph to be expressed. */
const ORG_ID = `${RAMZA_ORIGIN}/#organization`;
const SITE_ID = `${RAMZA_ORIGIN}/#website`;

export function organizationNode() {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: BRAND.name,
    legalName: BRAND.legalName,
    url: absoluteUrl(ramzaPath("")),
    /* The agent mark. Google wants a square raster ≥112px for the knowledge
       panel; SVG is not accepted there. */
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl("/ramza/brand/ramza-agent-512.png"),
      width: 512,
      height: 512,
    },
    image: absoluteUrl("/ramza/brand/ramza-agent-on-light-1024.png"),
    email: RAMZA_EMAIL,
    description:
      "Payout reconciliation for Gulf e-commerce. Matches gateway payouts to the bank and closes invoices in Zoho Books.",
    areaServed: [
      { "@type": "Country", name: "United Arab Emirates" },
      { "@type": "Country", name: "Saudi Arabia" },
    ],
  };
}

export function websiteNode() {
  return {
    "@type": "WebSite",
    "@id": SITE_ID,
    url: absoluteUrl(ramzaPath("")),
    name: BRAND.name,
    publisher: { "@id": ORG_ID },
    inLanguage: "en",
  };
}

/* SoftwareApplication is what makes a SaaS page eligible for the richer
   product treatment in results. No aggregateRating — inventing one is both a
   guidelines violation and a lie. */
export function softwareApplicationNode() {
  return {
    "@type": "SoftwareApplication",
    name: BRAND.name,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Accounting",
    operatingSystem: "Web",
    url: absoluteUrl(ramzaPath("")),
    publisher: { "@id": ORG_ID },
    description:
      "Reconciles Shopify and WooCommerce orders against Tabby, Tamara, Telr, Stripe, Checkout.com and COD payouts, matches them to the bank statement, and posts payments, gateway fees and VAT to Zoho Books.",
    featureList: [
      "Gateway payout to bank statement matching",
      "AED and SAR FX difference handling",
      "Automatic payment posting to Zoho Books",
      "Gateway fee and VAT-on-fee journal entries",
      "Refund and chargeback reopening",
    ],
  };
}

export function faqNode(faq: { q: string; a: string }[]) {
  return {
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/* Breadcrumbs give Google the site hierarchy explicitly and render as the
   path line in results instead of a raw URL. */
export function breadcrumbNode(page: { crumb: string; path: string; family?: RamzaPage["family"] }) {
  const hub = page.family ? hubFor(page.family) : undefined;
  const trail = [
    { name: BRAND.name, url: absoluteUrl(ramzaPath("")) },
    ...(hub && hub.path !== page.path ? [{ name: hub.crumb, url: absoluteUrl(ramzaPath(hub.path)) }] : []),
    { name: page.crumb, url: absoluteUrl(ramzaPath(page.path)) },
  ];

  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function landingJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [organizationNode(), websiteNode(), softwareApplicationNode()],
  };
}

export function pageJsonLd(page: RamzaPage) {
  const graph: object[] = [organizationNode(), websiteNode(), breadcrumbNode(page)];

  if (page.faq.length) graph.push(faqNode(page.faq));

  const url = absoluteUrl(ramzaPath(page.path));
  if (page.family === "guide") {
    graph.push({
      "@type": "Article",
      "@id": `${url}#article`,
      headline: page.h1,
      description: page.description,
      datePublished: page.updated,
      dateModified: page.updated,
      image: absoluteUrl(ogImagePath(page.path)),
      author: { "@id": ORG_ID },
      publisher: { "@id": ORG_ID },
      isPartOf: { "@id": SITE_ID },
      mainEntityOfPage: url,
      inLanguage: "en",
      ...(page.citations?.length ? { citation: page.citations.map((c) => c.url) } : {}),
    });
  } else {
    graph.push({
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: page.title,
      description: page.description,
      dateModified: page.updated,
      isPartOf: { "@id": SITE_ID },
      primaryImageOfPage: absoluteUrl(ogImagePath(page.path)),
      inLanguage: "en",
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

/* A hub is a CollectionPage whose ItemList is the family, in registry order —
   the explicit "these pages belong together" signal for a topic cluster. */
export function hubJsonLd(hub: Hub) {
  const url = absoluteUrl(ramzaPath(hub.path));
  const pages = pagesInFamily(hub.family);
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationNode(),
      websiteNode(),
      breadcrumbNode(hub),
      {
        "@type": "CollectionPage",
        "@id": `${url}#webpage`,
        url,
        name: hub.title,
        description: hub.description,
        isPartOf: { "@id": SITE_ID },
        inLanguage: "en",
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: pages.length,
          itemListElement: pages.map((p, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: absoluteUrl(ramzaPath(p.path)),
            name: p.crumb,
          })),
        },
      },
    ],
  };
}
