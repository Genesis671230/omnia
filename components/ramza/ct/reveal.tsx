"use client";

/* Fade-and-rise on scroll: <Reveal delay={0.1}>…</Reveal>
 *
 * Visible by default — the server HTML never hides content, so search engines,
 * no-JS visitors and slow connections always see the page. After mount, a
 * block that starts BELOW the fold is hidden and then revealed when it scrolls
 * in (native IntersectionObserver). Blocks already on screen don't animate. */

import { motion, useAnimationControls } from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";

export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const controls = useAnimationControls();

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (el.getBoundingClientRect().top < window.innerHeight) return; // already visible — leave it
    controls.set({ opacity: 0, y: 18 });
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        controls.start({ opacity: 1, y: 0, transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] } });
        io.disconnect();
      },
      { rootMargin: "0px 0px -60px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [controls, delay]);

  return (
    <motion.div ref={ref} animate={controls} className={className}>
      {children}
    </motion.div>
  );
}
