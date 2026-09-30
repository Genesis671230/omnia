"use client";

/* Geometric artwork for the RAMZA Corporate Tax site.
 *   <Rings>      concentric circles with a slowly turning dashed orbit
 *   <ShieldOrbit> a shield inside the rings — the "protected" hero mark
 *   <Seam>       a ring node on the line between two sections, with a thin
 *                vertical thread running through it, so sections read as one
 *                connected flow instead of stacked slabs
 *   <NoticeArt>  an illustrated FTA-style penalty notice (no real data)
 *   <WindowArt>  the 40-business-day window drawn as 8 weeks × 5 days
 * All SVG / Tailwind — no image files to load or license. */

import { motion } from "framer-motion";
import { Check, ShieldCheck } from "lucide-react";

/** Concentric rings. `tone` picks colours for a dark or light background. */
export function Rings({ size = 520, tone = "dark", className = "" }: { size?: number; tone?: "dark" | "light"; className?: string }) {
  const stroke = tone === "dark" ? "rgba(143,176,255,0.22)" : "rgba(35,71,217,0.14)";
  const accent = tone === "dark" ? "#4C7BFF" : "#2347D9";
  const radii = [0.18, 0.3, 0.42, 0.5].map((f) => f * size);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`pointer-events-none ${className}`} aria-hidden>
      {radii.map((r, i) => (
        <circle key={r} cx={size / 2} cy={size / 2} r={r - 1} fill="none" stroke={stroke} strokeWidth={i === 3 ? 1 : 1.25} />
      ))}
      {/* the one moving ring: dashed, turning slowly */}
      <motion.g
        style={{ originX: "50%", originY: "50%" }}
        animate={{ rotate: 360 }}
        transition={{ duration: 80, ease: "linear", repeat: Infinity }}
      >
        <circle cx={size / 2} cy={size / 2} r={radii[2] - 1} fill="none" stroke={accent} strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="2 14" />
        {/* nodes riding the orbits */}
        <circle cx={size / 2 + radii[2] - 1} cy={size / 2} r={5} fill={accent} />
        <circle cx={size / 2} cy={size / 2 - radii[1] + 1} r={3.5} fill={accent} fillOpacity={0.7} />
      </motion.g>
    </svg>
  );
}

/** Shield at the centre of the rings — the hero's "you're protected" mark. */
export function ShieldOrbit({ size = 460 }: { size?: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <Rings size={size} />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-b from-[#2F5BFF] to-[#1B38B3] shadow-[0_0_80px_10px_rgba(76,123,255,0.35)]">
          <ShieldCheck size={50} strokeWidth={1.4} className="text-white" />
        </div>
      </div>
    </div>
  );
}

/** A ring node that straddles the boundary between two sections.
 *  Put it as the LAST child of a `relative` section. */
export function Seam({ from = "dark", icon = "shield" }: { from?: "dark" | "light"; icon?: "shield" | "check" }) {
  const Icon = icon === "shield" ? ShieldCheck : Check;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex translate-y-1/2 justify-center" aria-hidden>
      {/* thread through the seam */}
      <span className={`absolute left-1/2 top-[-72px] h-36 w-px -translate-x-1/2 bg-gradient-to-b ${from === "dark" ? "from-transparent via-[#4C7BFF]/60 to-[#2347D9]/40" : "from-transparent via-[#2347D9]/40 to-[#4C7BFF]/60"}`} />
      {/* node: two rings + a solid core */}
      <span className="relative flex h-20 w-20 items-center justify-center rounded-full border border-[#2347D9]/20 bg-[#F7F9FE]/60 backdrop-blur">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#2347D9] text-white shadow-[0_10px_30px_-8px_rgba(35,71,217,0.9)]">
          <Icon size={20} strokeWidth={1.8} />
        </span>
      </span>
    </div>
  );
}

/** Illustrated penalty notice — shape of an FTA notice, sample values only. */
export function NoticeArt() {
  return (
    <div className="relative mx-auto w-full max-w-[380px]">
      <Rings size={380} tone="light" className="absolute -left-10 -top-10 opacity-80" />
      <motion.div
        initial={{ rotate: -4, y: 12, opacity: 0 }}
        animate={{ rotate: -3, y: 0, opacity: 1 }}
        transition={{ duration: 0.7 }}
        className="relative rounded-3xl bg-white p-6 shadow-[0_30px_70px_-30px_rgba(10,26,74,0.45)]"
      >
        <div className="mb-5 flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#9AA6C8]">Penalty notice</span>
          <span className="rounded-full bg-[#FDECEF] px-2.5 py-1 text-[11px] font-medium text-[#C2334D]">Issued</span>
        </div>
        <div className="space-y-3 text-[13px]">
          {[
            ["Violation", "Late registration"],
            ["Tax type", "Corporate Tax"],
            ["Amount", "AED 10,000"],
            ["Notice date", "Sample"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-dashed border-[#E3E9F7] pb-2.5">
              <span className="text-[#6B77A0]">{k}</span>
              <span className="font-medium text-[#0A1A4A]">{v}</span>
            </div>
          ))}
        </div>
        <div className="mt-5 h-2 w-2/3 rounded-full bg-[#EEF3FF]" />
        <div className="mt-2 h-2 w-1/2 rounded-full bg-[#EEF3FF]" />
      </motion.div>
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.4, type: "spring", stiffness: 220, damping: 18 }}
        className="absolute -bottom-6 -right-2 flex items-center gap-3 rounded-2xl bg-[#0A1A4A] px-4 py-3 text-white shadow-xl"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2347D9]"><Check size={16} /></span>
        <span className="text-[13px] leading-tight"><b className="block font-medium">Reconsideration filed</b><span className="text-[#B9C6EE]">inside 40 business days</span></span>
      </motion.div>
    </div>
  );
}

/** The 40-business-day window: 8 weeks of Mon–Fri, filled in order. */
export function WindowArt({ used = 12 }: { used?: number }) {
  return (
    <div className="rounded-[28px] bg-white p-6 shadow-[0_24px_60px_-32px_rgba(10,26,74,0.35)]">
      <div className="mb-4 flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-[#0A1A4A]">40 business days</span>
        <span className="text-[12px] text-[#6B77A0]">Mon – Fri · weekends don’t count</span>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {Array.from({ length: 40 }, (_, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.012 }}
            className={`flex h-7 items-center justify-center rounded-lg text-[10.5px] ${i < used ? "bg-[#2347D9] text-white" : i === 39 ? "bg-[#0A1A4A] text-white" : "bg-[#EEF3FF] text-[#6B77A0]"}`}
          >
            {i + 1}
          </motion.span>
        ))}
      </div>
      <div className="mt-4 flex justify-between text-[12px] text-[#6B77A0]">
        <span>Day 0 · notice issued</span>
        <span className="font-medium text-[#0A1A4A]">Day 40 · last day to file</span>
      </div>
    </div>
  );
}
