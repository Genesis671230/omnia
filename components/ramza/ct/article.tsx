/* Long-form layout for the RAMZA Corporate Tax detail pages: content blocks on
   the left, a sticky "check your dates" card on the right. */

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, BadgeCheck, SearchCheck } from "lucide-react";
import { ct } from "./brand";
import { Reveal } from "./reveal";

export type Block = { h: string; p?: string[]; list?: string[]; table?: [string, string][]; note?: string };

export function Article({ blocks, aside }: { blocks: Block[]; aside?: ReactNode }) {
  return (
    <section className={`${ct.sectionLight} pb-24 pt-24`}>
      <div className={`${ct.container} grid gap-10 lg:grid-cols-[1fr_340px]`}>
        <div className="space-y-6">
          {blocks.map((b, i) => (
            <Reveal key={b.h} delay={Math.min(i * 0.04, 0.2)}>
              <article className={ct.card}>
                <h2 className="text-[22px] font-medium tracking-[-0.015em] text-[#0A1A4A]">{b.h}</h2>
                {b.p?.map((t) => <p key={t} className={`${ct.body} mt-3`}>{t}</p>)}
                {b.list && (
                  <ul className="mt-4 space-y-2.5">
                    {b.list.map((t) => <li key={t} className="flex gap-2.5 text-[15px] text-[#0A1A4A]"><BadgeCheck size={18} className="mt-0.5 shrink-0 text-[#2347D9]" />{t}</li>)}
                  </ul>
                )}
                {b.table && (
                  <dl className="mt-5 divide-y divide-[#E3E9F7] overflow-hidden rounded-2xl ring-1 ring-[#E3E9F7]">
                    {b.table.map(([k, v]) => (
                      <div key={k} className="grid grid-cols-[1fr_auto] gap-4 bg-white px-4 py-3 text-[14.5px]">
                        <dt className="text-[#4A5680]">{k}</dt><dd className="text-right font-medium text-[#0A1A4A]">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {b.note && <p className="mt-4 rounded-2xl bg-[#EEF3FF] px-4 py-3 text-[13.5px] text-[#2347D9]">{b.note}</p>}
              </article>
            </Reveal>
          ))}
        </div>
        <aside className="lg:sticky lg:top-28 lg:self-start">
          {aside ?? <CheckAside />}
        </aside>
      </div>
    </section>
  );
}

export function CheckAside() {
  return (
    <div className="relative overflow-hidden rounded-[28px] bg-[#050D2B] p-7 text-white">
      <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full border border-[#4C7BFF]/30" />
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full border border-[#4C7BFF]/40" />
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#2347D9]"><SearchCheck size={19} /></span>
      <h3 className="mt-5 text-[20px] font-medium">Check your dates</h3>
      <p className="mt-2 text-[14px] leading-relaxed text-[#B9C6EE]">Enter the notice date and your tax period — see which windows are still open, in seconds.</p>
      <Link href="/ramza/penalty-checker" className={`${ct.btnWhite} mt-6 w-full`}>Open the checker <ArrowRight size={16} /></Link>
      <Link href="/ramza/contact" className="mt-3 block text-center text-[13.5px] text-[#C9D5FF] hover:text-white">or talk to an expert →</Link>
    </div>
  );
}
