"use client";

/* The AI back office, as a looping illustrated "short film" (pure SVG +
 * framer-motion — no video file, ~0 KB of media, crisp at any size):
 *
 *   • three robots at their desks book documents: papers fly from the inbox,
 *     through the robots, into the ledger binder
 *   • one accountant only reviews — a green check pops on her tablet
 *   • the owner sits back with a coffee (cup lifts, steam rises)
 *   • the wall clock spins: it runs all night too
 *
 * Next to it: why RAMZA replaces a second accounting firm — it's
 * infrastructure that runs 24/7. Loops pause for prefers-reduced-motion. */

import { motion, useInView, useReducedMotion } from "framer-motion";
import { Check, Clock3, Coffee, Cpu, ShieldCheck, X } from "lucide-react";
import { useRef } from "react";
import { FILING_PARTNER } from "@/lib/ramza/rules";
import { ct } from "./brand";
import { Reveal } from "./reveal";
import { TrackView } from "./tracked";

const NAVY = "#0A1A4A";
const ROYAL = "#2347D9";
const BRIGHT = "#4C7BFF";
const ICE = "#EEF3FF";
const SKIN = "#C98E6B";
const SKIN2 = "#8D5B3E";

function loop(on: boolean, duration: number, delay = 0, extra: object = {}) {
  return on ? { duration, delay, repeat: Infinity, ease: "easeInOut" as const, ...extra } : { duration: 0 };
}

/* ── characters ────────────────────────────────────────────────────────── */

function Robot({ x, on, delay }: { x: number; on: boolean; delay: number }) {
  return (
    <g transform={`translate(${x} 0)`}>
      {/* desk */}
      <rect x={-62} y={292} width={124} height={10} rx={4} fill="#D5DEF5" />
      <rect x={-54} y={302} width={8} height={70} fill="#D5DEF5" />
      <rect x={46} y={302} width={8} height={70} fill="#D5DEF5" />
      {/* monitor with scrolling rows */}
      <rect x={-8} y={222} width={62} height={44} rx={6} fill={NAVY} />
      <rect x={20} y={266} width={6} height={26} fill="#B7C4E8" />
      <clipPath id={`scr-${x}`}><rect x={-4} y={226} width={54} height={36} rx={3} /></clipPath>
      <g clipPath={`url(#scr-${x})`}>
        <motion.g animate={on ? { y: [0, -36] } : undefined} transition={loop(on, 2.4, delay, { ease: "linear" })}>
          {Array.from({ length: 10 }, (_, i) => (
            <rect key={i} x={0} y={230 + i * 7.2} width={i % 3 === 0 ? 30 : 42} height={3} rx={1.5} fill={i % 4 === 1 ? "#34D399" : BRIGHT} opacity={0.85} />
          ))}
        </motion.g>
      </g>
      {/* body */}
      <rect x={-46} y={236} width={40} height={52} rx={12} fill="#E7ECFA" stroke="#C3CEEC" strokeWidth={1.5} />
      <circle cx={-26} cy={258} r={6} fill={BRIGHT} opacity={0.5} />
      {/* head */}
      <motion.g animate={on ? { rotate: [0, 4, 0, -3, 0] } : undefined} transition={loop(on, 3.2, delay)} style={{ originX: "-26px", originY: "230px" }}>
        <line x1={-26} y1={196} x2={-26} y2={186} stroke="#9AA9D6" strokeWidth={2} />
        <motion.circle cx={-26} cy={184} r={4} fill="#34D399" animate={on ? { opacity: [1, 0.3, 1] } : undefined} transition={loop(on, 1.2, delay)} />
        <rect x={-48} y={196} width={44} height={36} rx={12} fill="#F4F7FF" stroke="#C3CEEC" strokeWidth={1.5} />
        <rect x={-42} y={204} width={32} height={18} rx={8} fill={NAVY} />
        {[-33, -19].map((ex) => (
          <motion.rect key={ex} x={ex - 3} y={210} width={6} height={6} rx={3} fill="#7DD3FC"
            animate={on ? { scaleY: [1, 1, 0.1, 1] } : undefined} transition={loop(on, 3.6, delay + 0.4, { times: [0, 0.9, 0.95, 1] })} style={{ originY: "213px" }} />
        ))}
      </motion.g>
      {/* typing arm */}
      <motion.g animate={on ? { rotate: [0, -10, 0, -6, 0] } : undefined} transition={loop(on, 0.5, delay)} style={{ originX: "-10px", originY: "250px" }}>
        <rect x={-12} y={248} width={34} height={8} rx={4} fill="#C3CEEC" />
        <circle cx={24} cy={252} r={5} fill="#9AA9D6" />
      </motion.g>
      {/* keyboard */}
      <rect x={-2} y={284} width={46} height={6} rx={2} fill="#B7C4E8" />
    </g>
  );
}

