/* RAMZA home — Corporate Tax filed on time (AI bookkeeping + expert accountants).
 *
 * Conversion arc, one job per section:
 *   Hero        promise + deadline countdown + the form (primary action: "Start my filing")
 *   Proof       a real client who was close to the deadline
 *   Problem     name the gap: deadline in days, books months behind
 *   How         three steps — makes "we can still make it" believable
 *   Case study  the Mobius story in full
 *   Services    what you can buy
 *   People      real accountants review everything (trust)
 *   Penalty     secondary path for people already late
 *   FAQ         objections
 *   Final CTA   countdown + form again
 *
 * Photos: /public/ramza/photos (Unsplash, stock — never given names or quotes).
 * Tracking: <TrackView> fires SectionView / ViewContent; forms fire FormStart + Lead. */

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Bot, CalendarClock, FileCheck2, FileSearch, MessageCircle, Plus, ReceiptText, ShieldCheck, Sparkles, UploadCloud, UserCheck } from "lucide-react";
import { ct } from "./brand";
import { Rings, Seam } from "./art";
import { Countdown } from "./countdown";
import { CtLeadForm } from "./lead-form";
import { Reveal } from "./reveal";
import { TrackView, WhatsAppLink } from "./tracked";
import { CT, FILING_PARTNER, RESCUE_FEE_AED, rulesMode } from "@/lib/ramza/rules";
import { dubaiToday } from "@/lib/dubai-day";

const aedFmt = (n: number) => `AED ${n.toLocaleString("en-US")}`;
const ratePct = (r: number) => `${Math.round(r * 100)}%`;

const P = "/ramza/photos";

/* ── 1. hero ─────────────────────────────────────────────────────────── */

