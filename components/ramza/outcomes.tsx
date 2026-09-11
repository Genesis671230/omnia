import { Check } from "lucide-react";
import { Section, SectionHeading } from "./ui/section";
import { Reveal } from "./reveal";
import { OUTCOMES, OUTCOMES_HEADING, OUTCOMES_INTRO } from "@/lib/ramza/copy";

/* Two panels, deliberately not three, so this cannot collapse into the
   three-up feature grid. Each one is a sheet of ruled ledger paper with a
   red margin rule and a rubber stamp in the corner: the artefact the
   reconciliation produces, not an icon representing it. */
export function Outcomes() {
  return (
    <Section id="outcomes" field>
      <div className="max-w-2xl">
        <SectionHeading>{OUTCOMES_HEADING}</SectionHeading>
        <p className="r-lead mt-4" style={{ color: "var(--ink-60)" }}>
          {OUTCOMES_INTRO}
        </p>
      </div>

      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        {OUTCOMES.map((o, i) => (
          <Reveal key={o.title} delay={i * 0.08}>
            <article className="r-glass r-grain relative h-full overflow-hidden rounded-2xl">
              <div
                aria-hidden
                className="r-ruled r-margin-rule absolute inset-0 opacity-[0.55]"
              />

              <div className="relative z-[1] p-6 pl-12 sm:p-8 sm:pl-14">
                <div className="flex items-start justify-between gap-4">
                  <h3
                    className="r-h2 text-[1.375rem] sm:text-[1.5rem]"
                    style={{ color: "var(--ink)" }}
                  >
                    {o.title}
                  </h3>
                  <span className="r-stamp mt-1 shrink-0">{o.stamp}</span>
                </div>

                <p
                  className="mt-4 text-[0.9375rem] leading-relaxed"
                  style={{ color: "var(--ink-60)" }}
                >
                  {o.body}
                </p>

                <ul className="mt-6 space-y-2.5">
                  {o.points.map((p) => (
                    <li key={p} className="flex gap-2.5 text-[0.875rem] leading-relaxed">
                      <Check
                        className="mt-[0.2rem] size-4 shrink-0"
                        style={{ color: "var(--ledger)" }}
                        aria-hidden
                      />
                      <span style={{ color: "var(--ink)" }}>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
