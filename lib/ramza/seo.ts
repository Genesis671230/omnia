import type { Metadata } from "next";
import { BRAND, RAMZA_EMAIL, RAMZA_ORIGIN, absoluteUrl, ramzaPath } from "./site";
import type { RamzaPage } from "./pages/types";

/* Metadata and structured data for every RAMZA page, derived rather than
   hand-written, so canonical tags and schema cannot drift from the content. */

/* The root layout declares `title: { template: "%s · Omnia Finance OS" }`.
   Left alone, that template appends the internal product name to every public
   marketing title — "RAMZA — Payout reconciliation … · Omnia Finance OS", which
   both brands the SERP listing wrong and pushes the title past the ~60
   characters Google will render. `absolute` is the documented opt-out and every
   RAMZA page must use it. */
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
      type: page.family === "guide" ? "article" : "website",
      url,
      siteName: BRAND.name,
      locale: "en_AE",
    },
    twitter: { card: "summary_large_image", title: page.title, description: page.description },
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
export function breadcrumbNode(page: RamzaPage) {
  const trail = [
    { name: BRAND.name, url: absoluteUrl(ramzaPath("")) },
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

  if (page.family === "guide") {
    graph.push({
      "@type": "Article",
      headline: page.h1,
      description: page.description,
      dateModified: page.updated,
      author: { "@id": ORG_ID },
      publisher: { "@id": ORG_ID },
      mainEntityOfPage: absoluteUrl(ramzaPath(page.path)),
      inLanguage: "en",
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}