function Paper({ on, delay, path }: { on: boolean; delay: number; path: { x: number[]; y: number[] } }) {
  return (
    <motion.g
      initial={{ opacity: 0 }}
      animate={on ? { x: path.x, y: path.y, opacity: [0, 1, 1, 1, 0], rotate: [0, -8, 6, -4, 0] } : { opacity: 0 }}
      transition={loop(on, 4.8, delay, { ease: "easeInOut", times: [0, 0.2, 0.5, 0.8, 1] })}
    >
      <rect x={-9} y={-11} width={18} height={22} rx={2.5} fill="#fff" stroke="#C3CEEC" />
      <rect x={-5} y={-6} width={10} height={1.8} rx={0.9} fill={BRIGHT} />
      <rect x={-5} y={-2} width={8} height={1.8} rx={0.9} fill="#C3CEEC" />
      <rect x={-5} y={2} width={10} height={1.8} rx={0.9} fill="#C3CEEC" />
    </motion.g>
  );
}

function Reviewer({ on }: { on: boolean }) {
  return (
    <g transform="translate(560 0)">
      {/* chair + body */}
      <rect x={-30} y={300} width={60} height={10} rx={5} fill="#D5DEF5" />
      <rect x={-4} y={310} width={8} height={62} fill="#D5DEF5" />
      <path d="M-26 300 C-28 262, -18 244, 0 244 C18 244, 28 262, 26 300 Z" fill={ROYAL} />
      {/* head */}
      <circle cx={0} cy={222} r={17} fill={SKIN} />
      <path d="M-18 220 C-18 198, 18 196, 18 218 C 14 208, -10 206, -18 220 Z" fill="#2B1B14" />
      <path d="M-18 220 C-22 236, -16 248, -12 250 L -10 226 Z" fill="#2B1B14" />
      <motion.g animate={on ? { rotate: [0, 3, 0] } : undefined} transition={loop(on, 4, 0.5)} style={{ originX: "0px", originY: "238px" }}>
        {/* tablet */}
        <rect x={6} y={252} width={42} height={30} rx={4} fill={NAVY} transform="rotate(-18 27 267)" />
        <rect x={10} y={256} width={34} height={22} rx={2} fill={ICE} transform="rotate(-18 27 267)" />
        <path d="M-8 272 C4 270, 12 268, 20 262" stroke={SKIN} strokeWidth={7} strokeLinecap="round" fill="none" />
      </motion.g>
      {/* approval pop */}
      <motion.g animate={on ? { scale: [0, 1.15, 1, 1, 0], opacity: [0, 1, 1, 1, 0] } : { opacity: 0 }} transition={loop(on, 2.4, 1.2, { times: [0, 0.12, 0.2, 0.8, 1] })} style={{ originX: "44px", originY: "226px" }}>
        <circle cx={44} cy={226} r={13} fill="#10B981" />
        <path d="M38 226 l4 4 l8 -9" stroke="#fff" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </motion.g>
      <text x={0} y={392} textAnchor="middle" fontSize={11} fill="#6B77A0">Accountant reviews</text>
    </g>
  );
}

