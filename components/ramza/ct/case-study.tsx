/* Case study: Omniastores' month-end close in RAMZA.
 *
 * Social proof from our own first user, disclosed as such. Every figure is
 * from Omnia's live September 2026 reconciliation (139 gateway bank credits,
 * AED 1.42m, 1,173 orders, 137 payout files, 7 gateways, 22 foreign-currency
 * payouts). Founder rule 2026-10-20: no screenshots of the Omnia dashboard
 * on the landing page; the diagram and photos carry it. No time-saved claims until Omnia has
 * measured them.
 *
 * Layout (2026-10-20): a photo header (packing room under a flat navy wash,
 * the animated agent mark), the money-flow diagram, before/after photos, then
 * what changed. Plain otherwise (design_quality_bar): white,
 * hairlines, small radii, ink figures. No gradients, glows or icon bubbles. */

import Image from "next/image";
import { RamzaAgentMark } from "@/components/ramza/brand/agent";
import { ct } from "./brand";
import { MoneyFlow } from "./money-flow";

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
    <section id="case-study" className={`${ct.sectionLight} border-b border-[#E3E7F0] bg-white pb-20 sm:pb-24`}>
      {/* photo header: the real kind of business this is, under a flat wash */}
      <div className="relative overflow-hidden bg-[#0B1533] text-white">
        <Image src="/ramza/photos/in-ecommerce-packing.jpg" alt="" fill sizes="100vw" className="object-cover object-[50%_40%]" />
        <div className="absolute inset-0 bg-[#0B1533]/80" />
        <div className={`${ct.container} relative py-16 sm:py-20`}>
          <div className="max-w-[760px]">
            <div className="flex items-center gap-3">
              <RamzaAgentMark size={30} tone="dark" title="RAMZA" />
              <span className="text-[12px] font-medium uppercase tracking-[0.16em] text-[#C4CAD9]">Case study · Omniastores</span>
            </div>
            <h2 className={`${ct.h2} mt-4`}>How Omniastores closes the month without a spreadsheet</h2>
            <p className={`${ct.leadDark} mt-4`}>
              Omniastores sells across the UAE and KSA through its own web stores and WhatsApp, and gets paid through seven
              gateways. In RAMZA every bank credit is traced to the payout file that explains it and to the orders inside it.
            </p>
          </div>
          <dl className="mt-10 grid grid-cols-2 border-y border-white/15 py-5 sm:grid-cols-4">
            {STATS.map((s, i) => (
              <div key={s.value} className={`py-4 pr-4 sm:py-0 ${i > 0 ? "sm:border-l sm:border-white/15 sm:pl-4" : ""}`}>
                <dt className="text-[26px] font-semibold tracking-[-0.02em] tabular-nums">{s.value}</dt>
                <dd className="mt-1 text-[12.5px] leading-snug text-[#C4CAD9]">{s.label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className={ct.container}>
        <div className="mt-14">
          <h3 className="text-[12px] font-medium uppercase tracking-[0.16em] text-[#4A5263]">Where the money goes</h3>
          <p className="mt-2 max-w-[640px] text-[15px] leading-relaxed text-[#5B6475]">
            The bank never says which orders a payout paid for. That gap is the whole month-end problem, and the part RAMZA does.
          </p>
          <div className="mt-6"><MoneyFlow /></div>
        </div>

        {/* before / after */}
        <div className="mt-14 grid gap-5 md:grid-cols-2">
          <figure className="overflow-hidden rounded-[8px] border border-[#D9DEE8] bg-white">
            <div className="relative aspect-[16/10]">
              <Image src="/ramza/photos/px-statements-calculator.jpg" alt="Printed bank statements, payout reports and a calculator on a desk" fill sizes="(min-width:768px) 560px, 100vw" className="object-cover" />
              <span className="absolute left-3 top-3 rounded-[4px] bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#B42318]">Before</span>
            </div>
            <figcaption className="p-4 text-[13.5px] leading-relaxed text-[#5B6475]">
              <b className="text-[#14131C]">A folder per gateway.</b> Statements, payout emails and a spreadsheet rebuilt by hand every month.
            </figcaption>
          </figure>
          <figure className="overflow-hidden rounded-[8px] border border-[#D9DEE8] bg-white">
            <div className="relative aspect-[16/10]">
              <Image src="/ramza/photos/px-founder-bright.jpg" alt="Founder at a calm, bright desk with the month already closed" fill sizes="(min-width:768px) 560px, 100vw" className="object-cover" />
              <span className="absolute left-3 top-3 rounded-[4px] bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#1F8A5B]">After</span>
            </div>
            <figcaption className="p-4 text-[13.5px] leading-relaxed text-[#5B6475]">
              <b className="text-[#14131C]">One close, done for you.</b> Every credit explained by its payout file and orders; only the real differences come back to you.
            </figcaption>
          </figure>
        </div>


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

/* One line under the hero: who already runs on RAMZA, linking to the case study. */
export function TrustLine() {
  return (
    <a href="#case-study" className={`${ct.container} mb-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-[13.5px] text-[#4A5263] hover:text-[#0B1533]`}>
      <RamzaAgentMark size={20} />
      <span><b className="font-semibold text-[#14131C]">Live at Omniastores</b> · AED 1.42m checked against the bank in September 2026 · 7 gateways</span>
      <span className="font-medium text-[#3A55E6]">Read the case study →</span>
    </a>
  );
}
