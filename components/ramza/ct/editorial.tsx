/* RAMZA editorial sections — the deck-style layout from the founder's
 * reference (numbered slide header, chamfered stat cards with oversized
 * numerals, a pill timeline), in RAMZA's own navy / royal-blue brand.
 *
 * Every figure and date is read from config/rules.json through
 * lib/ramza/rules.ts. The reference's "99% accuracy"-style claims are NOT
 * reproduced: RAMZA shows only numbers it can source. */

import { ArrowRight, CalendarClock, Percent, ReceiptText } from "lucide-react";
import { ct } from "./brand";
import { Reveal } from "./reveal";
import { TrackView } from "./tracked";
import { CT, rules, rulesMode, type RamzaMode } from "@/lib/ramza/rules";
import { dubaiToday } from "@/lib/dubai-day";

const aedFmt = (n: number) => `AED ${n.toLocaleString("en-US")}`;
const longDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Cut top-right corner, like the reference's cards. */
const chamfer = "[clip-path:polygon(0_0,calc(100%-64px)_0,100%_64px,100%_100%,0_100%)]";

/** The thin row above a section: brand · topic · number. */
export function SlideMeta({ topic, index, dark = false }: { topic: string; index: string; dark?: boolean }) {
  const tone = dark ? "text-[#8FB0FF]/80" : "text-[#6B77A0]";
  return (
    <div className={`grid grid-cols-3 text-[12.5px] ${tone}`}>
      <span>RAMZA</span>
      <span className="text-center">{topic}</span>
      <span className="text-right tabular-nums">{index}</span>
    </div>
  );
}

/* ── the Corporate Tax calendar, as the reference's timeline pills ───────── */

export function DeadlineTimeline() {
  const mode: RamzaMode = rulesMode(dubaiToday());
  const dec = rules.ct.deadlines[0];
  const steps = [
    { key: "yearend", date: longDay(dec.fy_end), title: "Financial year ends", body: "Books for the year need to be complete before the return can be prepared.", active: false },
    { key: "deadline", date: longDay(dec.due), title: "Return and tax due", body: `${CT.filingMonths} months after year end. Filing late starts the penalty the next day.`, active: mode === "deadline" },
    { key: "rescue", date: `to ${longDay(rules.campaign.rescue_mode_until)}`, title: "Late-filer rescue", body: `Every month or part month late adds ${aedFmt(CT.lateFilingFirst12Aed)}. Filing now stops it growing.`, active: mode === "rescue" },
  ];
  return (
    <section className="relative overflow-x-clip bg-[#F7F9FE] pb-20 pt-6 text-white">
      <TrackView section="timeline" className={ct.container}>
        <Reveal className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-[#2347D9] via-[#3A5FE6] to-[#6F8DFF] px-6 py-8 sm:px-10 sm:py-10">
          <SlideMeta topic="Corporate Tax calendar" index="02" dark />
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-[#E4EAFF]">For businesses whose financial year ends on 31 December.</p>
          <div className="relative mt-8 grid gap-6 md:grid-cols-3 md:gap-0">
            {steps.map((s, i) => (
              <div key={s.key} className={`relative md:px-6 ${i > 0 ? "md:border-l md:border-dashed md:border-white/35" : ""}`}>
                <span
                  className={`inline-flex items-center rounded-[22px] px-5 py-3 text-[26px] font-medium tracking-[-0.02em] sm:text-[30px] ${
                    s.active
                      ? "bg-[#0A1A4A] text-white shadow-[0_24px_50px_-20px_rgba(5,13,43,0.8)] ring-2 ring-white/40"
                      : "bg-white/15 text-white/90 ring-1 ring-white/25 backdrop-blur"
                  }`}
                >
                  {s.date}
                </span>
                {s.active && <span className="ml-3 inline-flex rounded-full bg-white px-2.5 py-1 text-[11.5px] font-medium text-[#2347D9]">Now</span>}
                <h3 className="mt-5 text-[19px] font-medium">{s.title}</h3>
                <p className="mt-1.5 max-w-xs text-[14px] leading-relaxed text-[#E4EAFF]">{s.body}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </TrackView>
    </section>
  );
}

/* ── what late costs, as the reference's three stat cards ────────────────── */

export function StakesSection() {
  const cards = [
    { icon: CalendarClock, big: String(CT.filingMonths), unit: "months", label: "To file after year end", note: "Return and payment are both due at the end of it" },
    { icon: ReceiptText, big: CT.lateFilingFirst12Aed.toLocaleString("en-US"), unit: "AED", label: "Per late month, first year", note: `Rises to ${aedFmt(CT.lateFilingAfter12Aed)} a month after twelve` },
    { icon: Percent, big: String(Math.round(CT.latePaymentRatePa * 100)), unit: "%", label: "A year on unpaid tax", note: "Charged monthly on top of the late-filing penalty" },
  ];
  return (
    <section className={`${ct.sectionLight} pb-24 pt-24`}>
      <TrackView section="stakes" className={ct.container}>
        <SlideMeta topic="What late costs" index="03" />
        <Reveal className="mt-10 grid gap-6 lg:grid-cols-[1fr_0.8fr] lg:items-end">
          <h2 className={`${ct.h2} max-w-xl text-[#0A1A4A]`}>File on time. Every late month has a price.</h2>
          <p className={ct.body}>The penalties are fixed by Cabinet Decision, not negotiated. Catching up the books is the part we make fast.</p>
        </Reveal>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {cards.map((c, i) => {
            const hero = i === cards.length - 1;
            return (
              <Reveal key={c.label} delay={i * 0.08}>
                <article
                  className={`${chamfer} flex h-full min-h-[300px] flex-col justify-between rounded-[28px] p-7 ${
                    hero ? "bg-gradient-to-br from-[#2347D9] to-[#6F8DFF] text-white" : "bg-[#E3EAFF] text-[#0A1A4A]"
                  }`}
                >
                  <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${hero ? "bg-white/20 text-white" : "bg-white/70 text-[#2347D9]"}`} aria-hidden><c.icon size={22} /></span>
                  <div>
                    <div className="flex items-baseline gap-1.5">
                      {c.unit === "AED" && <span className={`text-[28px] font-medium ${hero ? "text-white" : "text-[#2347D9]"}`}>AED</span>}
                      <span className={`text-[88px] font-semibold leading-none tracking-[-0.05em] sm:text-[96px] ${hero ? "text-white" : "text-[#2347D9]"}`}>{c.big}</span>
                      {c.unit !== "AED" && <span className={`text-[34px] font-medium ${hero ? "text-white" : "text-[#2347D9]"}`}>{c.unit}</span>}
                    </div>
                    <h3 className={`mt-3 text-[22px] font-medium tracking-[-0.01em] ${hero ? "text-white" : "text-[#1B38B3]"}`}>{c.label}</h3>
                    <p className={`mt-6 text-right text-[13.5px] leading-snug ${hero ? "text-[#E4EAFF]" : "text-[#1B38B3]"}`}>{c.note}</p>
                  </div>
                </article>
              </Reveal>
            );
          })}
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <a href="#start" className={ct.btnPrimary}>Start my filing <ArrowRight size={16} /></a>
          <span className="text-[13px] text-[#6B77A0]">Source: {rules.ct.late_filing_penalty.legal_basis}</span>
        </div>
      </TrackView>
    </section>
  );
}
