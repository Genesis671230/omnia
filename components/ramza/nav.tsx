"use client";

import { useEffect, useState } from "react";
import { MessageCircle, Menu, X } from "lucide-react";
import { Wordmark } from "./wordmark";
import { CTA_PRIMARY } from "@/lib/ramza/copy";

const LINKS = [
  { label: "How it works", href: "#how-it-works" },
  { label: "What it produces", href: "#outcomes" },
  { label: "Integrations", href: "#integrations" },
  { label: "Pricing", href: "#pricing" },
  { label: "Questions", href: "#faq" },
];

export function Nav({ whatsappHref }: { whatsappHref: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Below md the link row was simply hidden, which left phone visitors with no
     way to reach any section but the one under their thumb. The disclosure
     below gives them the same five destinations. */
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const solid = scrolled || menuOpen;

  return (
    <header
      className="sticky top-0 z-40 transition-all"
      style={{
        background: solid
          ? "color-mix(in srgb, var(--paper) 82%, transparent)"
          : "transparent",
        backdropFilter: solid ? "blur(18px) saturate(1.6)" : "none",
        WebkitBackdropFilter: solid ? "blur(18px) saturate(1.6)" : "none",
        borderBottom: solid ? "1px solid var(--glass-border)" : "1px solid transparent",
      }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-2.5">
        <a href="#top" aria-label="RAMZA home" className="inline-flex min-h-11 items-center">
          <Wordmark />
        </a>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Sections">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm transition-colors hover:text-[var(--brand)]"
              style={{ color: "var(--ink-60)" }}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a href="#audit" className="r-btn r-btn-primary !h-11 !px-4 !text-sm">
            <span className="hidden sm:inline">{CTA_PRIMARY}</span>
            <span className="sm:hidden">Free audit</span>
          </a>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Chat on WhatsApp"
            className="hidden size-11 items-center justify-center rounded-lg border r-hairline sm:inline-flex"
            style={{ color: "var(--ink)" }}
          >
            <MessageCircle className="size-4" />
          </a>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-controls="ramza-mobile-nav"
            aria-label={menuOpen ? "Close the section menu" : "Open the section menu"}
            className="inline-flex size-11 items-center justify-center rounded-lg border r-hairline md:hidden"
            style={{ color: "var(--ink)" }}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      <nav
        id="ramza-mobile-nav"
        aria-label="Sections"
        hidden={!menuOpen}
        className="border-t r-hairline md:hidden"
      >
        <ul className="mx-auto max-w-6xl px-5 py-2">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className="flex min-h-12 items-center border-b r-hairline text-[0.9375rem] last:border-b-0"
                style={{ color: "var(--ink)" }}
              >
                {l.label}
              </a>
            </li>
          ))}
          <li>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              className="flex min-h-12 items-center gap-2 text-[0.9375rem]"
              style={{ color: "var(--brand)" }}
            >
              <MessageCircle className="size-4" />
              Chat on WhatsApp
            </a>
          </li>
        </ul>
      </nav>
    </header>
  );
}
