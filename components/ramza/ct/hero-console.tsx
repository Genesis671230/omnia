"use client";

/* The hero's right-hand card: two tabs — "Check my penalty" and "Talk to an
   expert". Finishing the checker and pressing "Send this to a tax expert"
   switches to the form with the result attached. */

import { AnimatePresence, motion } from "framer-motion";
import { MessageSquareText, SearchCheck } from "lucide-react";
import { useState } from "react";
import { PenaltyChecker, type CheckerHandoff } from "./checker";
import { CtLeadForm } from "./lead-form";

export function HeroConsole({ start = "check" }: { start?: "check" | "form" }) {
  const [tab, setTab] = useState<"check" | "form">(start);
  const [handoff, setHandoff] = useState<CheckerHandoff | null>(null);

  const tabs = [
    { k: "check" as const, label: "Check my penalty", icon: SearchCheck },
    { k: "form" as const, label: "Talk to an expert", icon: MessageSquareText },
  ];

  return (
    <div id="check" className="scroll-mt-28 rounded-[32px] bg-white p-2 text-[#14131C] shadow-[0_40px_120px_-40px_rgba(0,0,0,0.6)]">
      {/* tab switch — the white pill slides between the two */}
      <div className="relative grid grid-cols-2 rounded-[26px] bg-[#F1EFEA] p-1">
        {tabs.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`relative z-10 flex h-11 items-center justify-center gap-2 rounded-[22px] text-[14px] font-medium transition-colors ${tab === t.k ? "text-[#14131C]" : "text-[#6E6B75] hover:text-[#14131C]"}`}>
            {tab === t.k && <motion.span layoutId="hero-tab" className="absolute inset-0 -z-10 rounded-[22px] bg-white shadow-sm" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-5">
        {/* initial={false}: the first tab renders visible on the server, no fade-in */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} initial={{ opacity: 0, x: tab === "form" ? 12 : -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {tab === "check" ? (
              <PenaltyChecker compact onSend={(h) => { setHandoff(h); setTab("form"); }} />
            ) : (
              <CtLeadForm handoff={handoff} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
