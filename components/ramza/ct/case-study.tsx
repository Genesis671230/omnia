/* Case study: Omnia Stores' month-end close in RAMZA.
 *
 * Social proof from our own first user, disclosed as such. Every figure is
 * from Omnia's live September 2026 reconciliation (139 gateway bank credits,
 * AED 1.42m, 1,173 orders, 137 payout files, 7 gateways, 22 foreign-currency
 * payouts); the screenshot is the real screen, not a mock. Refresh both
 * together when a newer month is used. No time-saved claims until Omnia has
 * measured them.
 *
 * Plain on purpose (founder rule, design_quality_bar): white, hairlines, small
 * radii, ink figures, the real screen. No gradients, glows or icon bubbles. */

import Image from "next/image";
import { ct } from "./brand";

const STATS = [
  { value: "AED 1.42m", label: "sales money checked against the bank in September 2026" },
  { value: "1,173", label: "orders traced to the payout file that paid them" },
  { value: "7", label: "gateways in one close: Tabby, Tamara, Stripe, Telr, Checkout, Shopify Payments, COD" },
  { value: "22", label: "foreign-currency payouts matched at the bank's own rate" },
];

const CHANGES = [
  ["No spreadsheet to rebuild", "Bank statement, payout files and orders meet in one screen. Nothing is copied by hand."],
  ["Every credit answers itself", "Open a bank line and see the payout behind it and every order inside it."],
  ["Differences are shown, not buried", "A short or missing payout file stays on the list until someone resolves it."],
  ["One close pack", "The month goes to the accountant as one workbook: summary, local orders, cross-border orders."],
];

export function CaseStudySection() {
  return (
    <section id="case-study" className={`${ct.sectionLight} border-b border-[#E3E7F0] bg-white py-20 sm:py-24`}>
      <div className={ct.container}>
        <div>
          <div className="max-w-[760px]">
            <div className="text-[12px] font-medium uppercase tracking-[0.16em] text-[#4A5263]">Case study · Omnia Stores</div>
            <h2 className={`${ct.h2} mt-3 text-[#14131C]`}>How Omnia closes the month without a spreadsheet</h2>
            <p className={`${ct.lead} mt-4`}>
              Omnia sells across the UAE and KSA through its own web stores and WhatsApp, and gets paid through seven
              gateways. In RAMZA every bank credit is traced to the payout file that explains it and to the orders inside it.
            </p>
          </div>
          <dl className="mt-10 grid grid-cols-2 border-y border-[#E3E7F0] py-5 sm:grid-cols-4">
            {STATS.map((s, i) => (
              <div key={s.value} className={`py-4 pr-4 sm:py-0 ${i > 0 ? "sm:border-l sm:border-[#E3E7F0] sm:pl-4" : ""}`}>
                <dt className="text-[26px] font-semibold tracking-[-0.02em] tabular-nums text-[#0B1533]">{s.value}</dt>
                <dd className="mt-1 text-[12.5px] leading-snug text-[#5B6475]">{s.label}</dd>
              </div>
            ))}
          </dl>
        </div>

        <figure className="mt-12">
          <div className="overflow-hidden rounded-[8px] border border-[#D9DEE8] bg-white shadow-[0_1px_2px_rgba(11,21,51,0.04),0_20px_50px_-30px_rgba(11,21,51,0.35)]">
            <Image
              src="/ramza/case-study/omnia-sep-full.jpg"
              alt="Omnia's September 2026 month close in RAMZA: AED 1.42m of sales money in the bank, 89% matched to orders, broken down by gateway, with the three close steps."
              width={2400}
              height={1500}
              sizes="(min-width: 1200px) 1140px, 100vw"
              className="h-auto w-full"
            />
          </div>
          <figcaption className="mt-3 text-[12.5px] text-[#7A8294]">
            Omnia&apos;s real September 2026 close in RAMZA. Omnia Stores is RAMZA&apos;s founding company and first user.
          </figcaption>
        </figure>

        <ul className="mt-12 grid gap-px overflow-hidden rounded-[8px] border border-[#E3E7F0] bg-[#E3E7F0] sm:grid-cols-2 lg:grid-cols-4">
          {CHANGES.map(([title, body], i) => (
            <li key={title} className="bg-white p-5">
              <div className="text-[12px] font-medium tabular-nums text-[#9AA1B0]">0{i + 1}</div>
              <div className="mt-2 text-[15px] font-semibold text-[#14131C]">{title}</div>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#5B6475]">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
