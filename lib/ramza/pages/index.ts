import { ramzaPath } from "../site";
import { GATEWAYS } from "./gateways";
import { COMPARISONS } from "./comparisons";
import { MARKETS } from "./markets";
import { GUIDES } from "./guides";
import type { PageFamily, RamzaPage } from "./types";

export type { RamzaPage, PageFamily, PageSection, Citation } from "./types";

/* The registry. Everything downstream — routing, sitemap, breadcrumbs,
   JSON-LD, related links — reads from this one array, so a page is either
   fully wired or absent. There is no half-registered state. */
export const ALL_PAGES: RamzaPage[] = [
  ...GATEWAYS,
  ...COMPARISONS,
  ...MARKETS,
  ...GUIDES,
];

const BY_PATH = new Map(ALL_PAGES.map((p) => [p.path, p]));

export function getPage(path: string): RamzaPage | undefined {
  return BY_PATH.get(path.replace(/^\/+|\/+$/g, ""));
}

export function pagesInFamily(family: PageFamily): RamzaPage[] {
  return ALL_PAGES.filter((p) => p.family === family);
}

/* Resolves a page's `related` paths to real pages, dropping any that don't
   exist. Callers get pages, never dangling strings. */
export function relatedPages(page: RamzaPage): RamzaPage[] {
  return page.related
    .map((p) => BY_PATH.get(p))
    .filter((p): p is RamzaPage => Boolean(p) && p!.path !== page.path);
}

/* Route params for generateStaticParams — the catch-all segment array. */
export function allPageParams(): { slug: string[] }[] {
  return ALL_PAGES.map((p) => ({ slug: p.path.split("/") }));
}

export function pageUrl(page: RamzaPage): string {
  return ramzaPath(page.path);
}

/* --- integrity checks -------------------------------------------------- */

/* The failure modes that make a multi-page site quietly underperform are all
   structural, and all detectable: a duplicate path shadowing another page, a
   `related` link pointing at nothing, or a page nothing links to. An orphaned
   page is in the sitemap but has no internal links, which is the single most
   common reason a new page family never ranks.

   Run at module load in development only — a build that ships is one where
   these already passed, and this must never cost anything in production. */
export function registryProblems(): string[] {
  const problems: string[] = [];

  const seen = new Set<string>();
  for (const page of ALL_PAGES) {
    if (seen.has(page.path)) problems.push(`duplicate path: ${page.path}`);
    seen.add(page.path);
  }

  for (const page of ALL_PAGES) {
    for (const rel of page.related) {
      if (!BY_PATH.has(rel)) {
        problems.push(`${page.path} → related "${rel}" does not exist`);
      }
    }
  }

  /* Inbound links, counting the hub links every family index provides. */
  const inbound = new Set<string>();
  for (const page of ALL_PAGES) {
    for (const rel of page.related) inbound.add(rel);
  }
  for (const page of ALL_PAGES) {
    if (!inbound.has(page.path)) {
      problems.push(`orphaned (no page links to it): ${page.path}`);
    }
  }

  return problems;
}

if (process.env.NODE_ENV === "development") {
  const problems = registryProblems();
  if (problems.length) {
    console.warn(
      `[ramza/pages] ${problems.length} registry problem(s):\n  ` +
        problems.join("\n  ")
    );
  }
}
