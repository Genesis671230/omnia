import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Section, SectionHeading } from "./ui/section";
import { ALL_PAGES, pageUrl, type PageFamily, type RamzaPage } from "@/lib/ramza/pages";

/* The twelve content pages, linked from the home page.
 *
 * They already existed, already rendered, and were already in the sitemap —
 * and nothing on this site linked to any of them. A page with no inbound link
 * from its own home page is invisible twice over: a visitor has no path to it,
 * and a crawler treats it as an orphan, which is the most common reason a new
 * page family never ranks. The registry's integrity check catches pages that
 * no OTHER content page links to; it had no way to notice that the home page
 * linked to none of them.
 *
 * Built from ALL_PAGES rather than a hand-kept list, so a page cannot ship
 * without appearing here. */

const FAMILIES: { key: PageFamily; label: string; blurb: string }[] = [
  {
    key: "reconciliation",
    label: "By gateway",
    blurb: "How each payout file actually settles, and what it takes to close it.",
  },
  {
    key: "vs",
    label: "Compared",
    blurb: "Where the alternatives hold up, and where they stop.",
  },
  {
    key: "market",
    label: "By market",
    blurb: "VAT, currency and the rules that differ once you cross a border.",
  },
  {
    key: "guide",
    label: "Guides",
    blurb: "The mechanics, written out, whether or not you ever use RAMZA.",
  },
];

function FamilyColumn({ label, blurb, pages }: { label: string; blurb: string; pages: RamzaPage[] }) {
  if (pages.length === 0) return null;
  return (
    <div>
      <h3 className="text-[0.6875rem] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--ink-40)" }}>
        {label}
      </h3>
      <p className="mt-2 text-[0.8125rem] leading-relaxed" style={{ color: "var(--ink-60)" }}>
        {blurb}
      </p>
      <ul className="mt-4 space-y-1">
        {pages.map((p) => (
          <li key={p.path}>
            <Link
              href={pageUrl(p)}
              className="group inline-flex items-start gap-1.5 py-1 text-[0.9375rem] leading-snug transition-colors"
              style={{ color: "var(--ink)" }}
            >
              <span className="r-library-link">{p.crumb}</span>
              <ArrowUpRight
                aria-hidden
                className="mt-[3px] size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Library() {
  const byFamily = new Map<PageFamily, RamzaPage[]>();
  for (const p of ALL_PAGES) {
    const list = byFamily.get(p.family) ?? [];
    list.push(p);
    byFamily.set(p.family, list);
  }

  return (
    <Section id="library">
      <SectionHeading>Written up, in detail</SectionHeading>
      <p className="r-lead r-measure mt-4" style={{ color: "var(--ink-60)" }}>
        {ALL_PAGES.length} pages on how payout reconciliation actually works, gateway by
        gateway and market by market. No sign-up, no gate.
      </p>

      <div className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {FAMILIES.map((f) => (
          <FamilyColumn
            key={f.key}
            label={f.label}
            blurb={f.blurb}
            pages={byFamily.get(f.key) ?? []}
          />
        ))}
      </div>
    </Section>
  );
}
