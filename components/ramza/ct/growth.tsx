"use client";

/* Clean books → growth. A hand-drawn flywheel (sketch strokes draw in on
 * scroll, the loop keeps turning) beside the investor board pack with
 * quarterly / yearly profit bars. Figures are illustrative (labelled). */

import { motion, useInView, useReducedMotion } from "framer-motion";
import { BookCheck, Handshake, LineChart, Rocket, TrendingUp } from "lucide-react";
import { useRef, useState } from "react";
import { ct } from "./brand";
import { ProfitBars } from "./engine-showcase";
import { Reveal } from "./reveal";
import { TrackView } from "./tracked";

const STEPS = [
  { icon: BookCheck, t: "Clean books", d: "Reconciled daily, closed monthly", a: -90 },
  { icon: LineChart, t: "Investor-ready numbers", d: "Profit, margins, cash — any day", a: 0 },
  { icon: Handshake, t: "Funding & better terms", d: "Banks and investors say yes faster", a: 90 },
  { icon: Rocket, t: "Brand growth", d: "Spend on growth, not on catch-up", a: 180 },
];

function Flywheel() {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { amount: 0.4, once: true });
  const reduced = useReducedMotion();
  const R = 128, C = 200;
  // slightly wobbly circle so it reads as a drawing, not a chart
  const sketch = "M200 72 C 272 70, 330 126, 328 198 C 330 270, 272 330, 200 328 C 126 330, 70 272, 72 200 C 70 128, 128 70, 204 74";
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[460px]">
      <svg ref={ref} viewBox="0 0 400 400" className="absolute inset-0 h-full w-full">
        <motion.path d={sketch} fill="none" stroke="#2347D9" strokeWidth={3} strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={inView ? { pathLength: 1 } : undefined} transition={{ duration: 1.6, ease: "easeInOut" }} />
        <motion.path d={sketch} fill="none" stroke="#4C7BFF" strokeWidth={1.2} strokeLinecap="round" opacity={0.5} transform="rotate(4 200 200)"
          initial={{ pathLength: 0 }} animate={inView ? { pathLength: 1 } : undefined} transition={{ duration: 1.8, delay: 0.2, ease: "easeInOut" }} />
        {/* arrowheads riding the loop */}
        <motion.g style={{ originX: "200px", originY: "200px" }} animate={inView && !reduced ? { rotate: 360 } : undefined} transition={{ duration: 18, repeat: Infinity, ease: "linear" }}>
          {[45, 135, 225, 315].map((a) => {
            const r = (a * Math.PI) / 180;
            const x = C + R * Math.cos(r), y = C + R * Math.sin(r);
            return <path key={a} d="M-7 -6 L4 0 L-7 6" fill="none" stroke="#2347D9" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" transform={`translate(${x} ${y}) rotate(${a + 90})`} />;
          })}
        </motion.g>
        {/* centre scribble */}
        <motion.path d="M160 214 C 180 196, 200 230, 240 186" fill="none" stroke="#10B981" strokeWidth={4} strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={inView ? { pathLength: 1 } : undefined} transition={{ duration: 0.8, delay: 1.4 }} />
        <motion.path d="M228 184 L242 184 L240 198" fill="none" stroke="#10B981" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: 0 }} animate={inView ? { pathLength: 1 } : undefined} transition={{ duration: 0.3, delay: 2.1 }} />
      </svg>
      <div className="absolute left-1/2 top-[57%] -translate-x-1/2 text-center text-[12px] font-medium uppercase tracking-[0.14em] text-[#6B77A0]">growth loop</div>
      {STEPS.map((s, i) => {
        const r = (s.a * Math.PI) / 180;
        const left = 50 + 32 * Math.cos(r), top = 50 + 32 * Math.sin(r);
        return (
          <motion.div key={s.t} className="absolute w-[124px] -translate-x-1/2 -translate-y-1/2 sm:w-[170px]" style={{ left: `${left}%`, top: `${top}%` }}
            initial={{ opacity: 0, scale: 0.85 }} animate={inView ? { opacity: 1, scale: 1 } : undefined} transition={{ delay: 0.4 + i * 0.25, type: "spring", stiffness: 260, damping: 20 }}>
            <div className="rounded-2xl bg-white px-3 py-2.5 text-center shadow-[0_14px_34px_-20px_rgba(10,26,74,0.55)] ring-1 ring-[#E3E9F8]">
              <s.icon size={18} className="mx-auto text-[#2347D9]" />
              <div className="mt-1 text-[13px] font-medium leading-tight text-[#0A1A4A]">{s.t}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-[#8A96BD]">{s.d}</div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function BoardPack() {
  const [period, setPeriod] = useState<"quarterly" | "yearly">("yearly");
  const kpis = period === "yearly"
    ? [["Revenue", "1.54M", "+35%"], ["Net profit", "326k", "+73%"], ["Margin", "21%", "+5 pts"]]
    : [["Revenue", "468k", "+16%"], ["Net profit", "109k", "+24%"], ["Margin", "23%", "+1 pt"]];
  return (
    <div className="rounded-[28px] bg-white p-6 shadow-[0_30px_70px_-40px_rgba(10,26,74,0.5)] ring-1 ring-[#E3E9F8]">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-[#8A96BD]">Board pack</div>
          <div className="mt-1 text-[17px] font-medium text-[#0A1A4A]">Your company, as investors see it</div>
        </div>
        <div className="flex rounded-full bg-[#EEF3FF] p-0.5 text-[12px]">
          {(["quarterly", "yearly"] as const).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={`relative rounded-full px-3 py-1 capitalize ${period === p ? "text-white" : "text-[#4A5680]"}`}>
              {period === p && <motion.span layoutId="board-toggle" className="absolute inset-0 rounded-full bg-[#2347D9]" />}
              <span className="relative">{p}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {kpis.map(([l, v, d]) => (
          <div key={l} className="rounded-2xl bg-[#F7F9FE] px-3 py-3">
            <div className="text-[11.5px] text-[#8A96BD]">{l}</div>
            <div className="text-[20px] font-medium tabular-nums text-[#0A1A4A]">{v}</div>
            <div className="flex items-center gap-1 text-[11.5px] text-emerald-600"><TrendingUp size={12} />{d}</div>
          </div>
        ))}
      </div>
      <div className="mt-5"><ProfitBars key={period} period={period} /></div>
      <div className="mt-3 flex items-center justify-between text-[11.5px] text-[#8A96BD]">
        <span className="flex items-center gap-3"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#DCE6FF]" />Revenue</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#2347D9]" />Net profit</span></span>
        <span>Illustrative figures</span>
      </div>
    </div>
  );
}

export function GrowthSection() {
  return (
    <section className={`${ct.sectionIce} pb-24 pt-24`}>
      <TrackView section="growth" className={ct.container}>
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className={ct.eyebrow}>Clean books, bigger company</span>
          <h2 className={`${ct.h2} mt-4`}>Numbers investors trust. A brand that can grow.</h2>
          <p className={`${ct.lead} mt-4`}>When the books close themselves, you stop paying for catch-up and start showing profit by quarter and by year — to your bank, your investors and yourself.</p>
        </Reveal>
        <div className="mt-12 grid items-center gap-10 lg:grid-cols-2">
          <Reveal><Flywheel /></Reveal>
          <Reveal delay={0.1}><BoardPack /></Reveal>
        </div>
      </TrackView>
    </section>
  );
}