function CoffeeOwner({ on }: { on: boolean }) {
  return (
    <g transform="translate(700 0)">
      {/* lounge chair */}
      <path d="M-40 312 C-44 268, -30 250, -8 250 L 34 250 C 44 250, 46 262, 44 312 Z" fill="#DCE6FF" />
      <rect x={-46} y={306} width={96} height={16} rx={8} fill="#C9D6FA" />
      <rect x={-38} y={322} width={6} height={50} fill="#C9D6FA" />
      <rect x={36} y={322} width={6} height={50} fill="#C9D6FA" />
      {/* body leaning back */}
      <path d="M-16 306 C-22 272, -10 252, 8 252 C 26 252, 30 272, 28 306 Z" fill="#F4F7FF" stroke="#C3CEEC" />
      <path d="M-4 252 L 8 272 L 20 252" stroke={NAVY} strokeWidth={3} fill="none" />
      {/* legs crossed */}
      <path d="M0 306 C 10 318, 40 318, 60 322" stroke={NAVY} strokeWidth={12} strokeLinecap="round" fill="none" />
      <path d="M16 306 C 30 312, 44 330, 52 360" stroke={NAVY} strokeWidth={12} strokeLinecap="round" fill="none" />
      {/* head */}
      <motion.g animate={on ? { rotate: [0, -6, -6, 0] } : undefined} transition={loop(on, 5, 0, { times: [0, 0.3, 0.6, 1] })} style={{ originX: "6px", originY: "248px" }}>
        <circle cx={6} cy={228} r={17} fill={SKIN2} />
        <path d="M-11 224 C-10 206, 22 204, 23 222 C 16 214, -2 214, -11 224 Z" fill="#1A1A1A" />
        <path d="M-6 238 C 0 246, 14 246, 20 238 C 16 250, -2 250, -6 238 Z" fill="#1A1A1A" opacity={0.85} />
      </motion.g>
      {/* arm + cup: lifts to the mouth every few seconds */}
      <motion.g animate={on ? { rotate: [0, -38, -38, 0] } : undefined} transition={loop(on, 5, 0, { times: [0, 0.3, 0.6, 1] })} style={{ originX: "22px", originY: "268px" }}>
        <path d="M22 268 C 36 276, 44 284, 48 284" stroke="#F4F7FF" strokeWidth={10} strokeLinecap="round" fill="none" />
        <circle cx={50} cy={283} r={5} fill={SKIN2} />
        <rect x={44} y={266} width={14} height={16} rx={3} fill="#fff" stroke="#C3CEEC" />
        <path d="M58 270 c5 0 5 8 0 8" stroke="#C3CEEC" strokeWidth={2} fill="none" />
        {[0, 1, 2].map((i) => (
          <motion.path key={i} d={`M${48 + i * 4} 262 c-3 -5 3 -8 0 -13`} stroke="#9AA9D6" strokeWidth={1.6} fill="none" strokeLinecap="round"
            animate={on ? { opacity: [0, 0.9, 0], y: [0, -10, -18] } : { opacity: 0 }} transition={loop(on, 2.2, i * 0.5)} />
        ))}
      </motion.g>
      <text x={6} y={392} textAnchor="middle" fontSize={11} fill="#6B77A0">You, with your coffee</text>
    </g>
  );
}

function WallClock({ on }: { on: boolean }) {
  return (
    <g transform="translate(560 108)">
      <circle r={30} fill="#fff" stroke="#C3CEEC" strokeWidth={2} />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1={0} y1={-24} x2={0} y2={-20} stroke="#9AA9D6" strokeWidth={2} transform={`rotate(${i * 30})`} />
      ))}
      <motion.line x1={0} y1={0} x2={0} y2={-14} stroke={NAVY} strokeWidth={3} strokeLinecap="round" animate={on ? { rotate: 360 } : undefined} transition={loop(on, 12, 0, { ease: "linear" })} />
      <motion.line x1={0} y1={0} x2={0} y2={-22} stroke={ROYAL} strokeWidth={2} strokeLinecap="round" animate={on ? { rotate: 360 } : undefined} transition={loop(on, 1.5, 0, { ease: "linear" })} />
      <circle r={3} fill={NAVY} />
      <text y={48} textAnchor="middle" fontSize={11} fill="#6B77A0">24/7 — nights too</text>
    </g>
  );
}

