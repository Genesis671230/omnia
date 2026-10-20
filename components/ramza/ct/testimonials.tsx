/* "In their words" — real client quotes, under the e-invoicing section.
 * Data and the rules for adding one: lib/ramza/testimonials.ts. Renders
 * nothing until there is at least one consented quote.
 * Sits on an office photo under a flat navy wash; with a single quote the
 * second column shows the animated agent (Spring drop: Payout feed has a demo
 * counter, which must never sit next to a real client's words). */

import Image from "next/image";
import { LogoStage } from "@/components/ramza/brand/agent";
import { TESTIMONIALS, type Testimonial } from "@/lib/ramza/testimonials";
import { ct } from "./brand";
import { Reveal } from "./reveal";
import { TrackView } from "./tracked";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

function Person({ t, size }: { t: Testimonial; size: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="relative shrink-0 overflow-hidden rounded-2xl bg-[#EEF1F7]" style={{ width: size, height: size }}>
        {t.photo
          ? <Image src={`/ramza/testimonials/${t.photo}`} alt={t.name} fill sizes={`${size}px`} className="object-cover" />
          : <span className="flex h-full w-full items-center justify-center font-[family-name:var(--font-display)] text-[15px] font-semibold text-[#4F35E8]">{initials(t.name)}</span>}
      </span>
      <span className="text-[13.5px] leading-snug">
        <b className="block font-semibold">{t.name}</b>
        <span className="opacity-70">{t.role}, {t.company}</span>
      </span>
      {t.logo && <span className="relative ml-auto h-7 w-20 shrink-0"><Image src={`/ramza/testimonials/${t.logo}`} alt={t.company} fill sizes="80px" className="object-contain object-right" /></span>}
    </div>
  );
}

export function TestimonialsSection() {
  if (!TESTIMONIALS.length) return null;
  const [lead, ...rest] = TESTIMONIALS;
  return (
    <section id="clients" className="relative scroll-mt-24 overflow-hidden bg-[#0B1533] py-20 text-white sm:py-24">
      <Image src="/ramza/photos/bb-office-lounge-skyline.jpg" alt="" fill sizes="100vw" className="object-cover" />
      <div className="absolute inset-0 bg-[#0B1533]/85" />
      <TrackView section="testimonials" className={ct.container}>
        <Reveal className="max-w-2xl">
          <span className={ct.eyebrowDark}>In their words</span>
          <h2 className={`${ct.h2} mt-4`}>Brands that stopped chasing their own payouts</h2>
        </Reveal>
        <div className="mt-12 grid gap-5 lg:grid-cols-[1.35fr_1fr]">
          <Reveal className="flex flex-col justify-between gap-10 rounded-[8px] bg-white p-8 text-[#14131C] sm:p-10">
            <blockquote className="font-[family-name:var(--font-display)] text-[22px] font-medium leading-[1.35] tracking-[-0.015em] sm:text-[26px]">
              <span className="text-[#3A55E6]">“</span>{lead.quote}<span className="text-[#3A55E6]">”</span>
            </blockquote>
            <div>
              {lead.outcome && <p className="mb-6 inline-flex rounded-[4px] bg-[#EEF1F7] px-3 py-1.5 text-[13px] font-medium text-[#0B1533]">{lead.outcome}</p>}
              <Person t={lead} size={52} />
              {lead.disclosure && <p className="mt-4 border-t border-[#E3E7F0] pt-3 text-[12px] text-[#7A8294]">{lead.disclosure}</p>}
            </div>
          </Reveal>
          {rest.length > 0 ? (
            <div className="grid gap-5">
              {rest.slice(0, 3).map((t, i) => (
                <Reveal key={t.name} delay={0.08 * (i + 1)} className="flex flex-col justify-between gap-6 rounded-[8px] bg-white p-6 text-[#14131C]">
                  <blockquote className="text-[16px] leading-relaxed">“{t.quote}”</blockquote>
                  {t.outcome && <p className="text-[13px] font-medium text-[#3A55E6]">{t.outcome}</p>}
                  <Person t={t} size={44} />
                </Reveal>
              ))}
            </div>
          ) : (
            <Reveal delay={0.08} className="flex flex-col justify-between overflow-hidden rounded-[8px] border border-white/15 bg-[#07090D]">
              <div className="mx-auto w-full max-w-[380px]"><LogoStage direction={1} theme="dark" label="RAMZA agent logo, animated" /></div>
              <p className="border-t border-white/15 p-5 text-[14px] leading-relaxed text-[#C4CAD9]">
                The agent behind {lead.company}&apos; close: every payout from every gateway, matched to the bank and the orders inside it.
              </p>
            </Reveal>
          )}
        </div>
      </TrackView>
    </section>
  );
}
