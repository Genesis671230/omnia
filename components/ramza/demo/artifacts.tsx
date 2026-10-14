"use client";

/* The hero's side scenery: the real paperwork RAMZA eats — payout slips,
 * an invoice getting its "paid" stamp, a bank credit, the VAT and FX lines —
 * drifting gently. Product truth instead of mascots. Desktop only, static
 * for prefers-reduced-motion. */

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

function Float({ children, className, delay = 0, y = 10, rotate = 0 }: { children: ReactNode; className: string; delay?: number; y?: number; rotate?: number }) {
  const still = useReducedMotion();
  return (
    <motion.div
      className={`absolute hidden xl:block ${className}`}
      initial={{ opacity: 0, y: 20, rotate }}
      animate={still ? { opacity: 1, y: 0, rotate } : { opacity: 1, y: [0, -y, 0], rotate: [rotate, rotate + 1.2, rotate] }}
      transition={still ? { duration: 0.4 } : { opacity: { duration: 0.6, delay }, y: { duration: 6 + delay * 2, repeat: Infinity, ease: "easeInOut", delay }, rotate: { duration: 8, repeat: Infinity, ease: "easeInOut", delay } }}
    >
      {children}
    </motion.div>
  );
}

const card = "rounded-[20px] bg-white p-3.5 shadow-[0_24px_50px_-28px_rgba(20,19,28,0.35)] ring-1 ring-[#E3E7F0]";

export function FloatingArtifacts() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 mx-auto max-w-[1440px]">
      <Float className="left-[3%] top-[120px]" rotate={-6} delay={0.1}>
        <div className={`${card} w-[220px]`}>
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ramza/logos/stripe-mark.png" alt="" className="h-6 w-6 rounded-md" />
            <div className="text-[12px] font-semibold text-[#14131C]">Stripe payout</div>
            <span className="ml-auto rounded-full bg-[#EEF1F7] px-2 py-0.5 text-[10px] text-[#55525E]">USD</span>
          </div>
          <div className="mt-3 space-y-1.5 text-[11px] text-[#55525E]">
            <div className="flex justify-between"><span>Gross</span><b className="text-[#14131C]">$4,210.00</b></div>
            <div className="flex justify-between"><span>Fees</span><span>−$123.09</span></div>
            <div className="flex justify-between border-t border-dashed border-[#E3E7F0] pt-1.5"><span>Net</span><b className="text-[#14131C]">$4,086.91</b></div>
          </div>
        </div>
      </Float>

      <Float className="left-[7%] top-[360px]" rotate={4} delay={0.6} y={14}>
        <div className={`${card} relative w-[200px]`}>
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#8A8792]">Tax invoice</div>
          <div className="mt-1 text-[13px] font-semibold text-[#14131C]">INV-1047</div>
          <div className="mt-2 space-y-1">{[70, 90, 55].map((w) => <div key={w} className="h-1.5 rounded-full bg-[#EEF1F7]" style={{ width: `${w}%` }} />)}</div>
          <div className="mt-2 flex justify-between text-[11px]"><span className="text-[#8A8792]">VAT 5%</span><b className="text-[#14131C]">AED 1,890.00</b></div>
          <motion.div initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 1.6, type: "spring", stiffness: 260, damping: 14 }}
            className="absolute -right-3 -top-3 rotate-12 rounded-lg border-2 border-[#1F9D63] bg-white px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#1F9D63]">Paid ✓</motion.div>
        </div>
      </Float>

      <Float className="left-[2%] top-[590px]" rotate={-3} delay={1.1}>
        <div className="rounded-full bg-[#0B1533] px-4 py-2 text-[12px] font-medium text-white shadow-lg">USD → AED · 3.6725</div>
      </Float>

      <Float className="right-[3%] top-[110px]" rotate={5} delay={0.3}>
        <div className={`${card} w-[230px]`}>
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ramza/logos/tabby-mark.png" alt="" className="h-6 w-6 rounded-md" />
            <div className="text-[12px] font-semibold text-[#14131C]">Tabby settlement</div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
            {[["41", "orders"], ["4.5%", "fee"], ["+VAT", "5%"]].map(([a, b]) => (
              <div key={b} className="rounded-xl bg-[#F7F6F2] py-1.5"><div className="text-[12px] font-semibold text-[#14131C]">{a}</div><div className="text-[9.5px] text-[#8A8792]">{b}</div></div>
            ))}
          </div>
        </div>
      </Float>

      <Float className="right-[6%] top-[340px]" rotate={-4} delay={0.8} y={12}>
        <div className={`${card} w-[240px]`}>
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#8A8792]">Bank · Emirates NBD</div>
          <div className="mt-2 flex items-center justify-between">
            <div className="text-[11.5px] text-[#55525E]">TABBY PAYOUT 1043</div>
            <div className="text-[13px] font-semibold text-[#1F9D63]">+18,240.55</div>
          </div>
          <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-[#E6F6EE] px-2 py-1 text-[10.5px] font-medium text-[#147A4B]">✓ matched to 41 invoices</div>
        </div>
      </Float>

      <Float className="right-[2%] top-[560px]" rotate={3} delay={1.3}>
        <div className={`${card} w-[210px]`}>
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#8A8792]">Journal · posted</div>
          {[["Bank", "18,240.55", ""], ["Fees", "820.80", ""], ["VAT input", "41.04", ""], ["Clearing", "", "19,102.39"]].map(([k, d, c]) => (
            <div key={k} className="mt-1 grid grid-cols-[1fr_auto_auto] gap-2 text-[11px]"><span className={c ? "pl-3 text-[#55525E]" : "text-[#14131C]"}>{k}</span><span className="w-14 text-right tabular-nums">{d}</span><span className="w-14 text-right tabular-nums">{c}</span></div>
          ))}
        </div>
      </Float>
    </div>
  );
}
