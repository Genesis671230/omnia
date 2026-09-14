"use client";

import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { Section, SectionHeading } from "./ui/section";
import { REVIEW_HEADING, REVIEW_INTRO, REVIEW_LAYERS } from "@/lib/ramza/copy";

/* The layered review, drawn as a vertical spine with the three layers
   stepping in one after another.

   The spine is a line that draws down as the section enters, which is the one
   place on this page where the motion is carrying meaning: the review is a
   sequence, and a sequence is worth animating. Everything renders at full
   opacity if the observer never fires or motion is reduced. */
export function AccountantReview() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once: true, amount: 0.25 });
  const play = reduce ? true : inView;

  return (
    <Section id="review">
      <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
        <div>
          <span className="r-eyebrow inline-flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-px w-8"
              style={{ background: "var(--ledger)" }}
            />
            Review
          </span>
          <SectionHeading>{REVIEW_HEADING}</SectionHeading>
          <p className="r-lead r-measure mt-4" style={{ color: "var(--ink-60)" }}>
            {REVIEW_INTRO}
          </p>
        </div>

        <div ref={ref} className="relative">
          {/* the spine */}
          <div
            aria-hidden
            className="absolute left-[15px] top-2 bottom-2 w-px"
            style={{ background: "var(--rule)" }}
          />
          <motion.div
            aria-hidden
            className="absolute left-[15px] top-2 w-px origin-top"
            style={{ background: "var(--ledger)", bottom: 8 }}
            initial={reduce ? false : { scaleY: 0 }}
            animate={play ? { scaleY: 1 } : { scaleY: 0 }}
            transition={{ duration: 1.1, ease: [0.22, 0.7, 0.3, 1] }}
          />

          <ol className="space-y-8">
            {REVIEW_LAYERS.map((l, i) => (
              <motion.li
                key={l.step}
                className="relative pl-11"
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={play ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
                transition={{
                  duration: 0.45,
                  delay: reduce ? 0 : 0.18 + i * 0.16,
                  ease: [0.22, 0.7, 0.3, 1],
                }}
              >
                <motion.span
                  aria-hidden
                  className="absolute left-0 top-0.5 flex size-8 items-center justify-center rounded-full text-[0.6875rem] font-bold"
                  style={{
                    background: "var(--ledger)",
                    color: "var(--ledger-ink)",
                    boxShadow: "0 0 0 5px var(--paper)",
                  }}
                  initial={reduce ? false : { scale: 0.4, opacity: 0 }}
                  animate={play ? { scale: 1, opacity: 1 } : { scale: 0.4, opacity: 0 }}
                  transition={{
                    duration: 0.4,
                    delay: reduce ? 0 : 0.18 + i * 0.16,
                    ease: [0.34, 1.4, 0.5, 1],
                  }}
                >
                  {i + 1}
                </motion.span>

                <p
                  className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: "var(--ink-40)" }}
                >
                  {l.step}
                </p>
                <h3 className="mt-1 text-lg font-semibold" style={{ color: "var(--ink)" }}>
                  {l.title}
                </h3>
                <p
                  className="mt-2 text-[0.9375rem] leading-relaxed"
                  style={{ color: "var(--ink-60)" }}
                >
                  {l.body}
                </p>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
    </Section>
  );
}