export function HomeHero({ whatsappHref }: { whatsappHref: string }) {
  // Rescue copy switches on by itself the day after the deadline (page revalidates hourly).
  const rescue = rulesMode(dubaiToday()) === "rescue";
  const badge = rescue
    ? `Missed 30 Sep? File before 1 Nov — the penalty grows each month`
    : "31 Dec year end? Return due 30 September";
  return (
    <section className={`${ct.sectionDark} bg-[#0B1E57] pb-20 pt-28 sm:pt-32`}>
      {/* dawn skyline under a softer blue wash — readable, not heavy */}
      <Image src={`${P}/dubai-dawn.jpg`} alt="" fill priority sizes="100vw" className="object-cover object-center" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#0B1E57]/88 via-[#12307F]/62 to-[#1E4BD1]/10" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#0B1E57]/70 to-transparent" />
      {/* phones: text runs full width over the bright sky, so wash it evenly */}
      <div className="pointer-events-none absolute inset-0 bg-[#0B1E57]/55 lg:hidden" />

      <TrackView section="hero" className={`${ct.container} grid items-start gap-12 lg:grid-cols-[1.08fr_0.92fr]`}>
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[12.5px] text-[#DCE4FF] ring-1 ring-white/15">
            <CalendarClock size={14} className="text-[#8FB0FF]" /> {badge}
          </span>
          <h1 className="mt-5 text-[38px] font-medium leading-[1.06] tracking-[-0.03em] sm:text-[50px] lg:text-[56px]">
            Your Corporate Tax return,{" "}
            <span className="bg-gradient-to-r from-[#8FB0FF] to-[#4C7BFF] bg-clip-text text-transparent">filed before the deadline.</span>
          </h1>
          <p className={`${ct.leadDark} mt-6 max-w-xl`}>
            Books not ready? Our AI does the bookkeeping, UAE accountants check every figure, and your return is filed on EmaraTax by our licensed partner, {FILING_PARTNER}.
          </p>
          <div className="mt-8 max-w-xl"><Countdown /></div>
          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-[13.5px] text-[#B9C6EE]">
            <WhatsAppLink href={whatsappHref} placement="hero" className="inline-flex items-center gap-2 font-medium text-white hover:underline"><MessageCircle size={16} /> Talk on WhatsApp now</WhatsAppLink>
            <Link href="/ramza/penalty-checker" className="inline-flex items-center gap-1.5 hover:text-white">Already got a penalty? Check it <ArrowRight size={14} /></Link>
          </div>
        </div>

        {/* the form, right in the hero */}
        <div id="start" className="scroll-mt-28 rounded-[32px] bg-white p-6 text-[#0A1A4A] shadow-[0_40px_100px_-40px_rgba(5,13,43,0.55)] sm:p-7">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[22px] font-medium tracking-[-0.02em]">{rescue ? "Stop the penalty growing" : "Get filed on time"}</h2>
              <p className="mt-1 text-[14px] text-[#4A5680]">{rescue && RESCUE_FEE_AED ? `One-off rescue ${aedFmt(RESCUE_FEE_AED)} · ` : ""}20 seconds. An accountant replies on WhatsApp.</p>
            </div>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EEF3FF] text-[#2347D9]"><ShieldCheck size={20} /></span>
          </div>
          <CtLeadForm placement="hero" cta="Start my filing" />
        </div>
      </TrackView>
      <Seam from="dark" />
    </section>
  );
}

/* ── 2. proof strip ──────────────────────────────────────────────────── */

export function ProofStrip() {
  return (
    <section className={`${ct.sectionLight} pb-10 pt-20`}>
      <div className={ct.container}>
        <Reveal className="flex flex-col items-center gap-5 rounded-[28px] bg-white px-6 py-6 text-center shadow-[0_18px_50px_-34px_rgba(10,26,74,0.35)] sm:flex-row sm:text-left">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#0A1A4A] text-white"><Sparkles size={24} /></span>
          <p className="flex-1 text-[15.5px] leading-relaxed text-[#0A1A4A]">
            <b className="font-medium">Mobius Network Artificial Intelligence</b> was days from the deadline with its books unprocessed. We caught up the bookkeeping and filed on time.
          </p>
          <a href="#case" className={`${ct.link} inline-flex shrink-0 items-center gap-1.5 text-[14.5px]`}>Read what happened <ArrowRight size={15} /></a>
        </Reveal>
      </div>
    </section>
  );
}

/* ── 3. problem ──────────────────────────────────────────────────────── */

export function ProblemSection() {
  const pains = [
    { t: "Your accountant is stuck on the backlog", d: "Months of bank lines, invoices and receipts still aren’t booked — and the return can’t be prepared without them." },
    { t: "The numbers don’t tie out", d: "Gateway payouts, card fees and bank credits never quite match, so every figure needs checking twice." },
    { t: "Late costs money every month", d: `${aedFmt(CT.lateFilingFirst12Aed)} a month for the first year of a late return, ${aedFmt(CT.lateFilingAfter12Aed)} after, plus ${ratePct(CT.latePaymentRatePa)} a year on unpaid tax.` },
  ];
  return (
    <section className={`${ct.sectionLight} pb-24 pt-16`}>
      <TrackView section="problem" className={`${ct.container} grid items-center gap-12 lg:grid-cols-2`}>
        <Reveal className="relative">
          <div className="relative aspect-[4/3] overflow-hidden rounded-[32px]">
            <Image src={`${P}/team-screen.jpg`} alt="Accounting team reviewing figures together" fill sizes="(min-width:1024px) 560px, 100vw" className="object-cover" />
          </div>
          <div className="absolute -bottom-6 left-6 right-6 flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-xl sm:left-auto sm:w-[300px]">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FDECEF] text-[#C2334D]"><CalendarClock size={18} /></span>
            <span className="text-[13px] leading-tight text-[#0A1A4A]"><b className="block font-medium">Deadline in days</b><span className="text-[#6B77A0]">Books months behind</span></span>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <span className={ct.eyebrow}>Sound familiar?</span>
          <h2 className={`${ct.h2} mt-4`}>The deadline is close. The books aren’t done.</h2>
          <div className="mt-8 space-y-5">
            {pains.map((p) => (
              <div key={p.t} className="flex gap-4">
                <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EEF3FF] text-[#2347D9]"><Plus size={14} className="rotate-45" /></span>
                <div><div className="text-[16.5px] font-medium text-[#0A1A4A]">{p.t}</div><p className={`${ct.body} mt-1`}>{p.d}</p></div>
              </div>
            ))}
          </div>
          <p className="mt-8 border-l-2 border-[#2347D9] pl-4 text-[16px] font-medium text-[#0A1A4A]">That gap — between messy records and a filed return — is exactly what we close.</p>
        </Reveal>
      </TrackView>
    </section>
  );
}

/* ── 4. how it works ─────────────────────────────────────────────────── */

export function HowSection() {
  const steps = [
    { n: "01", icon: UploadCloud, t: "Send us what you have", d: "Bank statements, sales and purchase invoices, trade licence. Messy is fine — WhatsApp or upload.", img: "portrait-tablet.jpg", alt: "Business owner holding a tablet" },
    { n: "02", icon: Bot, t: "AI books it, accountants check it", d: "Our AI categorises every transaction and matches payouts to the bank. An accountant reviews each figure.", img: "team-lounge.jpg", alt: "Accountants reviewing books together" },
    { n: "03", icon: FileCheck2, t: "Filed, with proof", d: `We prepare the return, you approve it, our licensed partner ${FILING_PARTNER} submits it on EmaraTax, and you get the confirmation.`, img: "handshake.jpg", alt: "Handshake after a completed filing" },
  ];
  return (
    <section id="how" className={`${ct.sectionIce} scroll-mt-24 pb-24 pt-24`}>
      <Rings size={560} tone="light" className="absolute -right-40 top-0" />
      <TrackView section="how" className={ct.container}>
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className={ct.eyebrow}>How it works</span>
          <h2 className={`${ct.h2} mt-4`}>From a pile of statements to a filed return</h2>
          <p className={`${ct.lead} mt-4`}>Three steps. You approve before anything is submitted.</p>
        </Reveal>
        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.1}>
              <article className="h-full overflow-hidden rounded-[28px] bg-white shadow-[0_24px_60px_-34px_rgba(10,26,74,0.4)]">
                <div className="relative aspect-[16/10]">
                  <Image src={`${P}/${s.img}`} alt={s.alt} fill sizes="(min-width:1024px) 380px, 100vw" className="object-cover" />
                  <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-[12px] font-medium text-[#0A1A4A] backdrop-blur">Step {s.n}</span>
                </div>
                <div className="p-6">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#2347D9] text-white"><s.icon size={19} /></span>
                  <h3 className={`${ct.h3} mt-5 text-[#0A1A4A]`}>{s.t}</h3>
                  <p className={`${ct.body} mt-2`}>{s.d}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
        <div className="mt-12 text-center">
          <a href="#start" className={ct.btnPrimary}>Start my filing <ArrowRight size={16} /></a>
        </div>
      </TrackView>
      <Seam from="light" icon="check" />
    </section>
  );
}

/* ── 5. case study ───────────────────────────────────────────────────── */

export function CaseStudySection() {
  return (
    <section id="case" className={`${ct.sectionDark} scroll-mt-24 pb-28 pt-28`}>
      <Rings size={640} className="absolute -left-52 bottom-0 opacity-40" />
      <TrackView section="case-study" event="ViewContent" className={`${ct.container} grid items-stretch gap-8 lg:grid-cols-[1.05fr_0.95fr]`}>
        <Reveal className="relative min-h-[360px] overflow-hidden rounded-[32px]">
          <Image src={`${P}/meeting-room.jpg`} alt="Team working through the books in a meeting room" fill sizes="(min-width:1024px) 600px, 100vw" className="object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#050D2B]/85 via-transparent to-transparent" />
          <div className="absolute bottom-6 left-6 right-6 grid grid-cols-3 gap-2">
            {[["Close", "to the deadline"], ["Backlog", "booked by AI"], ["Filed", "on time"]].map(([a, b]) => (
              <div key={a} className="rounded-2xl bg-white/10 px-3 py-3 ring-1 ring-white/15 backdrop-blur-md">
                <div className="text-[18px] font-medium text-white">{a}</div>
                <div className="text-[12px] text-[#C9D5FF]">{b}</div>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={0.1} className="flex flex-col justify-center">
          <span className={ct.eyebrowDark}>Case study</span>
          <h2 className={`${ct.h2} mt-4`}>Mobius Network Artificial Intelligence</h2>
          <div className="mt-6 space-y-5 text-[16px] leading-relaxed text-[#C9D5FF]">
            <p><b className="font-medium text-white">The situation.</b> The Corporate Tax deadline was almost here, and their accountants couldn’t get the bookkeeping processed in time. Without finished books, there was no return to file.</p>
            <p><b className="font-medium text-white">What we did.</b> Our AI took on the backlog — categorising transactions and reconciling them to the bank — while our accountants reviewed the figures and prepared the return.</p>
            <p><b className="font-medium text-white">The result.</b> Books completed and the return filed on time, with no late-filing penalty.</p>
          </div>
          <a href="#start" className={`${ct.btnWhite} mt-9 self-start`}>Get the same result <ArrowRight size={16} /></a>
        </Reveal>
      </TrackView>
      <Seam from="dark" />
    </section>
  );
}

/* ── 6. services ─────────────────────────────────────────────────────── */

export function ServicesGrid() {
  const items = [
    { icon: FileCheck2, t: "Corporate Tax return filing", d: `Prepared and reviewed by us, submitted on EmaraTax by ${FILING_PARTNER} — after you approve.`, img: "presenting.jpg", href: "#start" },
    { icon: ReceiptText, t: "Bookkeeping catch-up", d: "Months of backlog booked fast: AI categorisation, accountant review, bank-matched.", img: "team-screen.jpg", href: "#start" },
    { icon: UserCheck, t: "Corporate Tax registration", d: "Registered correctly the first time, with your tax periods set up right.", img: "portrait-smile.jpg", href: "#start" },
    { icon: FileSearch, t: "Penalty help", d: `Waivers, the ${CT.reconsiderationBusinessDays}-business-day reconsideration, and instalment requests.`, img: "portrait-suit.jpg", href: "/ramza/penalty-checker" },
  ];
  return (
    <section id="services" className={`${ct.sectionLight} scroll-mt-24 pb-24 pt-28`}>
      <TrackView section="services" className={ct.container}>
        <Reveal className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div className="max-w-xl">
            <span className={ct.eyebrow}>What we do</span>
            <h2 className={`${ct.h2} mt-4`}>Everything between your bank statements and a filed return</h2>
          </div>
          <Link href="/ramza/services" className={ct.btnPrimary}>All services <ArrowRight size={16} /></Link>
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((it, i) => (
            <Reveal key={it.t} delay={i * 0.07}>
              <Link href={it.href} className="group block h-full overflow-hidden rounded-[28px] bg-white shadow-[0_24px_60px_-36px_rgba(10,26,74,0.4)] transition hover:-translate-y-1">
                <div className="relative aspect-[4/3] overflow-hidden">
                  <Image src={`${P}/${it.img}`} alt="" fill sizes="(min-width:1024px) 290px, 50vw" className="object-cover transition duration-500 group-hover:scale-105" />
                </div>
                <div className="p-5">
                  <it.icon size={20} className="text-[#2347D9]" />
                  <h3 className="mt-3 text-[17px] font-medium text-[#0A1A4A]">{it.t}</h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-[#4A5680]">{it.d}</p>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </TrackView>
    </section>
  );
}

/* ── 7. people ───────────────────────────────────────────────────────── */

export function PeopleSection({ whatsappHref }: { whatsappHref: string }) {
  const promises = ["A named accountant on your file", "Every figure reviewed before filing", "Answers on WhatsApp, not a ticket queue", "Fixed quote before any work"];
  return (
    <section className={`${ct.sectionIce} pb-28 pt-24`}>
      <TrackView section="people" className={`${ct.container} grid items-center gap-12 lg:grid-cols-2`}>
        <Reveal>
          <span className={ct.eyebrow}>AI speed, human sign-off</span>
          <h2 className={`${ct.h2} mt-4`}>Real accountants check every return</h2>
          <p className={`${ct.lead} mt-4`}>AI does the heavy lifting on the books. People you can message make the decisions, and nothing is filed until you’ve approved it.</p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {promises.map((p) => <li key={p} className="flex gap-2.5 text-[15px] text-[#0A1A4A]"><BadgeCheck size={18} className="mt-0.5 shrink-0 text-[#2347D9]" />{p}</li>)}
          </ul>
          <WhatsAppLink href={whatsappHref} placement="people" className={`${ct.btnPrimary} mt-9`}><MessageCircle size={16} /> Message an accountant</WhatsAppLink>
        </Reveal>
        {/* the reference's testimonial panel, without a quote: stock photography
            carries no name or words (see the header note) */}
        <Reveal delay={0.1} className="relative [height:520px]">
          <div className="absolute inset-x-0 bottom-0 top-16 rounded-[32px] bg-[#DDE6FF] [clip-path:polygon(0_0,calc(100%-72px)_0,100%_72px,100%_100%,0_100%)]" />
          <div className="absolute bottom-0 left-[12%] right-[6%] top-24 overflow-hidden rounded-t-[140px] bg-gradient-to-b from-[#AFC3FF] to-[#6F8DFF]">
            <Image src={`${P}/portrait-tablet.jpg`} alt="" fill sizes="(min-width:1024px) 480px, 90vw" className="object-cover object-top" />
          </div>
          <div className="absolute left-0 top-0 max-w-[260px] rounded-3xl bg-white px-5 py-4 shadow-[0_24px_60px_-30px_rgba(10,26,74,0.45)]">
            <span className="text-[44px] font-semibold leading-none text-[#2347D9]" aria-hidden>“</span>
            <p className="-mt-3 text-[15px] font-medium leading-snug text-[#0A1A4A]">Nothing reaches the FTA until an accountant has checked it and you’ve approved it.</p>
            <p className="mt-2 text-[12.5px] text-[#6B77A0]">The RAMZA review promise</p>
          </div>
          <div className="absolute bottom-5 right-5 flex items-center gap-3 rounded-2xl bg-[#0A1A4A] px-4 py-3 text-white">
            <ShieldCheck size={22} className="shrink-0 text-[#8FB0FF]" />
            <span className="text-[13px] leading-snug">Filed by {FILING_PARTNER}<br /><span className="text-[#B9C6EE]">our licensed partner</span></span>
          </div>
        </Reveal>
      </TrackView>
      <Seam from="light" />
    </section>
  );
}

/* ── 8. already late? (secondary path) ───────────────────────────────── */

export function PenaltyBand() {
  const facts = [
    [aedFmt(CT.lateRegistrationAed), `late-registration fine — waived only if the first return was filed within ${CT.waiverMonths} months of the first tax period`],
    [`${CT.reconsiderationBusinessDays} business days`, "from a penalty notice to ask the FTA to reconsider"],
    [`${aedFmt(CT.lateFilingFirst12Aed)} / month`, `late filing for the first year, then ${aedFmt(CT.lateFilingAfter12Aed)}`],
  ];
  return (
    <section className={`${ct.sectionLight} pb-24 pt-28`}>
      <TrackView section="penalty" className={ct.container}>
        <Reveal className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-[#0A1A4A] to-[#2347D9] p-8 text-white sm:p-12">
          <Rings size={520} className="absolute -right-40 -top-40 opacity-50" />
          <div className="relative grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div>
              <span className={ct.eyebrowDark}>Already late?</span>
              <h2 className="mt-4 text-[30px] font-medium leading-tight tracking-[-0.02em] sm:text-[36px]">Got a penalty? It may not be final.</h2>
              <p className="mt-4 text-[16px] leading-relaxed text-[#DCE4FF]">See in seconds whether it can be waived or reconsidered — and how many days you have left.</p>
              <Link href="/ramza/penalty-checker" className={`${ct.btnWhite} mt-7`}>Check my penalty <ArrowRight size={16} /></Link>
            </div>
            <div className="grid gap-3">
              {facts.map(([a, b]) => (
                <div key={a} className="flex items-center gap-4 rounded-2xl bg-white/10 px-5 py-4 ring-1 ring-white/15 backdrop-blur">
                  <span className="min-w-[132px] text-[20px] font-medium">{a}</span>
                  <span className="text-[14px] leading-snug text-[#DCE4FF]">{b}</span>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </TrackView>
    </section>
  );
}

/* ── 9. FAQ ──────────────────────────────────────────────────────────── */

export const HOME_FAQ = [
  { q: "Can you still file before the deadline?", a: "Often, yes — it depends on how quickly we can get your bank statements and sales records. Message us today and we’ll tell you honestly whether the timeline works before you commit to anything." },
  { q: "What do you need from me?", a: "Bank statements for the tax period, sales and purchase invoices (or your accounting export), your trade licence, and EmaraTax access — or we’ll walk you through granting it." },
  { q: "My books are months behind. Is that a problem?", a: "That’s the job. Our AI categorises the backlog and matches it to your bank, and an accountant reviews every figure. You don’t need to tidy anything first." },
  { q: "How much does it cost?", a: "You get a fixed quote after the free review, based on your transaction volume and how far behind the books are. No surprises and no hourly billing." },
  { q: "We already have an accountant.", a: "We can work alongside them — taking the backlog so they can finish the return — or handle the filing end to end. Mobius Network Artificial Intelligence came to us exactly like this." },
  { q: "I’ve already received a penalty.", a: `Use the free penalty checker to see whether it can be waived or reconsidered, then send us the result. The reconsideration window is ${CT.reconsiderationBusinessDays} business days from the notice, so it’s worth acting quickly.` },
];

export function HomeFaq() {
  return (
    <section className={`${ct.sectionIce} pb-24 pt-24`}>
      <TrackView section="faq" className={`${ct.container} grid gap-12 lg:grid-cols-[0.8fr_1.2fr]`}>
        <Reveal>
          <span className={ct.eyebrow}>Questions</span>
          <h2 className={`${ct.h2} mt-4`}>Before you start</h2>
          <div className="relative mt-8 hidden aspect-[4/5] max-w-[340px] overflow-hidden rounded-[28px] lg:block">
            <Image src={`${P}/portrait-tablet.jpg`} alt="" fill sizes="340px" className="object-cover" />
          </div>
        </Reveal>
        <Reveal delay={0.1} className="space-y-3">
          {HOME_FAQ.map((f, i) => (
            <details key={f.q} open={i === 0} className="group rounded-3xl bg-white px-6 py-5 shadow-[0_10px_30px_-24px_rgba(10,26,74,0.4)]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-medium text-[#0A1A4A] [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EEF3FF] text-[#2347D9] transition group-open:rotate-45"><Plus size={16} /></span>
              </summary>
              <p className={`${ct.body} mt-3`}>{f.a}</p>
            </details>
          ))}
        </Reveal>
      </TrackView>
    </section>
  );
}

/* ── 10. final CTA ───────────────────────────────────────────────────── */

export function FinalCta({ whatsappHref }: { whatsappHref: string }) {
  return (
    <section id="contact" className={`${ct.sectionDark} scroll-mt-24 pb-28 pt-28`}>
      <Image src={`${P}/dubai-dawn.jpg`} alt="" fill sizes="100vw" className="object-cover opacity-35" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#050D2B] via-[#050D2B]/85 to-[#050D2B]" />
      <TrackView section="final-cta" className={`${ct.container} grid items-center gap-10 lg:grid-cols-[1fr_0.95fr]`}>
        <Reveal>
          <span className={ct.eyebrowDark}>Don’t wait for the notice</span>
          <h2 className={`${ct.h2} mt-4`}>File on time. Skip the penalty.</h2>
          <p className={`${ct.leadDark} mt-4 max-w-lg`}>Send us what you have today. We’ll tell you what’s needed, give you a fixed quote, and get your return filed.</p>
          <div className="mt-8 max-w-lg"><Countdown /></div>
          <WhatsAppLink href={whatsappHref} placement="final" className={`${ct.btnGhostDark} mt-7`}><MessageCircle size={16} /> Or message us on WhatsApp</WhatsAppLink>
        </Reveal>
        <Reveal delay={0.1} className="rounded-[32px] bg-white p-6 text-[#0A1A4A] sm:p-8">
          <h3 className="text-[22px] font-medium tracking-[-0.02em]">Start my filing</h3>
          <p className="mb-5 mt-1 text-[14px] text-[#4A5680]">Free review · fixed quote · reply on WhatsApp</p>
          <CtLeadForm placement="final" cta="Start my filing" />
        </Reveal>
      </TrackView>
    </section>
  );
}
