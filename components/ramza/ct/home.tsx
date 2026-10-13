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
import { ArrowRight, FileCheck2, ReceiptText } from "lucide-react";
import { ct } from "./brand";
import { Countdown } from "./countdown";
import { HeroStage } from "./hero-stage";
import { LogoMarquee } from "./partner-logos";
import { CtLeadForm } from "./lead-form";
import { Reveal } from "./reveal";
import { TrackView, WhatsAppLink } from "./tracked";
import { CT, EINV, FILING_PARTNER, RESCUE_FEE_AED, rulesMode } from "@/lib/ramza/rules";
import { dubaiToday } from "@/lib/dubai-day";

const aedFmt = (n: number) => `AED ${n.toLocaleString("en-US")}`;
const ratePct = (r: number) => `${Math.round(r * 100)}%`;
const aedMillions = (n: number) => `AED ${n / 1_000_000}M`;
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const P = "/ramza/photos";

/* ── 1. hero ─────────────────────────────────────────────────────────── */

export function HomeHero({ whatsappHref }: { whatsappHref: string }) {
  // CT rescue line stays on through rules.json's rescue window (page revalidates hourly).
  const rescue = rulesMode(dubaiToday()) === "rescue";
  return (
    <section className="relative overflow-x-clip text-[#14131C]">
      <TrackView section="hero" className={`${ct.container} relative grid items-center gap-12 pb-14 pt-28 sm:pt-32 lg:min-h-[min(calc(100svh-40px),860px)] lg:grid-cols-[1fr_1fr] lg:pb-16`}>
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-[12.5px] text-[#55525E] ring-1 ring-[#E8E5DE]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" aria-hidden /> For UAE e-commerce &amp; retail brands
          </span>
          <h1 className="mt-6 max-w-[16ch] font-[family-name:var(--font-display)] text-[40px] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-[52px] lg:text-[60px]">
            Every payout matched. Every invoice <span className="text-[#4F35E8]">e‑invoicing ready.</span>
          </h1>
          <p className="mt-6 max-w-[33rem] text-[16.5px] leading-relaxed text-[#55525E] sm:text-[18px]">
            Tabby, Tamara, Stripe, Telr and COD all settle on different days, net of different fees. RAMZA matches every payout to its orders and the bank, books it in Zoho, and gets your invoice data ready for e-invoicing — checked by accountants.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="#start" className={`${ct.btnPrimary} h-[52px] px-7 text-[15.5px]`}>Get a free reconciliation check <ArrowRight size={16} /></a>
            <a href="#free-tools" className="inline-flex h-[52px] items-center justify-center gap-2 rounded-full bg-white px-6 text-[15px] font-medium text-[#14131C] ring-1 ring-[#E2DFD8] transition hover:ring-[#14131C]/30">Am I in e-invoicing scope?</a>
          </div>

          <dl className="mt-10 grid max-w-[34rem] grid-cols-3 gap-px overflow-hidden rounded-2xl bg-[#E8E5DE] ring-1 ring-[#E8E5DE]">
            {[["5+", "gateways in one view"], ["3-way", "order · payout · bank"], ["Every", "match signed off"]].map(([v, l]) => (
              <div key={l} className="bg-white/80 px-4 py-3.5">
                <dt className="font-[family-name:var(--font-display)] text-[20px] font-semibold tracking-[-0.02em]">{v}</dt>
                <dd className="mt-0.5 text-[12px] leading-snug text-[#6E6B75]">{l}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-[#6E6B75]">
            <span>Large businesses ({aedMillions(EINV.largeRevenueAed)}+) appoint a provider by <b className="font-medium text-[#14131C]">{shortDay(EINV.largeAspBy)}</b> · <span className="text-[#4F35E8]"><Countdown variant="bar" /></span></span>
            {rescue && <Link href="/ramza/penalty-checker" className="hover:text-[#14131C]">Missed the CT deadline? <span className="text-[#14131C] underline decoration-[#B3A6FF] underline-offset-4">Rescue filing</span></Link>}
            <WhatsAppLink href={whatsappHref} placement="hero" className="hover:text-[#14131C]">WhatsApp us</WhatsAppLink>
          </div>
        </div>

        <HeroStage />
      </TrackView>

      {/* the gateways, in their own colours, between two hairlines */}
      <div className="border-y border-[#E8E5DE] py-6">
        <div className={`${ct.container} flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-8`}>
          <p className="shrink-0 text-[13px] leading-snug text-[#6E6B75] lg:w-[220px]">Reconciles the gateways and books you already use</p>
          <div className="min-w-0 flex-1"><LogoMarquee /></div>
        </div>
      </div>
    </section>
  );
}

/* ── 1b. start: real retail photo + the form ─────────────────────────── */

export function StartSection() {
  const rescue = rulesMode(dubaiToday()) === "rescue";
  const steps = [
    ["01", "Tell us your gateways", "Which of Tabby, Tamara, Stripe, Telr, Shopify Payments or COD you take, and where your books live."],
    ["02", "We pull a month and match it", "Orders → payout → bank credit, line by line, with fees and VAT split out."],
    ["03", "You get the unmatched list", "What’s missing, what’s short-paid, what’s booked twice — before anything posts to Zoho."],
  ];
  return (
    <section id="start" className={`${ct.sectionLight} scroll-mt-24 pb-24 pt-24`}>
      <TrackView section="start" className={`${ct.container} grid items-start gap-12 lg:grid-cols-[1.05fr_0.95fr]`}>
        <Reveal>
          <span className={ct.eyebrow}>Free reconciliation check</span>
          <h2 className={`${ct.h2} mt-4 max-w-[18ch]`}>See exactly which payouts never reached your books.</h2>
          <div className="relative mt-8 grid grid-cols-[1.25fr_0.75fr] gap-3">
            <div className="relative aspect-[4/3.4] overflow-hidden rounded-[28px]">
              <Image src={`${P}/px-studio-packing.jpg`} alt="Store owner wrapping an online order in her studio" fill sizes="(min-width:1024px) 380px, 60vw" className="object-cover transition duration-[1.6s] hover:scale-105" />
            </div>
            <div className="grid gap-3">
              <div className="relative overflow-hidden rounded-[28px]"><Image src={`${P}/px-order-label.jpg`} alt="Order boxed and labelled for the courier" fill sizes="220px" className="object-cover" /></div>
              <div className="relative overflow-hidden rounded-[28px]"><Image src={`${P}/px-card-terminal.jpg`} alt="Customer paying by card at the counter" fill sizes="220px" className="object-cover" /></div>
            </div>
            <div className="absolute -bottom-6 left-5 right-5 rounded-2xl bg-white p-4 shadow-[0_24px_60px_-28px_rgba(20,19,28,0.4)] ring-1 ring-black/[0.04] sm:right-auto sm:max-w-[360px]">
              <p className="text-[13.5px] leading-snug text-[#14131C]"><b className="font-semibold">Mobius Network Artificial Intelligence</b> came to us days from a deadline with the books unprocessed. Caught up and filed on time.</p>
              <a href="#case" className="mt-1.5 inline-block text-[13px] font-medium text-[#4F35E8] hover:underline">Read what happened</a>
            </div>
          </div>
          <ol className="mt-16 space-y-5">
            {steps.map(([n, t, d]) => (
              <li key={n} className="grid grid-cols-[52px_1fr] gap-4">
                <span className="font-[family-name:var(--font-display)] text-[28px] font-semibold leading-none text-[#4F35E8]">{n}</span>
                <div><div className="text-[16px] font-semibold text-[#14131C]">{t}</div><p className={`${ct.body} mt-1`}>{d}</p></div>
              </li>
            ))}
          </ol>
        </Reveal>

        <Reveal delay={0.1} className="lg:sticky lg:top-28">
          <div className="rounded-[28px] bg-white p-6 shadow-[0_1px_2px_rgba(20,19,28,0.04),0_40px_80px_-48px_rgba(20,19,28,0.35)] ring-1 ring-[#E8E5DE] sm:p-8">
            <h3 className="font-[family-name:var(--font-display)] text-[24px] font-semibold tracking-[-0.02em] text-[#14131C]">Tell us what you need</h3>
            <p className="mb-5 mt-1 text-[14px] text-[#55525E]">20 seconds. An accountant replies on WhatsApp with what we need.</p>
            <CtLeadForm placement="start" cta="Send" initialSituation="reconciliation" chips={["reconciliation", "einvoicing", "books_behind", "file_return"]} />
          </div>
        </Reveal>
      </TrackView>
    </section>
  );
}

/* ── 2. proof strip ──────────────────────────────────────────────────── */

export function ProofStrip() {
  return (
    <section className={`${ct.sectionLight} pb-10 pt-20`}>
      <div className={ct.container}>
        <Reveal className="flex flex-col items-center gap-5 rounded-[28px] bg-white px-6 py-6 text-center shadow-[0_18px_50px_-34px_rgba(20,19,28,0.35)] sm:flex-row sm:text-left">
          <p className="flex-1 text-[15.5px] leading-relaxed text-[#14131C]">
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
            <span className="text-[13px] leading-tight text-[#14131C]"><b className="block font-medium">Deadline in days</b><span className="text-[#6E6B75]">Books months behind</span></span>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <span className={ct.eyebrow}>Sound familiar?</span>
          <h2 className={`${ct.h2} mt-4`}>The deadline is close. The books aren’t done.</h2>
          <div className="mt-8 space-y-5">
            {pains.map((p) => (
              <div key={p.t} className="flex gap-4">
                <span className="mt-2 h-2 w-2 shrink-0 rotate-45 bg-[#C2334D]" aria-hidden />
                <div><div className="text-[16.5px] font-medium text-[#14131C]">{p.t}</div><p className={`${ct.body} mt-1`}>{p.d}</p></div>
              </div>
            ))}
          </div>
          <p className="mt-8 border-l-2 border-[#4F35E8] pl-4 text-[16px] font-medium text-[#14131C]">That gap — between messy records and a filed return — is exactly what we close.</p>
        </Reveal>
      </TrackView>
    </section>
  );
}

/* ── 5. case study ───────────────────────────────────────────────────── */

export function CaseStudySection() {
  return (
    <section id="case" className={`${ct.sectionLight} scroll-mt-24 py-16`}>
      <TrackView section="case-study" event="ViewContent" className={ct.container}>
        <Reveal className={`${ct.island} grid items-stretch gap-8 p-5 sm:p-8 lg:grid-cols-[1.05fr_0.95fr] lg:p-10`}>
          <div className="relative min-h-[360px] overflow-hidden rounded-[26px]">
            <Image src={`${P}/meeting-room.jpg`} alt="Team working through the books in a meeting room" fill sizes="(min-width:1024px) 560px, 100vw" className="object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#14131C]/85 via-transparent to-transparent" />
            <div className="absolute bottom-5 left-5 right-5 grid grid-cols-3 gap-2">
              {[["Close", "to the deadline"], ["Backlog", "booked by AI"], ["Filed", "on time"]].map(([a, b]) => (
                <div key={a} className="rounded-2xl bg-white/10 px-3 py-3 ring-1 ring-white/15 backdrop-blur-md">
                  <div className="text-[18px] font-medium text-white">{a}</div>
                  <div className="text-[12px] text-[#E6E4EA]">{b}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col justify-center lg:pr-4">
            <span className={ct.eyebrowDark}>Case study</span>
            <h2 className={`${ct.h2} mt-4`}>Mobius Network Artificial Intelligence</h2>
            <div className="mt-6 space-y-5 text-[16px] leading-relaxed text-[#D6D4DC]">
              <p><b className="font-medium text-white">The situation.</b> The Corporate Tax deadline was almost here, and their accountants couldn’t get the bookkeeping processed in time. Without finished books, there was no return to file.</p>
              <p><b className="font-medium text-white">What we did.</b> Our AI took on the backlog — categorising transactions and reconciling them to the bank — while our accountants reviewed the figures and prepared the return.</p>
              <p><b className="font-medium text-white">The result.</b> Books completed and the return filed on time, with no late-filing penalty.</p>
            </div>
            <a href="#start" className={`${ct.btnWhite} mt-9 self-start`}>Get the same result <ArrowRight size={16} /></a>
          </div>
        </Reveal>
      </TrackView>
    </section>
  );
}

/* ── 6. services ─────────────────────────────────────────────────────── */

export function ServicesGrid() {
  const items = [
    { icon: FileCheck2, t: "Gateway payout reconciliation", d: "Tabby, Tamara, Stripe, Telr, Shopify Payments and COD matched to orders and the bank, then booked in Zoho.", img: "px-statements-calculator.jpg", href: "#start" },
    { icon: FileCheck2, t: "E-invoicing readiness", d: "Invoice data cleaned to the UAE fields, an accredited provider lined up, your books connected.", img: "px-founder-bright.jpg", href: "#e-invoicing" },
    { icon: FileCheck2, t: "Corporate Tax return filing", d: `Prepared and reviewed by us, submitted on EmaraTax by ${FILING_PARTNER} — after you approve.`, img: "px-accountant-files.jpg", href: "#start" },
    { icon: ReceiptText, t: "Bookkeeping catch-up", d: "Months of backlog booked fast: AI categorisation, accountant review, bank-matched.", img: "px-analyst-desk.jpg", href: "#start" },
  ];
  return (
    <section id="services" className={`${ct.sectionLight} scroll-mt-24 pb-24 pt-28`}>
      <TrackView section="services" className={ct.container}>
        <Reveal className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div className="max-w-xl">
            <span className={ct.eyebrow}>What we do</span>
            <h2 className={`${ct.h2} mt-4`}>From the checkout to the ledger to the FTA</h2>
          </div>
          <Link href="/ramza/services" className={ct.btnPrimary}>All services <ArrowRight size={16} /></Link>
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((it, i) => (
            <Reveal key={it.t} delay={i * 0.07}>
              <Link href={it.href} className="group block h-full overflow-hidden rounded-[28px] bg-white ring-1 ring-[#E8E5DE] transition hover:-translate-y-1 hover:shadow-[0_30px_60px_-40px_rgba(20,19,28,0.45)]">
                <div className="relative aspect-[4/3] overflow-hidden">
                  <Image src={`${P}/${it.img}`} alt="" fill sizes="(min-width:1024px) 290px, 50vw" className="object-cover transition duration-500 group-hover:scale-105" />
                </div>
                <div className="p-5">
                  <h3 className="font-[family-name:var(--font-display)] text-[18px] font-semibold text-[#14131C]">{it.t}</h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-[#55525E]">{it.d}</p>
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
            {promises.map((p) => <li key={p} className="flex items-baseline gap-3 text-[15px] text-[#14131C]"><span className="h-2 w-2 shrink-0 rotate-45 bg-[#4F35E8]" aria-hidden />{p}</li>)}
          </ul>
          <WhatsAppLink href={whatsappHref} placement="people" className={`${ct.btnPrimary} mt-9`}>Message an accountant</WhatsAppLink>
        </Reveal>
        {/* stock photography carries no name or words (see the header note) */}
        <Reveal delay={0.1} className="relative [height:520px]">
          <div className="absolute bottom-0 left-[8%] right-0 top-10 overflow-hidden rounded-[36px] bg-[#E8E5DE]">
            <Image src={`${P}/px-accountant-review.jpg`} alt="Accountant reviewing a client file" fill sizes="(min-width:1024px) 520px, 90vw" className="object-cover object-[50%_30%]" />
          </div>
          <div className="absolute left-0 top-0 max-w-[270px] rounded-3xl bg-white px-5 py-4 shadow-[0_24px_60px_-30px_rgba(20,19,28,0.4)] ring-1 ring-black/[0.04]">
            <span className="font-[family-name:var(--font-display)] text-[44px] font-semibold leading-none text-[#4F35E8]" aria-hidden>“</span>
            <p className="-mt-3 text-[15px] font-medium leading-snug text-[#14131C]">Nothing reaches the FTA until an accountant has checked it and you’ve approved it.</p>
            <p className="mt-2 text-[12.5px] text-[#6E6B75]">The RAMZA review promise</p>
          </div>
          <div className="absolute bottom-5 right-5 rounded-2xl bg-[#14131C] px-4 py-3 text-white">
            <span className="text-[13px] leading-snug">Filed by {FILING_PARTNER}<br /><span className="text-[#B8B6C0]">our licensed partner</span></span>
          </div>
        </Reveal>
      </TrackView>
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
        <Reveal className="relative overflow-hidden rounded-[36px] bg-[#14131C] p-8 text-white sm:p-12">
          <div className="relative grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div>
              <span className={ct.eyebrowDark}>Already late?</span>
              <h2 className="mt-4 text-[30px] font-medium leading-tight tracking-[-0.02em] sm:text-[36px]">Got a penalty? It may not be final.</h2>
              <p className="mt-4 text-[16px] leading-relaxed text-[#E6E4EA]">See in seconds whether it can be waived or reconsidered — and how many days you have left.</p>
              <Link href="/ramza/penalty-checker" className={`${ct.btnWhite} mt-7`}>Check my penalty <ArrowRight size={16} /></Link>
            </div>
            <div className="grid gap-3">
              {facts.map(([a, b]) => (
                <div key={a} className="flex items-center gap-4 rounded-2xl bg-white/10 px-5 py-4 ring-1 ring-white/15 backdrop-blur">
                  <span className="min-w-[132px] text-[20px] font-medium">{a}</span>
                  <span className="text-[14px] leading-snug text-[#E6E4EA]">{b}</span>
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
            <Image src={`${P}/px-owner-tablet.jpg`} alt="" fill sizes="340px" className="object-cover" />
          </div>
        </Reveal>
        <Reveal delay={0.1} className="space-y-3">
          {HOME_FAQ.map((f, i) => (
            <details key={f.q} open={i === 0} className="group rounded-3xl bg-white px-6 py-5 ring-1 ring-[#E8E5DE]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-medium text-[#14131C] [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="shrink-0 font-[family-name:var(--font-display)] text-[24px] font-medium leading-none text-[#4F35E8] transition group-open:rotate-45" aria-hidden>+</span>
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
    <section id="contact" className={`${ct.sectionLight} scroll-mt-24 pb-24 pt-8`}>
      <TrackView section="final-cta" className={ct.container}>
        <div className={`${ct.island} px-6 py-12 sm:px-10 sm:py-16 lg:px-14`}>
          <Image src={`${P}/px-dubai-dusk.jpg`} alt="" fill sizes="(min-width:1200px) 1140px, 100vw" className="object-cover opacity-80" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#14131C]/95 via-[#14131C]/65 to-[#14131C]/10" />
          <div className="relative grid items-center gap-10 lg:grid-cols-[1fr_0.95fr]">
            <Reveal>
              <span className={ct.eyebrowDark}>Don’t wait for the notice</span>
              <h2 className={`${ct.h2} mt-4`}>File on time. Skip the penalty.</h2>
              <p className={`${ct.leadDark} mt-4 max-w-lg`}>Send us what you have today. We’ll tell you what’s needed, give you a fixed quote, and get your return filed.</p>
              <WhatsAppLink href={whatsappHref} placement="final" className={`${ct.btnGhostDark} mt-7`}>Or message us on WhatsApp</WhatsAppLink>
            </Reveal>
            <Reveal delay={0.1} className="rounded-[28px] bg-white p-6 text-[#14131C] sm:p-8">
              <h3 className="text-[22px] font-medium tracking-[-0.02em]">Start my filing</h3>
              <p className="mb-5 mt-1 text-[14px] text-[#55525E]">Free review · fixed quote · reply on WhatsApp</p>
              <CtLeadForm placement="final" cta="Start my filing" />
            </Reveal>
          </div>
        </div>
      </TrackView>
    </section>
  );
}
