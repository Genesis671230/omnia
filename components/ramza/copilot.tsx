"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Section, SectionHeading } from "./ui/section";
import { COPILOT_INTRO, COPILOT_THREADS } from "@/lib/ramza/copy";

/* "RAMZA copilot" — a demonstration, not a live assistant. Preset questions
   expand to show the copilot tracing a payout gap step by step. Motion only on
   expand/collapse. AI never appears in the H1. */
export function Copilot() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Section>
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <SectionHeading>RAMZA copilot</SectionHeading>
          <p className="r-lead r-measure mt-4" style={{ color: "var(--ink-60)" }}>
            {COPILOT_INTRO}
          </p>
        </div>

        <div className="r-glass rounded-2xl p-2 sm:p-3">
          <ul className="space-y-1">
            {COPILOT_THREADS.map((t, i) => {
              const isOpen = open === i;
              return (
                <li key={t.q}>
                  <button
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-3 text-left text-sm font-medium transition-colors"
                    style={{
                      color: "var(--ink)",
                      background: isOpen
                        ? "color-mix(in srgb, var(--ink) 5%, transparent)"
                        : "transparent",
                    }}
                  >
                    <span
                      aria-hidden
                      className="inline-block transition-transform"
                      style={{ transform: isOpen ? "rotate(90deg)" : "none", color: "var(--ink-60)" }}
                    >
                      ▸
                    </span>
                    {t.q}
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                        style={{ overflow: "hidden" }}
                      >
                        <div className="px-3 pb-3 pt-1">
                          <ol className="space-y-1.5 border-l r-hairline pl-3">
                            {t.steps.map((s, j) => (
                              <li
                                key={j}
                                className="text-xs leading-relaxed"
                                style={{ color: "var(--ink-60)" }}
                              >
                                {s}
                              </li>
                            ))}
                          </ol>
                          <p
                            className="mt-3 rounded-lg px-3 py-2 text-sm leading-relaxed"
                            style={{
                              color: "var(--ink)",
                              background: "color-mix(in srgb, var(--ledger) 10%, transparent)",
                            }}
                          >
                            {t.answer}
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ul>
          <p className="px-3 py-2 text-[11px]" style={{ color: "var(--ink-60)" }}>
            Illustrative. The copilot works from your reconciled data, not a chatbot.
          </p>
        </div>
      </div>
    </Section>
  );
}
