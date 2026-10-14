"use client";

/* Automatic updates where the owner already lives: a WhatsApp chat with the
 * RAMZA assistant and a Telegram finance group, messages arriving as the day
 * goes. Messages are written per industry and play in the real-looking
 * phones from components/ramza/ct/chat-phones (no app logos copied). */

import { INDUSTRY_LABEL, type Industry } from "@/lib/ramza/demo/coa";
import { TelegramPhone, WhatsAppPhone, type TgMsg, type WaMsg } from "@/components/ramza/ct/chat-phones";
import { useIndustry, IndustryChips } from "./industry";

type Msg = { from: "bot" | "me"; text: string; time: string };

const WA: Record<Industry, Msg[]> = {
  ecommerce: [
    { from: "bot", time: "09:02", text: "Tabby payout landed — AED 18,240.55 in Emirates NBD. 41 orders matched, fees AED 820.80 + VAT 41.04 booked to Zoho. ✓" },
    { from: "bot", time: "11:47", text: "Stripe USD payout: $4,086.91 arrived as AED 14,962.18. Exchange difference AED 46.30 booked." },
    { from: "me", time: "11:49", text: "Anything missing?" },
    { from: "bot", time: "11:49", text: "1 Tamara order (SB1071) paid AED 412 short — partial capture. Want me to raise it with Tamara?" },
    { from: "bot", time: "21:00", text: "Today closed ✓ Sales AED 32,410 · in the bank AED 30,980 · on the way AED 1,430 (Shopify, due tomorrow)." },
  ],
  logistics: [
    { from: "bot", time: "08:30", text: "COD remittance from Aramex — AED 46,810 for 212 parcels. 2 parcels short (AED 340). Merchant payables updated." },
    { from: "bot", time: "12:10", text: "Najm Electronics paid invoice FR1046 — AED 6,420. Cleared ✓" },
    { from: "me", time: "12:12", text: "Fuel spend this week?" },
    { from: "bot", time: "12:12", text: "ENOC cards AED 8,900 (+VAT 423.81 recoverable), Salik AED 1,500. 9% above last week." },
    { from: "bot", time: "20:30", text: "Today closed ✓ Collected AED 58,120 · COD still with couriers AED 12,450." },
  ],
  realestate: [
    { from: "bot", time: "09:15", text: "Rent received — Unit 1204 (Al Mansoori) AED 23,500 by transfer. Cleared ✓" },
    { from: "bot", time: "10:00", text: "3 cheques due tomorrow: AED 61,250 total. Reminder sent to the tenants." },
    { from: "me", time: "10:03", text: "Who's overdue?" },
    { from: "bot", time: "10:03", text: "Unit 905 — 12 days, AED 18,000. Shop G03 — service charge AED 4,200. Want a payment link for both?" },
    { from: "bot", time: "19:00", text: "Today closed ✓ Rent collected AED 84,700 · deposits held AED 210,000 (separate account)." },
  ],
  wholesale: [
    { from: "bot", time: "09:40", text: "Al Noor Supermarket paid AED 24,000 against GG1051 (AED 31,250). Part-payment recorded, AED 7,250 still open." },
    { from: "bot", time: "11:05", text: "Customs duty AED 14,200 booked to Freight in & customs duty — attached the Dubai Trade receipt." },
    { from: "me", time: "11:06", text: "Aging?" },
    { from: "bot", time: "11:06", text: "Over 60 days: AED 48,900 across 3 customers. Coral Hypermarket is the biggest — AED 31,000." },
    { from: "bot", time: "20:00", text: "Today closed ✓ Collected AED 112,400 · receivables AED 386,200." },
  ],
  retail: [
    { from: "bot", time: "08:05", text: "Card settlement from Network International — AED 9,412.70 for yesterday (3 terminals). MDR AED 177.60 + VAT 8.88 booked." },
    { from: "bot", time: "08:06", text: "Cash deposit AED 2,850 matches yesterday's Z-report ✓" },
    { from: "me", time: "13:20", text: "Tabby in-store this month?" },
    { from: "bot", time: "13:20", text: "AED 18,300 across 22 sales, effective cost 4.95% incl. VAT — 2.6× your card cost." },
    { from: "bot", time: "22:00", text: "Today closed ✓ Sales AED 11,940 · cards AED 8,700 · cash AED 2,140 · Tabby AED 1,100." },
  ],
  construction: [
    { from: "bot", time: "10:20", text: "Emaar Projects paid progress certificate #7 — AED 378,000 (10% retention AED 42,000 held). Cleared ✓" },
    { from: "bot", time: "12:00", text: "WPS salaries for October ready: 24 staff, AED 188,000. SIF file attached for the bank." },
    { from: "me", time: "12:04", text: "Retention outstanding?" },
    { from: "bot", time: "12:04", text: "AED 236,568 receivable across 4 projects; AED 61,200 payable to subcontractors." },
    { from: "bot", time: "18:30", text: "Today closed ✓ Received AED 378,000 · paid suppliers AED 228,000." },
  ],
};

