import { Section, SectionHeading } from "./ui/section";
import { CtaLink } from "./ui/cta-button";
import { Reveal } from "./reveal";
import { FOUNDING_COPY, CTA_PRIMARY } from "@/lib/ramza/copy";

const STATS = [
  { label: "Setup", value: "[PRICE_SETUP]" },
  { label: "Monthly", value: "[PRICE_MONTHLY]" },
  { label: "Price lock", value: "12 months" },
];

export function FoundingPartners() {
  return (
    <Section id="pricing" field>
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <SectionHeading>Founding partners</SectionHeading>
          <p className="r-lead r-measure mt-4" style={{ color: "var(--ink-60)" }}>
            {FOUNDING_COPY}
          </p>
          <div className="mt-7">
            <CtaLink href="#audit">{CTA_PRIMARY}</CtaLink>
          </div>
        </div>

        <Reveal>
         <div className="r-glass r-grain relative overflow-hidden rounded-2xl p-6 sm:p-8">
          {/* Stacked rows, not a 3-up grid: the price placeholders are long
              enough that three columns ran them into each other. Rows also
              survive any eventual real value without re-breaking. */}
          <dl className="relative z-[1] divide-y" style={{ borderColor: "var(--rule)" }}>
            {STATS.map((s) => {
              const pending = s.value.startsWith("[");
              return (
                <div
                  key={s.label}
                  className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4 first:pt-0 last:pb-0"
                  style={{ borderColor: "var(--rule)" }}
                >
                  <dt className="text-sm font-medium" style={{ color: "var(--ink-60)" }}>
                    {s.label}
                  </dt>
                  <dd
                    className="tnum text-xl font-semibold sm:text-2xl"
                    style={{ color: pending ? "var(--ink-40)" : "var(--ink)" }}
                  >
                    {s.value}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="relative z-[1] mt-6 text-xs leading-relaxed" style={{ color: "var(--ink-60)" }}>
            One price by transaction volume. VAT on fees and multi-currency included.
          </p>
         </div>
        </Reveal>
      </div>
    </Section>
  );
}