export function AiOfficeScene() {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { amount: 0.2 });
  const reduced = useReducedMotion();
  const on = inView && !reduced;
  const flight = (d: number) => ({ x: [40, 140 + d, 260 + d, 380, 452], y: [250, 170, 150, 170, 236] });

  return (
    <svg ref={ref} viewBox="0 0 800 410" className="block h-auto w-full" role="img"
      aria-label="Illustration: AI robots book documents at their desks while an accountant reviews and the business owner drinks coffee">
      <defs>
        <linearGradient id="office-bg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#F5F8FF" /><stop offset="1" stopColor="#E7EEFF" /></linearGradient>
      </defs>
      <rect width={800} height={410} rx={28} fill="url(#office-bg)" />
      {/* window with skyline */}
      <rect x={30} y={40} width={330} height={120} rx={14} fill="#DCE6FF" />
      <path d="M40 160 V120 h22 V96 h14 V120 h16 V78 h10 V60 h6 V78 h10 V120 h18 V104 h24 V160 Z M180 160 V110 h30 V88 h20 V110 h18 V132 h40 V100 h18 V160 Z" fill="#BFD0FA" />
      <rect x={30} y={40} width={330} height={120} rx={14} fill="none" stroke="#C9D6FA" strokeWidth={3} />
      <line x1={195} y1={40} x2={195} y2={160} stroke="#C9D6FA" strokeWidth={3} />
      {/* floor */}
      <rect x={0} y={372} width={800} height={38} fill="#DCE5FB" />
      <WallClock on={on} />

      {/* inbox tray + ledger binder */}
      <g transform="translate(40 270)">
        <rect x={-24} y={-6} width={48} height={24} rx={4} fill="#fff" stroke="#C3CEEC" />
        <rect x={-18} y={-14} width={36} height={10} rx={2} fill="#fff" stroke="#C3CEEC" />
        <text y={40} textAnchor="middle" fontSize={11} fill="#6B77A0">Bank · invoices</text>
      </g>
      <g transform="translate(456 260)">
        <rect x={-22} y={-24} width={44} height={50} rx={5} fill={ROYAL} />
        <rect x={-15} y={-16} width={30} height={6} rx={2} fill="#fff" opacity={0.8} />
        <motion.circle cx={14} cy={-26} r={9} fill="#10B981" animate={on ? { scale: [1, 1.2, 1] } : undefined} transition={loop(on, 1.6)} />
        <path d="M10 -26 l3 3 l5 -6" stroke="#fff" strokeWidth={2.2} fill="none" strokeLinecap="round" />
        <text y={46} textAnchor="middle" fontSize={11} fill="#6B77A0">Ledger</text>
      </g>

      <Robot x={140} on={on} delay={0} />
      <Robot x={290} on={on} delay={0.35} />
      {[0, 1.2, 2.4, 3.6].map((d, i) => <Paper key={d} on={on} delay={d} path={flight(i % 2 ? 20 : -10)} />)}
      <text x={215} y={392} textAnchor="middle" fontSize={11} fill="#6B77A0">AI books every line</text>

      <Reviewer on={on} />
      <CoffeeOwner on={on} />
    </svg>
  );
}

/* ── section ───────────────────────────────────────────────────────────── */

export function AiOfficeSection() {
  const rows: [string, string, string][] = [
    ["Working hours", "Office hours, month-end rush", "Always on — nights and weekends"],
    ["Bank & gateway matching", "Typed and ticked by hand", "Automatic, every line"],
    ["Books ready", "Weeks after month-end", "Closed as the money lands"],
    ["Who checks", "Whoever is free", "A named accountant reviews"],
  ];
  return (
    <section className={`${ct.sectionIce} pb-24 pt-24`}>
      <TrackView section="ai-office" className={`${ct.container} grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr]`}>
        <Reveal>
          <div className="overflow-hidden rounded-[28px] shadow-[0_40px_90px_-50px_rgba(10,26,74,0.55)] ring-1 ring-[#D9E1F5]">
            <AiOfficeScene />
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2 text-[12.5px] text-[#4A5680]">
            {[[Cpu, "AI does the books"], [ShieldCheck, "Accountant only reviews"], [Coffee, "You run the business"], [Clock3, "Runs 24/7"]].map(([I, l]) => {
              const Icon = I as typeof Cpu;
              return <span key={l as string} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 shadow-sm"><Icon size={13} className="text-[#2347D9]" />{l as string}</span>;
            })}
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <span className={ct.eyebrow}>Infrastructure, not another firm</span>
          <h2 className={`${ct.h2} mt-4`}>No second accounting firm. RAMZA runs underneath yours.</h2>
          <p className={`${ct.lead} mt-4`}>RAMZA becomes your finance infrastructure: the robots do the books around the clock, an accountant signs off, and returns are filed through our licensed partner, {FILING_PARTNER}.</p>
          <div className="mt-7 overflow-hidden rounded-3xl bg-white shadow-[0_18px_50px_-34px_rgba(10,26,74,0.45)]">
            <div className="grid grid-cols-[1fr_1fr_1fr] bg-[#F7F9FE] px-4 py-2.5 text-[11.5px] font-medium uppercase tracking-[0.1em] text-[#8A96BD]">
              <span />
              <span>Traditional</span>
              <span className="text-[#2347D9]">RAMZA</span>
            </div>
            {rows.map(([k, a, b]) => (
              <div key={k} className="grid grid-cols-[1fr_1fr_1fr] items-start gap-2 border-t border-[#EEF3FF] px-4 py-3 text-[13.5px]">
                <span className="font-medium text-[#0A1A4A]">{k}</span>
                <span className="flex gap-1.5 text-[#6B77A0]"><X size={14} className="mt-0.5 shrink-0 text-[#C2334D]" />{a}</span>
                <span className="flex gap-1.5 text-[#0A1A4A]"><Check size={14} className="mt-0.5 shrink-0 text-emerald-600" />{b}</span>
              </div>
            ))}
          </div>
        </Reveal>
      </TrackView>
    </section>
  );
}
