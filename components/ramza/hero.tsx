import { MessageCircle } from "lucide-react";
import { CloseStatement } from "./close-statement";
import { HeroField } from "./hero-field";
import { Skyline } from "./skyline";
import { CtaLink } from "./ui/cta-button";
import { HERO_SUB, CTA_PRIMARY, CTA_SECONDARY } from "@/lib/ramza/copy";

export function Hero({ h1, whatsappHref }: { h1: string; whatsappHref: string }) {
  return (
    <section id="top" className="relative flex min-h-[86vh] flex-col justify-center overflow-hidden lg:min-h-[88vh]">
      <HeroField />

      <div className="relative mx-auto w-full max-w-6xl px-5 pt-14 pb-24 sm:pt-20 sm:pb-32">
        <div className="grid gap-10 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:gap-6">
          {/* copy — glass card */}
          <div className="r-glass relative z-[2] rounded-2xl p-6 sm:p-8 lg:-mr-10">
            <p
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium"
              style={{ borderColor: "var(--rule)", color: "var(--ink-60)" }}
            >
              <span className="size-1.5 rounded-full" style={{ background: "var(--brand)" }} />
              Payout reconciliation
            </p>
            <h4 className="r-h1 mt-0">{h1}</h4>
            <p className="r-lead r-measure mt-5" style={{ color: "var(--ink-60)" }}>
              {HERO_SUB}
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <CtaLink href="#audit">{CTA_PRIMARY}</CtaLink>
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
          </div>

          {/* A real close, not a mocked one. Replaces the synthetic payout
              cycler that showed "Matched" / "Awaiting" badges — every rival
              hero shows a matched state, so it proved nothing, and it was
              invented, which is the first thing a finance buyer tests. */}
          <div className="relative z-[1] lg:pl-10">
            <CloseStatement />
          </div>
        </div>
      </div>

      <Skyline className="pointer-events-none absolute inset-x-0 bottom-0 h-24 w-full" />
    </section>
  );
}