const TG = (i: Industry): TgMsg[] => [
  { who: "RAMZA bot", time: "08:00", text: `📊 Morning brief — ${INDUSTRY_LABEL[i]}: yesterday closed, every payout in the bank matched.` },
  { who: "RAMZA bot", time: "08:00", text: "⏰ 2 payments are past their usual date. Chase them at 10:00?", buttons: ["Chase at 10:00", "Show details"], pressed: 0 },
  { who: "Sara · Finance", color: "#E8A15A", time: "08:07", text: "Yes please — and approve the Tamara claim." },
  { who: "RAMZA bot", time: "08:07", text: "Done ✓ Claim sent with the order evidence attached." },
];

const toWa = (m: Msg): WaMsg => ({ from: m.from === "me" ? "me" : "them", time: m.time, text: m.text });

export function LiveUpdates() {
  const { industry } = useIndustry();
  return (
    <section className="relative py-20 sm:py-28">
      <div className="relative mx-auto w-full max-w-[1200px] px-5 sm:px-8">
        <div className="relative overflow-hidden rounded-[36px] bg-[#0B1533] px-5 py-12 text-white sm:px-10 lg:px-14">
          <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[480px] w-[480px] rounded-full bg-[radial-gradient(circle,rgba(79,53,232,0.45),transparent_65%)]" />
          <div className="relative grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.16em] text-[#CBC3FF]">Automatic updates</div>
              <h2 className="mt-3 font-[family-name:var(--font-display)] text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[42px]">Your books, reporting to you on WhatsApp and Telegram.</h2>
              <p className="mt-4 text-[17px] leading-relaxed text-[#B8B6C0]">A note when each payout lands, what it cleared and what it cost. Ask a question in plain words and get the number. Overdue money gets chased — and you hear about it before month end, not after.</p>
              <ul className="mt-6 space-y-2.5 text-[15px] text-[#E6E4EA]">
                {["Every payout: amount, orders cleared, fees and VAT booked", "Exceptions only — short payments, missing payouts, overdue invoices", "Daily close and a morning brief for the team", "Ask anything: “what did Tabby cost us this month?”"].map((x) => (
                  <li key={x} className="flex gap-3"><span className="mt-[9px] h-1.5 w-1.5 shrink-0 rotate-45 bg-[#B3A6FF]" />{x}</li>
                ))}
              </ul>
              <IndustryChips dark className="mt-7 !justify-start" from="live_updates" />
            </div>

            <div className="flex justify-center gap-5 overflow-hidden py-2 lg:justify-end">
              <WhatsAppPhone key={`wa-${industry}`} script={WA[industry].map(toWa)} />
              <div className="hidden translate-y-8 xl:block">
                <TelegramPhone key={`tg-${industry}`} script={TG(industry)} title={`Finance · ${INDUSTRY_LABEL[industry]}`} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
