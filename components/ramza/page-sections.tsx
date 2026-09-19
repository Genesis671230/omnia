import { Check, Minus, X } from "lucide-react";
import type { PageSection } from "@/lib/ramza/pages/types";

/* Renders the closed union of section shapes from lib/ramza/pages/types.
   One renderer for all 25 pages, so the visual language cannot drift between
   a gateway page and a comparison page. */

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="r-h2 r-measure">{children}</h2>;
}

function Intro({ children }: { children: React.ReactNode }) {
  return (
    <p className="r-lead r-measure mt-3" style={{ color: "var(--ink-60)" }}>
      {children}
    </p>
  );
}

const VERDICT_ICON = {
  ramza: Check,
  other: X,
  even: Minus,
} as const;

const VERDICT_TONE = {
  ramza: "var(--ledger)",
  other: "var(--stamp)",
  even: "var(--ink-40)",
} as const;

const STATE_ICON = { yes: Check, no: X, partial: Minus } as const;
const STATE_TONE = {
  yes: "var(--ledger)",
  no: "var(--stamp)",
  partial: "var(--residual)",
} as const;

export function PageSections({ sections }: { sections: PageSection[] }) {
  return (
    <>
      {sections.map((s, i) => (
        <section key={i} className="r-pagesection">
          {s.kind === "prose" && (
            <>
              <Heading>{s.heading}</Heading>
              <div className="r-prose mt-4">
                {s.body.map((p, j) => (
                  <p key={j}>{p}</p>
                ))}
              </div>
            </>
          )}

          {s.kind === "steps" && (
            <>
              <Heading>{s.heading}</Heading>
              {s.intro && <Intro>{s.intro}</Intro>}
              <ol className="r-steps mt-6">
                {s.steps.map((step, j) => (
                  <li key={j}>
                    <span className="r-steps-n r-nums">{j + 1}</span>
                    <div>
                      <h3 className="r-steps-t">{step.title}</h3>
                      <p className="r-steps-b">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}

          {s.kind === "table" && (
            <>
              <Heading>{s.heading}</Heading>
              {s.intro && <Intro>{s.intro}</Intro>}
              {/* Its own scroll container: a wide table must never make the
                  page body scroll sideways on a phone. */}
              <div className="r-tablewrap mt-6">
                <table className="r-table">
                  <thead>
                    <tr>
                      {s.columns.map((c) => (
                        <th key={c} scope="col">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((cell, k) => (
                          <td key={k} className={k > 0 ? "r-nums" : undefined}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {s.footnote && <p className="r-footnote">{s.footnote}</p>}
            </>
          )}

          {s.kind === "compare" && (
            <>
              <Heading>{s.heading}</Heading>
              {s.intro && <Intro>{s.intro}</Intro>}
              <ul className="r-compare mt-6">
                {s.rows.map((row, j) => {
                  const Icon = VERDICT_ICON[row.verdict];
                  return (
                    <li key={j}>
                      <p className="r-compare-dim">{row.dimension}</p>
                      <div className="r-compare-side" data-win={row.verdict === "ramza"}>
                        <Icon size={14} style={{ color: VERDICT_TONE[row.verdict] }} aria-hidden />
                        <span>{row.ramza}</span>
                      </div>
                      <div className="r-compare-side">
                        <span>{row.other}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {s.footnote && <p className="r-footnote">{s.footnote}</p>}
            </>
          )}

          {s.kind === "checklist" && (
            <>
              <Heading>{s.heading}</Heading>
              {s.intro && <Intro>{s.intro}</Intro>}
              <ul className="r-checklist mt-6">
                {s.items.map((item, j) => {
                  const Icon = STATE_ICON[item.state];
                  return (
                    <li key={j}>
                      <Icon size={15} style={{ color: STATE_TONE[item.state] }} aria-hidden />
                      <div>
                        <h3 className="r-steps-t">{item.title}</h3>
                        <p className="r-steps-b">{item.body}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {s.kind === "callout" && (
            <aside className="r-callout" data-tone={s.tone}>
              <h3 className="r-callout-h">{s.heading}</h3>
              <p className="r-callout-b">{s.body}</p>
            </aside>
          )}
        </section>
      ))}
    </>
  );
}
