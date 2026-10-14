"use client";

/* Hero visual: a real photo of an operator at work (rounded panel), with the
 * product working on top of it —
 *   • a payout card that cycles through the gateways (Tabby → Tamara →
 *     Stripe → Telr): orders, gross, fees, net, then "matched to bank";
 *   • an e-invoice card whose checks tick in one by one;
 *   • a "booked in Zoho Books" chip.
 * Figures are sample data (labelled), not a client's. Motion stops for
 * prefers-reduced-motion. */

import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { GATEWAYS, GatewayMark } from "./partner-logos";

const EASE = [0.22, 1, 0.36, 1] as const;

const PAYOUTS = [
  { key: "tabby", day: "03 Oct", orders: 42, gross: 19860, fee: 1618.5 },
  { key: "tamara", day: "02 Oct", orders: 27, gross: 12415, fee: 869.05 },
  { key: "stripe", day: "03 Oct", orders: 63, gross: 24790.4, fee: 781.2 },
  { key: "telr", day: "01 Oct", orders: 18, gross: 7340, fee: 212.86 },
] as const;

const aed = (n: number) => `AED ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function PayoutCard() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [matched, setMatched] = useState(false);
  useEffect(() => {
    if (reduce) { setMatched(true); return; }
    setMatched(false);
    const m = setTimeout(() => setMatched(true), 1500);
    const n = setTimeout(() => setI((x) => (x + 1) % PAYOUTS.length), 3600);
    return () => { clearTimeout(m); clearTimeout(n); };
  }, [i, reduce]);
  const p = PAYOUTS[i];
  const g = GATEWAYS.find((x) => x.key === p.key)!;
  return (
    <div className="w-[300px] rounded-[22px] bg-white/95 p-4 text-[#14131C] shadow-[0_30px_70px_-30px_rgba(12,11,18,0.55)] ring-1 ring-black/[0.05] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#6E6B75]">Payout reconciliation</span>
        <span className="rounded-md bg-[#EEF1F7] px-1.5 py-0.5 text-[10px] font-medium text-[#6E6B75]">Sample</span>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={p.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35, ease: EASE }}>
          <div className="mt-3 flex h-8 items-center justify-between">
            <GatewayMark g={g} h={26} />
            <span className="text-[12px] text-[#6E6B75]">Payout · {p.day}</span>
          </div>
          <dl className="mt-3 space-y-1.5 text-[12.5px]">
            <div className="flex justify-between"><dt className="text-[#6E6B75]">Orders in payout</dt><dd className="font-medium tabular-nums">{p.orders}</dd></div>
            <div className="flex justify-between"><dt className="text-[#6E6B75]">Gross</dt><dd className="font-medium tabular-nums">{aed(p.gross)}</dd></div>
            <div className="flex justify-between"><dt className="text-[#6E6B75]">Fees + VAT</dt><dd className="font-medium tabular-nums text-[#C2334D]">−{aed(p.fee)}</dd></div>
            <div className="flex justify-between border-t border-dashed border-[#E3E7F0] pt-1.5"><dt className="font-medium">Net to bank</dt><dd className="font-semibold tabular-nums">{aed(p.gross - p.fee)}</dd></div>
          </dl>
        </motion.div>
      </AnimatePresence>
      <div className="relative mt-3 h-9 overflow-hidden rounded-xl bg-[#F5F3EF]">
        <motion.div
          key={`bar-${i}`}
          className="absolute inset-y-0 left-0 bg-[#E3F4EC]"
          initial={{ width: reduce ? "100%" : "0%" }} animate={{ width: "100%" }} transition={{ duration: reduce ? 0 : 1.4, ease: "easeInOut" }}
        />
        <div className="relative flex h-full items-center justify-between px-3 text-[12px]">
          <span className={matched ? "font-semibold text-[#0E8A5F]" : "text-[#55525E]"}>{matched ? "Matched to bank credit" : "Matching orders → bank…"}</span>
          <span className={`text-[11px] ${matched ? "text-[#0E8A5F]" : "text-[#A19EA6]"}`}>{matched ? "3-way ✓" : `${p.orders} lines`}</span>
        </div>
      </div>
    </div>
  );
}

const CHECKS = ["Supplier & buyer TRN", "Line-level VAT", "PINT AE data fields", "Sent via accredited provider"];

function InvoiceCard() {
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? CHECKS.length : 0);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setN((x) => (x >= CHECKS.length + 2 ? 0 : x + 1)), 900);
    return () => clearInterval(t);
  }, [reduce]);
  return (
    <div className="w-[248px] rounded-[22px] bg-[#0B1533]/90 p-4 text-white shadow-[0_30px_70px_-25px_rgba(12,11,18,0.8)] ring-1 ring-white/15 backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#B3A6FF]">E-invoice</span>
        <span className="font-mono text-[11px] text-[#B8B6C0]">INV-24117</span>
      </div>
      <ul className="mt-3 space-y-2">
        {CHECKS.map((c, k) => {
          const ok = k < n;
          return (
            <li key={c} className="flex items-center gap-2.5 text-[12.5px]">
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] text-[10px] transition-colors duration-300 ${ok ? "bg-[#4F35E8] text-white" : "bg-white/10 text-transparent"}`}>✓</span>
              <span className={`transition-colors duration-300 ${ok ? "text-white" : "text-[#8E8B95]"}`}>{c}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function HeroStage() {
  const zoho = GATEWAYS.find((g) => g.key === "zoho")!;
  return (
    <div className="relative mx-auto w-full max-w-[600px] pb-10 pl-0 sm:pb-12 sm:pl-14">
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE }}
        className="relative aspect-[4/4.4] overflow-hidden rounded-[36px] bg-[#E3E7F0] shadow-[0_50px_100px_-50px_rgba(20,19,28,0.55)] sm:aspect-[4/4.6]">
        <Image
          src="/ramza/photos/px-operator-desk.jpg"
          alt="Business owner checking payments on her phone at her desk"
          fill priority sizes="(min-width:1024px) 540px, 92vw"
          className="object-cover object-[64%_22%] motion-safe:animate-[ramza-drift_24s_ease-in-out_infinite_alternate]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#14131C]/35 via-transparent to-transparent" />
      </motion.div>

      <motion.div initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35, duration: 0.7, ease: EASE }}
        className="absolute bottom-[4%] left-2 origin-bottom-left scale-[0.82] sm:bottom-[10%] sm:left-0 sm:scale-100">
        <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}><PayoutCard /></motion.div>
      </motion.div>

      <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6, duration: 0.7, ease: EASE }}
        className="absolute -right-4 bottom-[-2%] hidden sm:block">
        <motion.div animate={{ y: [0, 6, 0] }} transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}><InvoiceCard /></motion.div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.85, duration: 0.6, ease: EASE }}
        className="absolute right-4 top-4 flex items-center gap-3 rounded-2xl bg-white/95 px-4 py-2.5 shadow-[0_24px_50px_-20px_rgba(20,19,28,0.45)] ring-1 ring-black/[0.04] backdrop-blur sm:-right-4 sm:top-[6%]">
        <GatewayMark g={zoho} h={34} />
        <span className="border-l border-[#E3E7F0] pl-3 text-[12px] leading-tight text-[#55525E]"><b className="block font-semibold text-[#14131C]">Booked automatically</b>payment · fee · VAT · FX</span>
      </motion.div>
    </div>
  );
}
