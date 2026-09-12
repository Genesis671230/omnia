"use client";

import { useRef, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";

/* Full-bleed statement band: a grainy mesh gradient with tonal waves drifting
   across it, a serif headline and a pill CTA.

   The waves are three stacked SVG blobs at low opacity that move at different
   rates as the band crosses the viewport. Layering the parallax rather than
   translating the whole band is what makes it read as depth: if everything
   moves together it just looks like the page is scrolling, which it is.

   All motion is gated on prefers-reduced-motion, and the band renders in full
   with no motion at all, so nothing here can hide the copy. */

export function MeshBand({
  eyebrow,
  children,
  sub,
  cta,
  className = "",
}: {
  eyebrow?: string;
  children: ReactNode;
  sub?: ReactNode;
  cta?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });

  // Each layer travels a different distance across the same scroll range.
  const slowY = useTransform(scrollYProgress, [0, 1], ["-6%", "6%"]);
  const midY = useTransform(scrollYProgress, [0, 1], ["-14%", "12%"]);
  const fastY = useTransform(scrollYProgress, [0, 1], ["-22%", "18%"]);
  const drift = useTransform(scrollYProgress, [0, 1], ["-4%", "4%"]);
  const copyY = useTransform(scrollYProgress, [0, 1], ["12px", "-12px"]);

  const still = { y: 0, x: 0 };

  return (
    <section className={`mx-auto w-full max-w-6xl px-5 ${className}`}>
      <div
        ref={ref}
        className="r-mesh rounded-[2rem] px-6 py-20 sm:px-14 sm:py-28 lg:py-32"
      >
        <div className="r-mesh-waves" aria-hidden>
          <motion.svg
            viewBox="0 0 1200 600"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            style={reduce ? still : { y: slowY }}
          >
            <path
              d="M-100 380 C 220 300, 420 470, 700 400 S 1120 250, 1320 330 L1320 620 L-100 620 Z"
              fill="rgba(9, 34, 78, 0.55)"
            />
          </motion.svg>

          <motion.svg
            viewBox="0 0 1200 600"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            style={reduce ? still : { y: midY, x: drift }}
          >
            <path
              d="M-100 250 C 260 170, 380 360, 720 290 S 1080 140, 1320 220 L1320 620 L-100 620 Z"
              fill="rgba(16, 104, 80, 0.34)"
            />
          </motion.svg>

          <motion.svg
            viewBox="0 0 1200 600"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            style={reduce ? still : { y: fastY }}
          >
            <path
              d="M-100 470 C 180 420, 500 560, 820 490 S 1160 400, 1320 450 L1320 620 L-100 620 Z"
              fill="rgba(5, 18, 46, 0.6)"
            />
          </motion.svg>
        </div>

        <motion.div
          className="mx-auto max-w-3xl text-center"
          style={reduce ? still : { y: copyY }}
        >
          {eyebrow && (
            <p className="mb-5 text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-white/55">
              {eyebrow}
            </p>
          )}

          <h2
            className="text-[clamp(1.75rem,4.2vw,3.15rem)] leading-[1.1] tracking-[-0.02em]"
            style={{
              fontFamily: "var(--font-fraunces), Georgia, serif",
              fontWeight: 400,
              textWrap: "balance",
            }}
          >
            {children}
          </h2>

          {sub && (
            <p className="r-mesh-dim mx-auto mt-6 max-w-xl text-[0.9375rem] leading-relaxed">
              {sub}
            </p>
          )}

          {cta && (
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              {cta}
            </div>
          )}
        </motion.div>
      </div>
    </section>
  );
}
