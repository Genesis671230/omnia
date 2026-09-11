"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/* Section reveal — short, once, gentle. Small travel, quick, with a soft blur
   lift, so it doesn't read as the canned "fade-and-slide-up on everything".

   Visible is the base state. The entrance is opt-in: the element is only
   hidden once we know both that the observer is alive and that the element is
   currently off-screen. If JavaScript never runs, if IntersectionObserver is
   missing, or if the observer simply never fires, the copy is still on the
   page. Landing-page body text must not depend on an animation succeeding.

   A 1.2s watchdog is the final backstop: whatever happened, the content is
   shown. Honours reduced-motion by skipping the animation entirely. */
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
  const ref = useRef<HTMLDivElement>(null);
  // "shown" is the safe default and the server-rendered state.
  const [shown, setShown] = useState(true);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver === "undefined") return;

    // Only hide what is genuinely below the fold. Anything already in view on
    // first paint stays put rather than flashing out and back in.
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.9) return;

    setShown(false);
    setArmed(true);

    const reveal = () => setShown(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          reveal();
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);

    // Backstop: never leave content hidden because an observer misbehaved.
    const watchdog = window.setTimeout(reveal, 1200);

    return () => {
      io.disconnect();
      window.clearTimeout(watchdog);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={
        armed
          ? {
              opacity: shown ? 1 : 0,
              transform: shown ? "none" : `translateY(${y}px)`,
              filter: shown ? "none" : "blur(6px)",
              transition: `opacity 0.5s cubic-bezier(0.22,0.7,0.3,1) ${delay}s, transform 0.5s cubic-bezier(0.22,0.7,0.3,1) ${delay}s, filter 0.5s cubic-bezier(0.22,0.7,0.3,1) ${delay}s`,
              willChange: shown ? undefined : "opacity, transform",
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}
