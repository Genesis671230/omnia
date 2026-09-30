"use client";

/* Corporate Tax penalty checker. Three questions, instant answer, all in the
   browser (lib/ramza/ct-penalty.ts). The result card ends with the hook:
   "Send this to an expert", which hands the answer to the lead form. */

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Info, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { checkPenalty, type CheckerInput, type CheckerResult, type PenaltyType, type Tone } from "@/lib/ramza/ct-penalty";
import { ct } from "./brand";
import { track } from "@/lib/ramza/track";

const TYPES: { k: PenaltyType; label: string }[] = [
  { k: "late_registration", label: "Late registration" },
  { k: "late_filing", label: "Late filing" },
  { k: "other", label: "Other penalty" },
  { k: "not_sure", label: "Not sure" },
];

const TONE_STYLE: Record<Tone, { ring: string; icon: typeof CheckCircle2; text: string; bg: string }> = {
  good: { ring: "ring-emerald-200", icon: CheckCircle2, text: "text-emerald-700", bg: "bg-emerald-50" },
  act: { ring: "ring-[#2347D9]/25", icon: CalendarClock, text: "text-[#2347D9]", bg: "bg-[#EEF3FF]" },
  closed: { ring: "ring-rose-200", icon: XCircle, text: "text-rose-700", bg: "bg-rose-50" },
  info: { ring: "ring-slate-200", icon: Info, text: "text-slate-600", bg: "bg-slate-50" },
};

function dubaiToday(): string {
  return new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
}

export type CheckerHandoff = { input: CheckerInput; result: CheckerResult };

export function PenaltyChecker({ onSend, compact = false }: { onSend?: (h: CheckerHandoff) => void; compact?: boolean }) {
  const [type, setType] = useState<PenaltyType>("late_registration");
  const [issuedOn, setIssuedOn] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [filedOn, setFiledOn] = useState("");
  const [shown, setShown] = useState(false);

  const input: CheckerInput = { penaltyType: type, issuedOn: issuedOn || null, periodEnd: periodEnd || null, filedOn: filedOn || null, today: dubaiToday() };
  const result = useMemo(() => checkPenalty(input), [type, issuedOn, periodEnd, filedOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const style = TONE_STYLE[result.tone];

  return (
    <div>
      {/* 1. what kind of penalty */}
      <span className={ct.label}>What is the penalty for?</span>
      <div className="grid grid-cols-2 gap-2">
        {TYPES.map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setType(t.k)}
            className={`h-11 rounded-2xl border text-[14px] transition ${type === t.k ? "border-[#2347D9] bg-[#EEF3FF] font-medium text-[#0A1A4A]" : "border-[#D9E1F5] bg-white text-[#4A5680] hover:border-[#9FB4F2]"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 2. dates */}
      <div className={`mt-4 grid gap-3 ${compact ? "grid-cols-1 sm:grid-cols-2" : "sm:grid-cols-3"}`}>
        <label className="block">
          <span className={ct.label}>Date on the penalty notice</span>
          <input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} className={ct.input} />
        </label>
        <label className="block">
          <span className={ct.label}>Tax period ended on</span>
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={ct.input} />
        </label>
        <label className={`block ${compact ? "sm:col-span-2" : ""}`}>
          <span className={ct.label}>Return filed on <span className="font-normal text-[#9AA6C8]">(leave empty if not yet)</span></span>
          <input type="date" value={filedOn} onChange={(e) => setFiledOn(e.target.value)} className={ct.input} />
        </label>
      </div>

      {!shown && (
        <button type="button" onClick={() => { setShown(true); track("CheckerComplete", { penaltyType: type, tone: result.tone }); }} className={`${ct.btnPrimary} mt-5 w-full`}>
          Check my penalty <ArrowRight size={16} />
        </button>
      )}

      {/* 3. answer */}
      <AnimatePresence>
        {shown && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5">
            <div className={`rounded-2xl p-4 ring-1 ring-inset ${style.bg} ${style.ring}`}>
              <div className={`flex items-start gap-2.5 text-[15px] font-medium ${style.text}`}>
                <style.icon size={18} className="mt-0.5 shrink-0" />
                <span>{result.headline}</span>
              </div>
              {result.estimatedAed > 0 && (
                <p className="mt-2 pl-7 text-[13px] text-[#4A5680]">Estimated exposure: <b className="text-[#0A1A4A]">AED {result.estimatedAed.toLocaleString("en-US")}</b></p>
              )}
            </div>

            <ul className="mt-3 space-y-2">
              {result.findings.map((f) => {
                const s = TONE_STYLE[f.tone];
                return (
                  <li key={f.key} className="flex gap-3 rounded-2xl bg-white p-3.5 ring-1 ring-inset ring-[#E3E9F7]">
                    <s.icon size={17} className={`mt-0.5 shrink-0 ${s.text}`} />
                    <div>
                      <div className="text-[14px] font-medium text-[#0A1A4A]">{f.title}</div>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-[#4A5680]">{f.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>

            {onSend && (
              <button type="button" onClick={() => onSend({ input, result })} className={`${ct.btnPrimary} mt-4 w-full`}>
                Send this to a tax expert — free review <ArrowRight size={16} />
              </button>
            )}
            <p className="mt-3 flex gap-1.5 text-[11.5px] leading-relaxed text-[#8A96BD]">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              General guidance from the published FTA rules, not legal advice. Business days exclude weekends but not public holidays, so real deadlines can be a little later — confirm on EmaraTax.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
