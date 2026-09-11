"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { Wordmark } from "./wordmark";
import { CTA_PRIMARY } from "@/lib/ramza/copy";

const LINKS = [
  { label: "How it works", href: "#how-it-works" },
  { label: "What it produces", href: "#outcomes" },
  { label: "Integrations", href: "#integrations" },
  { label: "Pricing", href: "#pricing" },
];

export function Nav({ whatsappHref }: { whatsappHref: string }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="sticky top-0 z-40 transition-all"
      style={{
        background: scrolled
          ? "color-mix(in srgb, var(--paper) 72%, transparent)"
          : "transparent",
        backdropFilter: scrolled ? "blur(16px) saturate(1.6)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(16px) saturate(1.6)" : "none",
        borderBottom: scrolled ? "1px solid var(--glass-border)" : "1px solid transparent",
      }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
        <a href="#top" aria-label="RAMZA home">
          <Wordmark />
        </a>

        <nav className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm transition-colors"
              style={{ color: "var(--ink-60)" }}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href="#audit"
            className="r-btn r-btn-primary !h-9 !px-4 !text-sm"
          >
            {CTA_PRIMARY}
          </a>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Chat on WhatsApp"
            className="inline-flex size-9 items-center justify-center rounded-lg border r-hairline"
            style={{ color: "var(--ink)" }}
          >
            <MessageCircle className="size-4" />
          </a>
        </div>
      </div>
    </header>
  );
}
