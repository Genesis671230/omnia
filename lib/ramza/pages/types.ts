/* The content model behind every RAMZA sub-page.

   The model owns everything mechanical: canonical URLs, breadcrumbs, JSON-LD,
   the cross-link graph and the sitemap all derive from these objects, so a page
   cannot ship orphaned, uncanonicalised, or missing from the sitemap.

   It deliberately does NOT own the prose. Every string below is hand-written
   for its page. There is no template interpolation, because thin templated
   pages rank worse than no pages at all on a site with no domain authority. */

export type PageFamily = "reconciliation" | "vs" | "market" | "guide";

/* A claim that came from outside RAMZA's own product — a competitor's feature
   list, a regulator's rule, a gateway's published fee schedule.

   Every such claim on the site carries one of these. `checked` is the date a
   human last confirmed the source still says this, because competitor pages rot
   silently and a stale comparison is worse than none. Rendered as a visible
   Sources block, not just buried in markup. */
export type Citation = {
  /* What we assert, in the words used on the page. */
  claim: string;
  /* Who says so — "Synder integrations directory", "UAE Federal Tax Authority". */
  source: string;
  url: string;
  /* ISO date the source was last verified. */
  checked: string;
};

/* Section shapes. A closed union rather than free-form blocks: each page is
   assembled from known shapes so the renderer stays type-safe and the visual
   language stays consistent across all 25 pages. */
export type PageSection =
  | { kind: "prose"; heading: string; body: string[] }
  | {
      kind: "steps";
      heading: string;
      intro?: string;
      steps: { title: string; body: string }[];
    }
  | {
      kind: "table";
      heading: string;
      intro?: string;
      columns: string[];
      rows: string[][];
      footnote?: string;
    }
  | {
      kind: "compare";
      heading: string;
      intro?: string;
      /* Honest side-by-side. `verdict` may be "them" — a comparison page that
         never concedes a point reads as marketing and converts worse. */
      rows: {
        dimension: string;
        ramza: string;
        other: string;
        verdict: "ramza" | "other" | "even";
      }[];
      footnote?: string;
    }
  | { kind: "callout"; tone: "note" | "caution"; heading: string; body: string }
  | {
      kind: "checklist";
      heading: string;
      intro?: string;
      items: { title: string; body: string; state: "yes" | "no" | "partial" }[];
    };

export type RamzaPage = {
  /* Path relative to /ramza, no leading slash: "reconciliation/tabby". */
  path: string;
  family: PageFamily;

  /* Rendered with `title: { absolute }` so the root layout's
     "%s · Omnia Finance OS" template cannot append the wrong brand. */
  title: string;
  description: string;

  /* Breadcrumb label — short, not the full title. */
  crumb: string;

  h1: string;
  lead: string;

  sections: PageSection[];
  faq: { q: string; a: string }[];

  /* Paths of related pages. The renderer links these AND the registry uses them
     to assert no page is orphaned. */
  related: string[];

  citations?: Citation[];

  /* ISO date, surfaced as dateModified in JSON-LD and shown on the page. */
  updated: string;
};
