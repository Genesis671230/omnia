import { Section, SectionHeading } from "./ui/section";
import { Reveal } from "./reveal";
import { ACCOUNTANT_COPY, ACCOUNTANT_ROW } from "@/lib/ramza/copy";

/* Static synthetic example. No real data.

   This used to be a one-row table with five columns, which buried the whole
   point: that the three deductions actually foot to the amount in the bank.
   Showing it as a worked ledger sheet lets a finance person verify the
   arithmetic at a glance, which is the only proof that matters here. */

const DEDUCTIONS = [
  { label: "Gateway fee, Tabby", account: "Bank charges", amount: ACCOUNTANT_ROW.gatewayFee },
  { label: "VAT on fee", account: "Input VAT", amount: ACCOUNTANT_ROW.vatOnFee },
];

export function AccountantView() {
  return (
    <Section>
      <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:gap-14">
        <div>
          <SectionHeading>What your accountant sees</SectionHeading>
          <p className="r-lead r-measure mt-4" style={{ color: "var(--ink-60)" }}>
            {ACCOUNTANT_COPY}
          </p>
          <p className="mt-5 text-[0.8125rem]" style={{ color: "var(--ink-40)" }}>
            Illustrative figures. One invoice, one Tabby settlement.
          </p>
        </div>

        <Reveal>
          <div className="r-glass r-grain relative overflow-hidden rounded-2xl">
            <div aria-hidden className="r-ruled r-margin-rule absolute inset-0" />

            <div className="relative z-[1] p-5 pl-11 sm:p-7 sm:pl-14">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--ink-40)" }}>
                    Invoice
                  </p>
                  <p className="mt-1 text-sm font-semibold" style={{ color: "var(--ink)" }}>
                    Tabby settlement, March 2026
                  </p>
                </div>
                <span className="r-stamp">{ACCOUNTANT_ROW.status}</span>
              </div>

              <dl className="mt-6 text-sm">
                <Line label="Invoice total" amount={ACCOUNTANT_ROW.invoiceTotal} strong />

                {DEDUCTIONS.map((d) => (
                  <Line
                    key={d.label}
                    label={d.label}
                    account={d.account}
                    amount={d.amount}
                    negative
                  />
                ))}

                <div
                  className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t-2 pt-3"
                  style={{ borderColor: "var(--ledger)" }}
                >
                  <dt className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
                    Received in bank
                  </dt>
                  <dd
                    className="tnum text-xl font-semibold sm:text-2xl"
                    style={{ color: "var(--ledger)" }}
                  >
                    {ACCOUNTANT_ROW.received}
                  </dd>
                </div>
              </dl>

              <p className="mt-5 text-[0.75rem] leading-relaxed" style={{ color: "var(--ink-40)" }}>
                The invoice closes at its full total. The fee and its VAT are
                posted to their own accounts, so nothing is left as a residual.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

function Line({
  label,
  account,
  amount,
  negative,
  strong,
}: {
  label: string;
  account?: string;
  amount: string;
  negative?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
      <dt className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span
          className={strong ? "font-semibold" : ""}
          style={{ color: "var(--ink)" }}
        >
          {label}
        </span>
        {account && (
          <span
            className="rounded px-1.5 py-0.5 text-[0.6875rem] font-medium"
            style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
          >
            {account}
          </span>
        )}
      </dt>
      <dd
        className={`tnum ${strong ? "text-base font-semibold" : ""}`}
        style={{ color: negative ? "var(--residual)" : "var(--ink)" }}
      >
        {negative ? `− ${amount}` : amount}
      </dd>
    </div>
  );
}
