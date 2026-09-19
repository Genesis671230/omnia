"use client";

import { useRef, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";

/* Full-bleed statement band: one flat ink panel, a serif headline, a CTA pair.

   The three drifting wave blobs that used to sit in here are gone. They were
   the loudest decorative element on the page and they were decorating the one
   section that has no evidence in it, which is the wrong place to spend
   attention. A statement band earns its weight from the sentence and the
   silence around it, not from movement behind the type.

   What is left that moves: the copy drifts a little against the panel as the
   band crosses the viewport. One motion, keyed to hierarchy, gated on
   prefers-reduced-motion. */

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

  const copyY = useTransform(scrollYProgress, [0, 1], ["12px", "-12px"]);
  const still = { y: 0 };

  return (
    <section className={`mx-auto w-full max-w-6xl px-5 ${className}`}>
      <div
        ref={ref}
        className="r-mesh rounded-[2rem] px-6 py-20 sm:px-14 sm:py-28 lg:py-32"
      >
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
