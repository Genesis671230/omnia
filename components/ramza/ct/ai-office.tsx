"use client";

/* "Infrastructure, not another firm" — why RAMZA replaces a second
 * accounting firm. Visual: a real photo of a finance review, with the night
 * shift's activity feed scrolling on top of it (what the engine did while the
 * office was closed, and the accountant's sign-off in the morning).
 *
 * Feed lines are sample data (labelled), not a client's. Motion stops for
 * prefers-reduced-motion. Photo: Pexels stock, no names or quotes on people.
 * (Replaces the 2026-10 SVG robots/coffee illustration.) */

import Image from "next/image";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FILING_PARTNER } from "@/lib/ramza/rules";
import { ct } from "./brand";
import { Reveal } from "./reveal";
import { TrackView } from "./tracked";

const EASE = [0.22, 1, 0.36, 1] as const;

const FEED = [
  { t: "01:12", who: "engine", line: "Stripe payout read · 63 charges" },
  { t: "01:13", who: "engine", line: "Matched to bank credit · AED 24,009.20" },
  { t: "02:40", who: "engine", line: "Tamara SAR payout · FX at bank rate" },
  { t: "02:41", who: "engine", line: "Fee + VAT split · 27 orders" },
  { t: "03:05", who: "flag", line: "Short-paid order held for review" },
  { t: "04:18", who: "engine", line: "COD voucher parsed · courier charges split" },
  { t: "08:32", who: "human", line: "Accountant approved 131 matches" },
  { t: "08:33", who: "engine", line: "Booked in Zoho · payment · fee · VAT · FX" },
] as const;

const DOT = { engine: "bg-[#B3A6FF]", flag: "bg-[#F59E0B]", human: "bg-[#10B981]" } as const;

function NightFeed() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-20% 0px" });
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? FEED.length : 3);
  useEffect(() => {
    if (reduce || !inView) return;
    const t = setInterval(() => setN((x) => (x >= FEED.length ? 3 : x + 1)), 1400);
    return () => clearInterval(t);
  }, [reduce, inView]);
  const shown = FEED.slice(Math.max(0, n - 5), n);
  return (
    <div ref={ref} className="w-[min(340px,86vw)] rounded-[22px] bg-[#14131C]/88 p-4 text-white shadow-[0_30px_70px_-25px_rgba(12,11,18,0.7)] ring-1 ring-white/10 backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#B3A6FF]">
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#10B981] opacity-60 motion-reduce:hidden" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#10B981]" /></span>
          Overnight
        </span>
        <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-[#B8B6C0]">Sample</span>
      </div>
      <ul className="mt-3 space-y-2">
        <AnimatePresence initial={false}>
          {shown.map((f) => (
            <motion.li key={f.t + f.line} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              transition={{ duration: reduce ? 0 : 0.4, ease: EASE }} className="flex items-start gap-2.5 text-[12.5px]">
              <span className="mt-[3px] font-mono text-[11px] text-[#8E8B95]">{f.t}</span>
              <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${DOT[f.who]}`} />
              <span className={f.who === "human" ? "font-medium text-white" : "text-[#E6E4EA]"}>{f.line}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

export function AiOfficeSection() {
  const rows: [string, string, string][] = [
    ["Working hours", "Office hours, month-end rush", "Always on — nights and weekends"],
    ["Bank & gateway matching", "Typed and ticked by hand", "Automatic, every line"],
    ["Books ready", "Weeks after month-end", "Closed as the money lands"],
    ["Who checks", "Whoever is free", "A named accountant reviews"],
  ];
  return (
    <section className={`${ct.sectionLight} pb-24 pt-24`}>
      <TrackView section="ai-office" className={`${ct.container} grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]`}>
        <Reveal className="relative pb-14 sm:pb-0 sm:pr-10">
          <div className="relative aspect-[4/3.3] overflow-hidden rounded-[36px] bg-[#E8E5DE]">
            <Image src="/ramza/photos/px-charts-review.jpg" alt="Finance team going through the month’s figures" fill sizes="(min-width:1024px) 600px, 92vw" className="object-cover" />
            <div className="absolute inset-0 bg-gradient-to-tr from-[#14131C]/45 via-transparent to-transparent" />
          </div>
          <div className="absolute -bottom-2 left-3 sm:-right-2 sm:bottom-8 sm:left-auto"><NightFeed /></div>
          <div className="absolute left-5 top-5 rounded-2xl bg-white/95 px-4 py-3 shadow-[0_20px_40px_-24px_rgba(20,19,28,0.5)] backdrop-blur">
            <div className="font-[family-name:var(--font-display)] text-[22px] font-semibold leading-none tracking-[-0.02em] text-[#14131C]">24/7</div>
            <div className="mt-1 text-[11.5px] text-[#6E6B75]">engine · accountant signs off at 9</div>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <span className={ct.eyebrow}>Infrastructure, not another firm</span>
          <h2 className={`${ct.h2} mt-4`}>No second accounting firm. RAMZA runs underneath yours.</h2>
          <p className={`${ct.lead} mt-4`}>RAMZA becomes your finance infrastructure: the engine books every line around the clock, an accountant signs off each morning, and returns are filed through our licensed partner, {FILING_PARTNER}.</p>
          <div className="mt-7 overflow-hidden rounded-3xl bg-white ring-1 ring-[#E8E5DE]">
            <div className="grid grid-cols-[1fr_1fr_1fr] bg-[#FAF9F6] px-4 py-2.5 text-[11.5px] font-medium uppercase tracking-[0.1em] text-[#8E8B95]">
              <span />
              <span>Traditional</span>
              <span className="text-[#4F35E8]">RAMZA</span>
            </div>
            {rows.map(([k, a, b]) => (
              <div key={k} className="grid grid-cols-[1fr_1fr_1fr] items-start gap-2 border-t border-[#F1EFEA] px-4 py-3 text-[13.5px]">
                <span className="font-medium text-[#14131C]">{k}</span>
                <span className="flex gap-1.5 text-[#6E6B75]"><X size={14} className="mt-0.5 shrink-0 text-[#C2334D]" />{a}</span>
                <span className="flex gap-1.5 text-[#14131C]"><Check size={14} className="mt-0.5 shrink-0 text-emerald-600" />{b}</span>
              </div>
            ))}
          </div>
        </Reveal>
      </TrackView>
    </section>
  );
}
