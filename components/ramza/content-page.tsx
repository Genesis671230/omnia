import Link from "next/link";
import { ChevronRight, MessageCircle } from "lucide-react";
import { RamzaShell } from "./ramza-shell";
import { Nav } from "./nav";
import { Footer } from "./footer";
import { CtaLink } from "./ui/cta-button";
import { PageSections } from "./page-sections";
import { relatedPages } from "@/lib/ramza/pages";
import type { RamzaPage } from "@/lib/ramza/pages/types";
import { ramzaPath, RAMZA_EMAIL, RAMZA_LEGAL_LINE } from "@/lib/ramza/site";
import { CTA_PRIMARY, CTA_SECONDARY } from "@/lib/ramza/copy";

/* The shell every /ramza/* content page renders into.

   Breadcrumbs are not decoration here: the landing page had exactly one
   internal link on the whole site, and a page family that does not link to
   itself does not rank. Every page links up to /ramza and across to its
   related pages, and the registry asserts none is orphaned. */

export function ContentPage({
  page,
  whatsappHref,
}: {
  page: RamzaPage;
  whatsappHref: string;
}) {
  const related = relatedPages(page);

  return (
    <RamzaShell>
      <Nav whatsappHref={whatsappHref} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-24 pt-10 sm:pt-16">
        <nav aria-label="Breadcrumb" className="r-crumbs">
          <Link href={ramzaPath("")}>RAMZA</Link>
          <ChevronRight size={13} aria-hidden />
          <span aria-current="page">{page.crumb}</span>
        </nav>

        <header className="mt-6">
          <h1 className="r-h1">{page.h1}</h1>
          <p className="r-lead mt-5" style={{ color: "var(--ink-60)" }}>
            {page.lead}
          </p>
        </header>

        <PageSections sections={page.sections} />

        {page.faq.length > 0 && (
          <section className="r-pagesection">
            <h2 className="r-h2">Questions</h2>
            <dl className="r-faq mt-6">
              {page.faq.map((f) => (
                <div key={f.q}>
                  <dt>{f.q}</dt>
                  <dd>{f.a}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* Sources are shown, not buried. Every claim about a competitor or a
            regulator on this site carries one, with the date it was checked,
            because a stale comparison is worse than no comparison. */}
        {page.citations && page.citations.length > 0 && (
          <section className="r-pagesection">
            <h2 className="r-h3">Sources</h2>
            <ol className="r-sources mt-4">
              {page.citations.map((c, i) => (
                <li key={i}>
                  <span>{c.claim}</span>
                  <a href={c.url} target="_blank" rel="noopener noreferrer nofollow">
                    {c.source}
                  </a>
                  <span className="r-sources-date r-nums">checked {c.checked}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="r-pagecta">
          <h2 className="r-h3">See it against your own month</h2>
          <p className="r-steps-b mt-2">
            Send one month of payout files and a bank statement. We reconcile it and
            show you what did not tie out, before you decide anything.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <CtaLink href={`${ramzaPath("")}#audit`}>{CTA_PRIMARY}</CtaLink>
            <CtaLink
              href={whatsappHref}
              variant="outline"
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle className="size-4" />
              {CTA_SECONDARY}
            </CtaLink>
          </div>
        </section>

        {related.length > 0 && (
          <section className="r-pagesection">
            <h2 className="r-h3">Related</h2>
            <ul className="r-related mt-4">
              {related.map((r) => (
                <li key={r.path}>
                  <Link href={ramzaPath(r.path)}>
                    <span className="r-related-t">{r.crumb}</span>
                    <span className="r-related-d">{r.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="r-updated r-nums">Last reviewed {page.updated}</p>
      </main>

      <Footer whatsappHref={whatsappHref} email={RAMZA_EMAIL} legalLine={RAMZA_LEGAL_LINE} />
    </RamzaShell>
  );
}
