import { Section, SectionHeading } from "./ui/section";
import { Reveal } from "./reveal";
import { PRODUCT_FRAME, PRODUCT_ROWS, PRODUCT_TILES } from "@/lib/ramza/copy";

/* The application itself, drawn in DOM rather than shipped as a screenshot.

   Every comparable product leads with its interface — A2X puts the platform in
   a tablet mockup, Synder shows transaction tables — and RAMZA showed the
   accounting *output* (accountant-view) without ever showing the screen a
   customer logs into.

   DOM instead of a PNG for four reasons that all matter here: it stays sharp on
   any display, it follows the visitor's light/dark preference through the same
   tokens as the rest of the page, it adds no bytes to LCP, and it cannot leak a
   real customer's financials the way a screenshot of the live app would.

   Columns mirror the real reconciliation table (date, gateway, bank ref, bank
   credit, payout net, variance, orders, status) so this is a depiction of the
   product, not an idealised invention of one. Figures are synthetic. */

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl px-3.5 py-3" style={{ background: "var(--panel-2)", border: "1px solid var(--panel-border)" }}>
      <p className="text-[0.6875rem] font-medium uppercase tracking-[0.12em]" style={{ color: "var(--panel-ink-60)" }}>
        {label}
      </p>
      <p className="mt-1.5 whitespace-nowrap text-[0.9375rem] font-semibold r-nums" style={{ color: "var(--panel-ink)" }}>
        {value}
      </p>
      {note && (
        <p className="mt-0.5 text-[0.6875rem] r-nums" style={{ color: "var(--panel-ink-60)" }}>
          {note}
        </p>
      )}
    </div>
  );
}

export function ProductFrame() {
  return (
    <Section field>
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:gap-14">
        <div>
          <span className="r-eyebrow inline-flex items-center gap-2">
            <span aria-hidden className="inline-block h-px w-8" style={{ background: "var(--ledger)" }} />
            The screen
          </span>
          <SectionHeading>{PRODUCT_FRAME.heading}</SectionHeading>
          <p className="r-lead r-measure mt-4" style={{ color: "var(--ink-60)" }}>
            {PRODUCT_FRAME.body}
          </p>
          <p className="mt-5 text-[0.8125rem]" style={{ color: "var(--ink-40)" }}>
            {PRODUCT_FRAME.disclaimer}
          </p>
        </div>

        <Reveal>
          <div className="r-appframe">
            {/* window chrome — names the view the way the product does */}
            <div className="r-appframe-bar">
              <span aria-hidden className="r-appframe-dots">
                <i /><i /><i />
              </span>
              <span className="r-appframe-title">{PRODUCT_FRAME.windowTitle}</span>
              <span className="r-appframe-period r-nums">{PRODUCT_FRAME.period}</span>
            </div>

            <div className="r-appframe-body">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {PRODUCT_TILES.map((t) => (
                  <Tile key={t.label} {...t} />
                ))}
              </div>

              {/* Desktop: the real table. Mobile: the same rows as stacked
                  cards — a squeezed eight-column table is not responsive
                  design, it is a desktop table that happens to fit. */}
              <div className="r-appframe-table mt-4 hidden sm:block">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Gateway</th>
                      <th scope="col">Bank ref</th>
                      <th scope="col" className="text-right">Bank credit</th>
                      <th scope="col" className="text-right">Payout net</th>
                      <th scope="col" className="text-right">Variance</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PRODUCT_ROWS.map((r) => (
                      <tr key={r.ref}>
                        <td className="r-nums">{r.date}</td>
                        <td>{r.gateway}</td>
                        <td className="r-nums" style={{ color: "var(--panel-ink-60)" }}>{r.ref}</td>
                        <td className="r-nums text-right">{r.bank}</td>
                        <td className="r-nums text-right">{r.net}</td>
                        <td
                          className="r-nums text-right"
                          style={{ color: r.variance === "0.00" ? "var(--panel-ink-60)" : "var(--residual)" }}
                        >
                          {r.variance}
                        </td>
                        <td>
                          <span className={r.matched ? "r-pill r-pill-matched" : "r-pill r-pill-unmatched"}>
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="r-appframe-cards mt-4 space-y-2.5 sm:hidden">
                {PRODUCT_ROWS.map((r) => (
                  <li key={r.ref}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[0.8125rem] font-semibold" style={{ color: "var(--panel-ink)" }}>
                          {r.gateway}
                        </p>
                        <p className="mt-0.5 text-[0.6875rem] r-nums" style={{ color: "var(--panel-ink-60)" }}>
                          {r.date} · {r.ref}
                        </p>
                      </div>
                      <span className={r.matched ? "r-pill r-pill-matched" : "r-pill r-pill-unmatched"}>
                        {r.status}
                      </span>
                    </div>
                    <dl className="mt-2.5 grid grid-cols-3 gap-2">
                      {[
                        ["Bank credit", r.bank],
                        ["Payout net", r.net],
                        ["Variance", r.variance],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-[0.625rem] uppercase tracking-[0.1em]" style={{ color: "var(--panel-ink-60)" }}>
                            {k}
                          </dt>
                          <dd
                            className="mt-0.5 text-[0.8125rem] font-medium r-nums"
                            style={{
                              color:
                                k === "Variance" && v !== "0.00"
                                  ? "var(--residual)"
                                  : "var(--panel-ink)",
                            }}
                          >
                            {v}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>

              <p className="r-appframe-foot r-nums">{PRODUCT_FRAME.footer}</p>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
