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
              <div aria-hidden className="r-ruled r-margin-rule absolute inset-0" />

              {/* Flex column with the checklist pushed down, so the two cards'
                  bullet lists bottom-align however the headings wrap. */}
              <div className="relative z-[1] flex h-full flex-col p-6 pl-12 sm:p-8 sm:pl-14">
                {/* Stamp above the title, not beside it, so both headings get
                    the full column and land on the same baseline across the
                    pair however they wrap. */}
                {/* self-start: the card is a flex column, which would
                    otherwise stretch the stamp across the full width. */}
                <span className="r-stamp self-start">{o.stamp}</span>
                <h3
                  className="r-h2 mt-4 text-[1.375rem] sm:text-[1.5rem]"
                  style={{ color: "var(--ink)", textWrap: "balance" }}
                >
                  {o.title}
                </h3>

                <p
                  className="mt-3 text-[0.9375rem] leading-relaxed"
                  style={{ color: "var(--ink-60)" }}
                >
                  {o.body}
                </p>

                <ul className="mt-6 space-y-2.5 pt-2 sm:mt-auto">
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
