import { Section, SectionHeading } from "./ui/section";
import { ChainDraw } from "./chain-draw";
import { HOW_IT_WORKS } from "@/lib/ramza/copy";

/* The one numbered section (a real sequence). */
export function HowItWorks() {
  return (
    <Section id="how-it-works" field>
      <SectionHeading>How it works</SectionHeading>
      <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {HOW_IT_WORKS.map((step, i) => (
          <li
            key={step.title}
            className="r-glass rounded-2xl p-5"
          >
            <div
              className="tnum inline-flex size-7 items-center justify-center rounded-lg text-sm font-semibold"
              style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
            >
              {i + 1}
            </div>
            <h3 className="mt-3 text-base font-semibold" style={{ color: "var(--ink)" }}>
              {step.title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--ink-60)" }}>
              {step.body}
            </p>
          </li>
        ))}
      </ol>
      <ChainDraw />
    </Section>
  );
}
