import { HUBS, pagesInFamily } from "@/lib/ramza/pages";
import { ramzaPath } from "@/lib/ramza/site";

/* Kept out of ct-site.ts: that file is imported by the client nav, and this
   list pulls in the whole page registry. Server components only. */

/* Footer "Guides" column: every hub, then every guide. Derived from the page
   registry so the home page — the strongest page on the site — always links
   into each topic cluster, and a new guide is linked the day it ships. */
export const CT_LEARN: { href: string; label: string }[] = [
  ...HUBS.filter((h) => h.family !== "guide").map((h) => ({ href: ramzaPath(h.path), label: h.crumb })),
  { href: ramzaPath("guides"), label: "All guides" },
  ...pagesInFamily("guide").map((p) => ({ href: ramzaPath(p.path), label: p.crumb })),
];
