"use client";

/* Geometric artwork for the RAMZA Corporate Tax site.
 *   <NoticeArt>  an illustrated FTA-style penalty notice (no real data)
 *   <WindowArt>  the 40-business-day window drawn as 8 weeks × 5 days
 * All SVG / Tailwind — no image files to load or license. */

import { motion } from "framer-motion";
import { Check } from "lucide-react";

/** Illustrated penalty notice — shape of an FTA notice, sample values only. */
export function NoticeArt() {
  return (
    <div className="relative mx-auto w-full max-w-[380px]">
      <motion.div
        initial={{ rotate: -4, y: 12, opacity: 0 }}
        animate={{ rotate: -3, y: 0, opacity: 1 }}
        transition={{ duration: 0.7 }}
        className="relative rounded-3xl bg-white p-6 shadow-[0_30px_70px_-30px_rgba(20,19,28,0.45)]"
      >
        <div className="mb-5 flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#A19EA6]">Penalty notice</span>
          <span className="rounded-full bg-[#FDECEF] px-2.5 py-1 text-[11px] font-medium text-[#C2334D]">Issued</span>
        </div>
        <div className="space-y-3 text-[13px]">
          {[
            ["Violation", "Late registration"],
            ["Tax type", "Corporate Tax"],
            ["Amount", "AED 10,000"],
            ["Notice date", "Sample"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-dashed border-[#E3E7F0] pb-2.5">
              <span className="text-[#6E6B75]">{k}</span>
              <span className="font-medium text-[#14131C]">{v}</span>
            </div>
          ))}
        </div>
        <div className="mt-5 h-2 w-2/3 rounded-full bg-[#EEF1F7]" />
        <div className="mt-2 h-2 w-1/2 rounded-full bg-[#EEF1F7]" />
      </motion.div>
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.4, type: "spring", stiffness: 220, damping: 18 }}
        className="absolute -bottom-6 -right-2 flex items-center gap-3 rounded-2xl bg-[#0B1533] px-4 py-3 text-white shadow-xl"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0B1533]"><Check size={16} /></span>
        <span className="text-[13px] leading-tight"><b className="block font-medium">Reconsideration filed</b><span className="text-[#B8B6C0]">inside 40 business days</span></span>
      </motion.div>
    </div>
  );
}

/** The 40-business-day window: 8 weeks of Mon–Fri, filled in order. */
export function WindowArt({ used = 12 }: { used?: number }) {
  return (
    <div className="rounded-[28px] bg-white p-6 shadow-[0_24px_60px_-32px_rgba(20,19,28,0.35)]">
      <div className="mb-4 flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-[#14131C]">40 business days</span>
        <span className="text-[12px] text-[#6E6B75]">Mon – Fri · weekends don’t count</span>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {Array.from({ length: 40 }, (_, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.012 }}
            className={`flex h-7 items-center justify-center rounded-lg text-[10.5px] ${i < used ? "bg-[#0B1533] text-white" : i === 39 ? "bg-[#0B1533] text-white" : "bg-[#EEF1F7] text-[#6E6B75]"}`}
          >
            {i + 1}
          </motion.span>
        ))}
      </div>
      <div className="mt-4 flex justify-between text-[12px] text-[#6E6B75]">
        <span>Day 0 · notice issued</span>
        <span className="font-medium text-[#14131C]">Day 40 · last day to file</span>
      </div>
    </div>
  );
}
