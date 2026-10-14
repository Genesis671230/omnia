/* Sections shared by the RAMZA Corporate Tax pages. Each is a full-width band;
   dark and light bands alternate.

   Facts used here (all from the FTA's published rules):
   • late registration penalty            AED 10,000
   • waiver if the first return is filed  within 7 months of the first tax period's end
   • reconsideration request              within 40 business days of the notice
   • late filing                          AED 500 / month (first 12), then AED 1,000 / month
   • return due                           9 months after the tax period ends */

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, BadgeCheck, CalendarClock, ClipboardCheck, FileCheck2, FileSearch, Languages, Layers, ListChecks, Plus, Scale, ShieldCheck, Timer } from "lucide-react";
import { ct } from "./brand";
import { NoticeArt, WindowArt } from "./art";
import { Reveal } from "./reveal";
import { HeroConsole } from "./hero-console";
import { CtLeadForm } from "./lead-form";

/* ── hero ─────────────────────────────────────────────────────────────── */

export function CtHero() {
  return (
    <section className={`${ct.sectionDark} pb-24 pt-32 sm:pt-36`}>
      {/* backdrop: glow + rings + faint grid */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_70%_20%,rgba(184,149,90,0.35),transparent_70%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:56px_56px]" />

      <div className={`${ct.container} grid items-start gap-12 lg:grid-cols-[1.05fr_1fr]`}>
        {/* no scroll-reveal above the fold: the hero must render without JS */}
        <div>
          <span className={ct.eyebrowDark}><span className="h-1.5 w-1.5 rounded-full bg-[#B3A6FF]" /> UAE Corporate Tax penalties</span>
          <h1 className={`${ct.h1} mt-5`}>
            Got a Corporate Tax penalty?{" "}
            <span className="bg-gradient-to-r from-[#CBC3FF] to-[#B3A6FF] bg-clip-text text-transparent">You may still clear it.</span>
          </h1>
          <p className={`${ct.leadDark} mt-6 max-w-xl`}>
            See in seconds whether the AED 10,000 late-registration fine can be waived, how many business days are left to ask the FTA to reconsider, and what the late-filing penalty is costing you each month.
          </p>
          <ul className="mt-8 space-y-3 text-[15px] text-[#E6E4EA]">
            {[
              "The AED 10,000 registration fine is waived if your first return is filed within 7 months",
              "You have 40 business days from the notice to request reconsideration",
              "We prepare the Arabic submission and file it before your deadline",
            ].map((t) => (
              <li key={t} className="flex gap-3"><BadgeCheck size={19} className="mt-0.5 shrink-0 text-[#B3A6FF]" />{t}</li>
            ))}
          </ul>
          <div className="mt-10 flex flex-wrap items-center gap-6 text-[13px] text-[#8E8B95]">
            <span className="flex items-center gap-2"><ShieldCheck size={16} className="text-[#B3A6FF]" /> Private & free first review</span>
            <span className="flex items-center gap-2"><Timer size={16} className="text-[#B3A6FF]" /> Reply within one business day</span>
          </div>
        </div>

        <div>
          <HeroConsole />
        </div>
      </div>
    </section>
  );
}

/* ── sub-page hero (same look, no console) ───────────────────────────── */

export function PageHero({ eyebrow, title, lead, children }: { eyebrow: string; title: ReactNode; lead: string; children?: ReactNode }) {
  return (
    <section className={`${ct.sectionDark} pb-24 pt-36`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_80%_10%,rgba(184,149,90,0.32),transparent_70%)]" />
      <div className={`${ct.container} max-w-[900px]`}>
        <div>
          <span className={ct.eyebrowDark}><span className="h-1.5 w-1.5 rounded-full bg-[#B3A6FF]" /> {eyebrow}</span>
          <h1 className={`${ct.h1} mt-5`}>{title}</h1>
          <p className={`${ct.leadDark} mt-6 max-w-2xl`}>{lead}</p>
          {children && <div className="mt-8 flex flex-wrap gap-3">{children}</div>}
        </div>
      </div>
    </section>
  );
}

/* ── the rules as numbers ─────────────────────────────────────────────── */

