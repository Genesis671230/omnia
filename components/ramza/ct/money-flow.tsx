/* "Where the money goes" — the diagram an owner reads in five seconds:
 * orders → gateways → one bank credit → RAMZA explains it → Zoho Books.
 * Figures are Omniastores' September 2026 close (same as case-study.tsx).
 * Plain on purpose (design_quality_bar): white nodes, hairlines, real gateway
 * logos, one blue dot travelling each link (money-flow.css). */

import Image from "next/image";
import { RamzaAgentMark } from "@/components/ramza/brand/agent";
import "./money-flow.css";

const L = "/ramza/logos";

const GATEWAYS: { name: string; logo?: string }[] = [
  { name: "Tabby", logo: "tabby-mark.png" },
  { name: "Tamara", logo: "tamara-mark.png" },
  { name: "Stripe", logo: "stripe-mark.png" },
  { name: "Telr", logo: "telr-mark.png" },
  { name: "Checkout" },
  { name: "Shopify Payments", logo: "shopify.svg" },
  { name: "COD" },
];

function Node({ step, title, figure, children }: { step: string; title: string; figure?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-[8px] border border-[#D9DEE8] bg-white p-4">
      <div className="text-[11px] font-medium tabular-nums uppercase tracking-[0.14em] text-[#9AA1B0]">{step}</div>
      <div className="mt-1 text-[15px] font-semibold text-[#14131C]">{title}</div>
      {figure && <div className="mt-0.5 text-[12.5px] text-[#5B6475]">{figure}</div>}
      <div className="mt-3 flex-1">{children}</div>
    </div>
  );
}

const Link = ({ label }: { label: string }) => (
  <div className="mf-link" aria-hidden><i /><b>{label}</b></div>
);

export function MoneyFlow() {
  return (
    <figure>
      <div
        className="grid gap-0 lg:grid-cols-[1fr_28px_1.15fr_28px_1fr_28px_1.25fr_28px_1fr] lg:items-stretch"
        role="img"
        aria-label="How a payment reaches the books: customer orders are paid through seven gateways, each gateway pays one combined credit into the bank, RAMZA splits that credit into the payout file, orders, fees and VAT, and the entries go to Zoho Books for the accountant to sign off."
      >
        <Node step="01" title="Customers order" figure="1,173 orders in September">
          <div className="flex flex-wrap gap-1.5">
            {[["Shopify", "shopify.svg"], ["WhatsApp", "whatsapp.svg"]].map(([n, f]) => (
              <span key={n} className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#E3E7F0] px-2 py-1 text-[12px] text-[#14131C]">
                <Image src={`${L}/${f}`} alt="" width={14} height={14} />{n}
              </span>
            ))}
          </div>
        </Node>
        <Link label="paid through" />
        <Node step="02" title="Seven gateways collect" figure="each one pays out on its own schedule">
          <div className="flex flex-wrap gap-1.5">
            {GATEWAYS.map((g) => (
              <span key={g.name} className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#E3E7F0] px-2 py-1 text-[12px] text-[#14131C]">
                {g.logo && <Image src={`${L}/${g.logo}`} alt="" width={14} height={14} className="rounded-[3px]" />}{g.name}
              </span>
            ))}
          </div>
        </Node>
        <Link label="lands as" />
        <Node step="03" title="One line in the bank" figure="no order numbers, fees already taken">
          <div className="rounded-[6px] bg-[#F4F5F8] p-3 font-mono text-[12px] leading-relaxed text-[#14131C]">
            <div className="text-[#7A8294]">Credit · gateway payout</div>
            <div className="text-[15px] font-semibold tabular-nums">+ AED ••,•••.••</div>
            <div className="text-[#7A8294]">From who? For which orders?</div>
          </div>
        </Node>
        <Link label="RAMZA explains it" />
        <Node step="04" title="RAMZA matches it" figure="every credit traced, differences flagged">
          <div className="flex items-start gap-3">
            <RamzaAgentMark size={40} />
            <ul className="mf-split flex-1 space-y-1 text-[12px] text-[#14131C]">
              <li className="flex justify-between border-b border-[#EEF1F7] pb-1"><span>Payout file</span><span className="text-[#1F8A5B]">found</span></li>
              <li className="flex justify-between border-b border-[#EEF1F7] pb-1"><span>Orders inside</span><span className="text-[#1F8A5B]">matched</span></li>
              <li className="flex justify-between border-b border-[#EEF1F7] pb-1"><span>Gateway fee + VAT</span><span className="text-[#1F8A5B]">split out</span></li>
              <li className="flex justify-between"><span>FX difference</span><span className="text-[#1F8A5B]">at bank rate</span></li>
            </ul>
          </div>
        </Node>
        <Link label="booked to" />
        <Node step="05" title="Books, ready to sign" figure="your accountant reviews and signs off">
          <div className="flex items-center gap-2">
            <Image src={`${L}/zoho-books.svg`} alt="Zoho Books" width={86} height={20} className="h-5 w-auto" />
          </div>
          <ul className="mt-2 space-y-1 text-[12px] text-[#5B6475]">
            <li>Payment against each invoice</li>
            <li>Fee expense and input VAT</li>
            <li>Exchange gain or loss</li>
          </ul>
        </Node>
      </div>
      <figcaption className="mt-3 text-[12.5px] text-[#7A8294]">
        How Omniastores&apos; September 2026 money moved from order to books. The bank line amount is hidden on purpose.
      </figcaption>
    </figure>
  );
}
