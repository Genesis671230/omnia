import Link from "next/link";
import { MessageCircle, Mail } from "lucide-react";
import { ALL_PAGES, pageUrl } from "@/lib/ramza/pages";
import { Wordmark } from "./wordmark";
import { BrandMark, type BrandKey } from "./brand-marks";
import { Skyline } from "./skyline";

/* The footer is the last thing a sceptical finance person reads, so it does
   three jobs: repeat what RAMZA is in one sentence, show the stack it plugs
   into one more time, and make contact a single tap on a phone. Ruled paper
   and the skyline close the page on the same motifs the hero opened with. */

const SUPPORTED: BrandKey[] = [
  "tabby",
  "tamara",
  "telr",
  "stripe",
  "checkout",
  "shopify",
  "woocommerce",
  "zoho",
];

const NAV: { label: string; href: string }[] = [
  { label: "How it works", href: "#how-it-works" },
  { label: "What it produces", href: "#outcomes" },
  { label: "Integrations", href: "#integrations" },
  { label: "Pricing", href: "#pricing" },
  { label: "Questions", href: "#faq" },
];

export function Footer({
  whatsappHref,
  email,
  legalLine,
}: {
  whatsappHref: string;
  email: string;
  legalLine: string;
}) {
  const year = new Date().getFullYear();

  return (
    <footer className="relative mt-8 overflow-hidden border-t r-hairline">
      <Skyline className="pointer-events-none absolute inset-x-0 top-0 h-20 w-full opacity-40" />
      <div
        aria-hidden
        className="r-ruled pointer-events-none absolute inset-0 opacity-40"
      />

      <div className="relative z-[1] mx-auto w-full max-w-6xl px-5 pt-24 pb-10">
        {/* identity + contact */}
        <div className="grid gap-10 lg:grid-cols-[1.25fr_1fr] lg:gap-16">
          <div>
            <Wordmark />
            <p
              className="mt-4 max-w-sm text-[0.9375rem] leading-relaxed"
              style={{ color: "var(--ink-60)" }}
            >
              Payout reconciliation for UAE and KSA e-commerce. Every gateway
              payout matched to the bank, fees and VAT split out, invoices closed
              in your books.
            </p>

            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="r-btn r-btn-outline !h-11 !px-4 !text-sm"
              >
                <MessageCircle className="size-4" aria-hidden />
                Chat on WhatsApp
              </a>
              <a
                href={`mailto:${email}`}
                className="r-btn r-btn-outline !h-11 !px-4 !text-sm"
              >
                <Mail className="size-4" aria-hidden />
                {email}
              </a>
            </div>
          </div>

          <nav aria-label="Footer">
            <h2
              className="text-xs font-semibold uppercase tracking-[0.14em]"
              style={{ color: "var(--ink-40)" }}
            >
              On this page
            </h2>
            <ul className="mt-2 grid grid-cols-2 gap-x-6">
              {NAV.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    className="inline-flex min-h-11 items-center text-[0.9375rem] transition-colors hover:text-[var(--brand)]"
                    style={{ color: "var(--ink-60)" }}
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>

            <a
              href="#audit"
              className="r-btn r-btn-primary mt-7 !h-11 w-full !px-5 !text-sm sm:w-auto"
            >
              Get a free payout audit
            </a>
          </nav>
        </div>

        {/* Every content page, from the registry.
            A footer link is the one inbound link every page on the site gives
            every other page, and until now these twelve had none at all — they
            rendered, they were in the sitemap, and nothing linked to them. */}
        <nav aria-label="All pages" className="mt-12 border-t r-hairline pt-8">
          <h2
            className="text-xs font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--ink-40)" }}
          >
            All pages
          </h2>
          <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
            {ALL_PAGES.map((p) => (
              <li key={p.path}>
                <Link
                  href={pageUrl(p)}
                  className="inline-flex min-h-9 items-center text-[0.875rem] transition-colors hover:text-[var(--brand)]"
                  style={{ color: "var(--ink-60)" }}
                >
                  {p.crumb}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* the stack, one last time */}
        <div className="mt-12 border-t r-hairline pt-8">
          <h2
            className="text-xs font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--ink-40)" }}
          >
            Reads and posts to
          </h2>
          <div className="r-logo-rail mt-4">
            {SUPPORTED.map((b) => (
              <BrandMark key={b} brand={b} size="sm" />
            ))}
          </div>
        </div>

        {/* legal */}
        <div
          className="mt-10 flex flex-col gap-3 border-t r-hairline pt-6 text-[0.8125rem] sm:flex-row sm:items-center sm:justify-between"
          style={{ color: "var(--ink-40)" }}
        >
          <p>
            &copy; {year} RAMZA. {legalLine}
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a
              href="/privacy"
              className="-mx-1 inline-flex min-h-11 min-w-11 items-center justify-center px-1 transition-colors hover:text-[var(--brand)]"
            >
              Privacy
            </a>
            <span>
              Product and partner names are the trademarks of their respective
              owners.
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
