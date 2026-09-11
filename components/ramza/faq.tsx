"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Section, SectionHeading } from "./ui/section";
import { FAQ } from "@/lib/ramza/copy";

/* Accordion. Motion only on open/close. */
export function Faq() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <Section id="faq">
      <SectionHeading>Questions</SectionHeading>
      <div className="mt-8 max-w-3xl border-t r-hairline">
        {FAQ.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={item.q} className="border-b r-hairline">
              <h3>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 py-4 text-left text-[0.9375rem] font-medium"
                  style={{ color: "var(--ink)" }}
                >
                  {item.q}
                  <span
                    aria-hidden
                    className="shrink-0 transition-transform"
                    style={{
                      color: "var(--ink-60)",
                      transform: isOpen ? "rotate(45deg)" : "none",
                    }}
                  >
                    +
                  </span>
                </button>
              </h3>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    style={{ overflow: "hidden" }}
                  >
                    <p className="pb-4 text-sm leading-relaxed" style={{ color: "var(--ink-60)" }}>
                      {item.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
