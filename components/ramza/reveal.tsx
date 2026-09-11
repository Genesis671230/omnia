"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

/* Section reveal — short, once, gentle. Kept subtle so it doesn't read as the
   canned "fade-and-slide-up on everything" pattern: small travel, quick, with a
   soft blur lift. Honours reduced-motion. */
export function Reveal({
  children,
  delay = 0,
  y = 14,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 0.7, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