export function FactsBand() {
  const facts = [
    { v: "AED 10,000", l: "Late registration penalty", icon: FileSearch },
    { v: "7 months", l: "File your first return within this to have it waived", icon: CalendarClock },
    { v: "40 days", l: "Business days to request reconsideration", icon: Scale },
    { v: "AED 500", l: "Per month late filing, first 12 months — then AED 1,000", icon: Timer },
  ];
  return (
    <section className={`${ct.sectionLight} pb-20 pt-24`}>
      <div className={ct.container}>
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className={ct.eyebrow}>The rules, in four numbers</span>
          <h2 className={`${ct.h2} mt-4`}>Every deadline counts — here are the ones that matter</h2>
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {facts.map((f, i) => (
            <Reveal key={f.v} delay={i * 0.07}>
              <div className={`${ct.card} h-full`}>
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#EEF1F7] text-[#4F35E8]"><f.icon size={20} strokeWidth={1.6} /></span>
                <div className="mt-6 text-[32px] font-medium tracking-[-0.03em] text-[#14131C]">{f.v}</div>
                <p className="mt-1 text-[14px] leading-snug text-[#55525E]">{f.l}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── three routes to clear or reduce a penalty ────────────────────────── */

export function RoutesSection() {
  const routes = [
    { n: "01", t: "Automatic waiver", d: "Late registration only. File your first Corporate Tax return or annual declaration within 7 months of your first tax period ending — the AED 10,000 penalty is cancelled, or credited back if you already paid.", href: "/ramza/late-registration-waiver", icon: FileCheck2 },
    { n: "02", t: "Reconsideration request", d: "Ask the FTA to review the penalty within 40 business days of the notice, with a clear reason and evidence, submitted in Arabic through EmaraTax.", href: "/ramza/reconsideration", icon: Scale },
    { n: "03", t: "Waiver or instalments", d: "Past the window? Once the underlying issue is fixed (registered, returns filed, nothing else outstanding) a penalty waiver or instalment plan may still be requested.", href: "/ramza/corporate-tax-penalties", icon: Layers },
  ];
  return (
    <section className={`${ct.sectionIce} pb-24 pt-28`}>
      <div className={ct.container}>
        <Reveal className="max-w-2xl">
          <span className={ct.eyebrow}>Your options</span>
          <h2 className={`${ct.h2} mt-4`}>Three ways a penalty can be cleared or reduced</h2>
          <p className={`${ct.lead} mt-4`}>Which one fits depends on the penalty and on the dates. The checker tells you which windows are still open.</p>
        </Reveal>
        {/* connected cards: a thread with ring nodes runs behind them on desktop */}
        <div className="relative mt-14">
          <div className="absolute left-0 right-0 top-[52px] hidden h-px bg-gradient-to-r from-transparent via-[#4F35E8]/30 to-transparent lg:block" />
          <div className="grid gap-5 lg:grid-cols-3">
            {routes.map((r, i) => (
              <Reveal key={r.n} delay={i * 0.1}>
                <Link href={r.href} className={`${ct.card} group relative block h-full transition hover:-translate-y-1`}>
                  <div className="flex items-center justify-between">
                    <span className="relative flex h-14 w-14 items-center justify-center rounded-full border border-[#4F35E8]/20 bg-white">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0B1533] text-white"><r.icon size={18} /></span>
                    </span>
                    <span className="text-[13px] font-medium text-[#A19EA6]">{r.n}</span>
                  </div>
                  <h3 className={`${ct.h3} mt-6 text-[#14131C]`}>{r.t}</h3>
                  <p className={`${ct.body} mt-2`}>{r.d}</p>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-medium text-[#4F35E8]">Read the details <ArrowRight size={15} className="transition group-hover:translate-x-1" /></span>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── the 40-business-day window ───────────────────────────────────────── */

export function WindowSection() {
  const steps = [
    ["Read the notice", "Note the violation, amount and the date it was issued — that date starts the clock."],
    ["Build the case", "A valid reason (e.g. a portal fault, a wrong deadline shown to you, circumstances outside your control) with documents that prove it."],
    ["Submit in Arabic on EmaraTax", "The request goes through the Reconsideration tab, written in Arabic or with a legal Arabic translation."],
    ["Decision — and next step", "If the FTA upholds the penalty, the decision can be taken to the Tax Disputes Resolution Committee within its own deadline."],
  ];
  return (
    <section className={`${ct.sectionLight} pb-24 pt-28`}>
      <div className={`${ct.container} grid items-center gap-14 lg:grid-cols-2`}>
        <Reveal>
          <span className={ct.eyebrow}>The 40-business-day window</span>
          <h2 className={`${ct.h2} mt-4`}>Penalty notice today? The clock is already running.</h2>
          <p className={`${ct.lead} mt-4`}>A reconsideration request has to reach the FTA within 40 business days of the notice. Weekends don’t count — which gives you about eight weeks, not forty days.</p>
          <ol className="mt-8 space-y-5">
            {steps.map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0B1533] text-[13px] font-medium text-white">{i + 1}</span>
                <div><div className="text-[16px] font-medium text-[#14131C]">{t}</div><p className={`${ct.body} mt-0.5`}>{d}</p></div>
              </li>
            ))}
          </ol>
          <Link href="/ramza/reconsideration" className={`${ct.btnPrimary} mt-9`}>How reconsideration works <ArrowRight size={16} /></Link>
        </Reveal>
        <Reveal delay={0.15} className="space-y-8">
          <NoticeArt />
          <div className="pt-6"><WindowArt used={14} /></div>
        </Reveal>
      </div>
    </section>
  );
}

/* ── services (reference: numbered accordion) ─────────────────────────── */

export const SERVICES = [
  { n: "01", t: "Corporate Tax return filing", d: "We prepare the return from your books, an accountant reviews it, you approve it, and we submit it on EmaraTax before the deadline.", points: ["Return prepared and reviewed", "Your approval before submission", "Filing confirmation sent to you"] },
  { n: "02", t: "Bookkeeping catch-up", d: "Months behind? Our AI categorises the backlog and matches it to your bank; accountants review every figure so the return rests on clean numbers.", points: ["AI categorisation of every transaction", "Bank and payout reconciliation", "Accountant review"], href: "/ramza/payout-reconciliation" },
  { n: "03", t: "Corporate Tax registration", d: "Registered with the right tax period from the start — and if you registered late, your first return filed inside the 7-month window so the AED 10,000 fine is waived.", points: ["Registration on EmaraTax", "Tax period set up correctly", "Late-registration waiver timing"] },
  { n: "04", t: "Penalty review & reconsideration", d: "Got a notice? We map your deadlines, then prepare the Arabic reconsideration request with its evidence and file it inside the 40 business days.", points: ["Deadline map for your case", "Arabic statement of grounds", "Filed before the deadline"] },
  { n: "05", t: "Waiver & instalment requests", d: "When the reconsideration window has passed, we put compliance right first, then request a waiver or an instalment plan where the rules allow.", points: ["Compliance put right", "Signed undertaking prepared", "Waiver or instalment request"] },
];

export function ServicesSection({ openFirst = true }: { openFirst?: boolean }) {
  return (
    <section className={`${ct.sectionLight} pb-24 pt-24`}>
      <div className={`${ct.container} grid gap-12 lg:grid-cols-[0.8fr_1.2fr]`}>
        <Reveal>
          <span className={ct.eyebrow}>What we do</span>
          <h2 className={`${ct.h2} mt-4`}>From bank statements to a filed return</h2>
          <p className={`${ct.lead} mt-4`}>One team for the whole path — bookkeeping, filing, registration, and penalty help if a deadline was missed.</p>
          <Link href="/ramza/services" className={`${ct.btnPrimary} mt-8`}>All services <ArrowRight size={16} /></Link>
        </Reveal>
        <Reveal delay={0.1} className="divide-y divide-[#E3E7F0] rounded-[28px] bg-white px-6 shadow-[0_24px_60px_-32px_rgba(20,19,28,0.3)] sm:px-8">
          {SERVICES.map((s, i) => (
            // native <details>: accessible, works without JS
            <details key={s.n} open={openFirst && i === 0} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-medium text-[#14131C] [&::-webkit-details-marker]:hidden">
                <span><span className="mr-3 text-[13px] text-[#A19EA6]">[{s.n}]</span>{s.t}</span>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EEF1F7] text-[#4F35E8] transition group-open:rotate-45"><Plus size={16} /></span>
              </summary>
              <div className="pl-10 pt-3">
                <p className={ct.body}>{s.d}</p>
                <ul className="mt-3 space-y-1.5">
                  {s.points.map((p) => <li key={p} className="flex items-center gap-2 text-[14px] text-[#14131C]"><BadgeCheck size={16} className="text-[#4F35E8]" />{p}</li>)}
                </ul>
                {"href" in s && s.href && <Link href={s.href} className={`${ct.link} mt-3 inline-block text-[14px]`}>About payout reconciliation →</Link>}
              </div>
            </details>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

/* ── why us (dark glass cards) ────────────────────────────────────────── */

export function WhySection() {
  const items = [
    { t: "Deadline first", d: "We work from your notice date backwards, so nothing is filed a day late.", icon: CalendarClock },
    { t: "Arabic, done properly", d: "Submissions are prepared in Arabic with the evidence the FTA asks for.", icon: Languages },
    { t: "Fixed quote", d: "You know the cost after the free review, before any work starts.", icon: ClipboardCheck },
    { t: "Won’t repeat", d: "We fix the bookkeeping behind the penalty so the next return is on time.", icon: ListChecks },
  ];
  return (
    <section className={`${ct.sectionDark} pb-28 pt-28`}>
      <div className={ct.container}>
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className={ct.eyebrowDark}>Why RAMZA</span>
          <h2 className={`${ct.h2} mt-4`}>Calm, exact and on time</h2>
        </Reveal>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((it, i) => (
            <Reveal key={it.t} delay={i * 0.08}>
              <div className={`${ct.glass} h-full`}>
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0B1533]"><it.icon size={19} /></span>
                <h3 className={`${ct.h3} mt-6`}>{it.t}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-[#B8B6C0]">{it.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── FAQ ──────────────────────────────────────────────────────────────── */

export const CT_FAQ = [
  { q: "Can the AED 10,000 late registration penalty really be cancelled?", a: "Yes, under the FTA’s waiver initiative: if you file your first Corporate Tax return or annual declaration within 7 months of the end of your first tax period, the late-registration penalty is waived automatically. If you already paid it, the amount is credited back and can be refunded." },
  { q: "What exactly are the “40 days”?", a: "40 business days from the date you were notified of the penalty. That is the deadline for asking the FTA to reconsider it. Weekends don’t count, so it is roughly eight weeks — but it is a deadline to apply, not a promise that the penalty will be removed." },
  { q: "What counts as a good reason for reconsideration?", a: "Something you can prove and that explains the failure: a documented EmaraTax fault, an official deadline communicated to you incorrectly, a tax period set up wrongly, or circumstances genuinely outside your control. A clear timeline and documents matter more than long arguments." },
  { q: "I missed the 40 business days. Is it over?", a: "Not always. Once the underlying issue is corrected — you’re registered, returns are filed and nothing else is outstanding — a penalty waiver request may still be possible, and larger amounts can sometimes be paid in instalments." },
  { q: "How much is the late filing penalty?", a: "A Corporate Tax return is due 9 months after the tax period ends. Filing late costs AED 500 for each month or part of a month for the first 12 months, then AED 1,000 per month after that." },
  { q: "Is the checker advice?", a: "No — it applies the published rules to the dates you enter so you know where you stand. Public holidays can push real deadlines slightly later. Send us the result for a free review of your actual case." },
];

export function FaqSection({ items = CT_FAQ }: { items?: { q: string; a: string }[] }) {
  return (
    <section className={`${ct.sectionLight} pb-24 pt-28`}>
      <div className={`${ct.container} grid gap-12 lg:grid-cols-[0.8fr_1.2fr]`}>
        <Reveal>
          <span className={ct.eyebrow}>Questions</span>
          <h2 className={`${ct.h2} mt-4`}>What people ask first</h2>
        </Reveal>
        <Reveal delay={0.1} className="space-y-3">
          {items.map((f) => (
            <details key={f.q} className="group rounded-3xl bg-white px-6 py-5 shadow-[0_10px_30px_-24px_rgba(20,19,28,0.4)]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-medium text-[#14131C] [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EEF1F7] text-[#4F35E8] transition group-open:rotate-45"><Plus size={16} /></span>
              </summary>
              <p className={`${ct.body} mt-3`}>{f.a}</p>
            </details>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

/* ── closing call to action (reference: form + hours card) ────────────── */

export function CtaSection({ whatsappHref }: { whatsappHref: string }) {
  return (
    <section id="contact" className={`${ct.sectionIce} scroll-mt-24 pb-28 pt-24`}>
      <div className={`${ct.container} grid gap-6 lg:grid-cols-[1.25fr_0.75fr]`}>
        <Reveal className={ct.card}>
          <span className={ct.eyebrow}>Free penalty review</span>
          <h2 className="mt-3 text-[28px] font-medium tracking-[-0.02em] text-[#14131C]">Tell us what happened</h2>
          <p className={`${ct.body} mb-6 mt-2`}>Two minutes. A specialist replies on WhatsApp within one business day.</p>
          <CtLeadForm />
        </Reveal>
        <Reveal delay={0.1} className="relative overflow-hidden rounded-[28px] bg-gradient-to-b from-[#4F35E8] to-[#14131C] p-8 text-white">
          <ShieldCheck size={32} strokeWidth={1.4} />
          <h3 className="mt-6 text-[22px] font-medium">Prefer to talk?</h3>
          <p className="mt-2 text-[14.5px] text-[#E6E4EA]">Send the notice on WhatsApp and we’ll tell you where you stand.</p>
          <ol className="mt-8 space-y-3 border-t border-white/15 pt-6 text-[14px]">
            {["You send the notice or your dates", "We map your deadlines and options", "You get a fixed quote — then we file"].map((t, i) => (
              <li key={t} className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-[12px]">{i + 1}</span>
                <span className="text-[#E6E4EA]">{t}</span>
              </li>
            ))}
          </ol>
          <a href={whatsappHref} className={`${ct.btnWhite} relative mt-8 w-full`}>WhatsApp us <ArrowRight size={16} /></a>
        </Reveal>
      </div>
    </section>
  );
}
