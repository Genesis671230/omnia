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
         <div className="r-glass rounded-2xl p-6 sm:p-8">
          <dl className="grid gap-6 sm:grid-cols-3">
            {STATS.map((s) => (
              <div key={s.label}>
                <dt className="text-xs font-medium" style={{ color: "var(--ink-60)" }}>
                  {s.label}
                </dt>
                <dd
                  className="tnum mt-1.5 text-2xl font-semibold"
                  style={{ color: s.value.startsWith("[") ? "var(--ink-60)" : "var(--ink)" }}
                >
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-xs" style={{ color: "var(--ink-60)" }}>
            One price by transaction volume. VAT on fees and multi-currency included.
          </p>
         </div>
        </Reveal>
      </div>
    </Section>
  );
}
