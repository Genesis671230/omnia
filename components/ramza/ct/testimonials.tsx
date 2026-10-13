/* "In their words" — real client quotes, under the e-invoicing section.
 * Data and the rules for adding one: lib/ramza/testimonials.ts. Renders
 * nothing until there is at least one consented quote. */

import Image from "next/image";
import { TESTIMONIALS, type Testimonial } from "@/lib/ramza/testimonials";
import { ct } from "./brand";
import { Reveal } from "./reveal";
import { TrackView } from "./tracked";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

function Person({ t, size }: { t: Testimonial; size: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="relative shrink-0 overflow-hidden rounded-2xl bg-[#F1EFEA]" style={{ width: size, height: size }}>
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
    <section id="clients" className={`${ct.sectionLight} scroll-mt-24 pb-24 pt-20`}>
      <TrackView section="testimonials" className={ct.container}>
        <Reveal className="max-w-2xl">
          <span className={ct.eyebrow}>In their words</span>
          <h2 className={`${ct.h2} mt-4`}>Brands that stopped chasing their own payouts</h2>
        </Reveal>
        <div className={`mt-12 grid gap-5 ${rest.length ? "lg:grid-cols-[1.25fr_1fr]" : ""}`}>
          <Reveal className={`${ct.island} flex flex-col justify-between gap-10 p-8 sm:p-10`}>
            <blockquote className="font-[family-name:var(--font-display)] text-[24px] font-medium leading-[1.3] tracking-[-0.015em] sm:text-[28px]">
              <span className="text-[#B3A6FF]">“</span>{lead.quote}<span className="text-[#B3A6FF]">”</span>
            </blockquote>
            <div>
              {lead.outcome && <p className="mb-6 inline-flex rounded-full bg-white/10 px-3.5 py-1.5 text-[13px] text-[#E6E4EA] ring-1 ring-white/15">{lead.outcome}</p>}
              <Person t={lead} size={52} />
            </div>
          </Reveal>
          {rest.length > 0 && (
            <div className="grid gap-5">
              {rest.slice(0, 3).map((t, i) => (
                <Reveal key={t.name} delay={0.08 * (i + 1)} className="flex flex-col justify-between gap-6 rounded-[28px] bg-white p-6 text-[#14131C] ring-1 ring-[#E8E5DE]">
                  <blockquote className="text-[16px] leading-relaxed">“{t.quote}”</blockquote>
                  {t.outcome && <p className="text-[13px] font-medium text-[#4F35E8]">{t.outcome}</p>}
                  <Person t={t} size={44} />
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </TrackView>
    </section>
  );
}
