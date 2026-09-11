"use client";

import { useRef } from "react";
import { useInView } from "framer-motion";
import { CHAIN } from "@/lib/ramza/copy";

/* Order -> Gateway -> Payout -> Bank -> Books. Draws once when scrolled into
   view. This is the only scroll-triggered motion on the page. Transform +
   opacity only; reduced-motion users get it fully drawn immediately. */
export function ChainDraw() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const on = inView; // useInView already respects nothing about reduced-motion,
  // but the global CSS zeroes transition-duration for those users, so the end
  // state paints instantly.

  const node = (label: string, i: number, step: number) => (
    <span
      className="inline-flex items-center gap-2 text-sm font-medium"
      style={{
        color: "var(--ink)",
        opacity: on ? 1 : 0,
        transform: on ? "none" : "translateY(4px)",
        transition: "opacity .4s ease, transform .4s ease",
        transitionDelay: `${i * step}s`,
      }}
    >
      <span aria-hidden className="size-1.5 rounded-full" style={{ background: "var(--ledger)" }} />
      {label}
    </span>
  );

  return (
    <div ref={ref} className="mt-12" aria-label={`The RAMZA chain: ${CHAIN.join(", ")}`}>
      {/* desktop: horizontal */}
      <ol className="hidden items-center md:flex">
        {CHAIN.map((label, i) => (
          <li
            key={label}
            className="flex items-center"
            style={{ flex: i < CHAIN.length - 1 ? "1 1 0%" : "0 0 auto" }}
          >
            {node(label, i, 0.18)}
            {i < CHAIN.length - 1 && (
              <span
                aria-hidden
                className="mx-3 flex-1 origin-left"
                style={{
                  height: 0,
                  borderTop: "1.5px dashed",
                  borderColor: on ? "var(--brand)" : "var(--rule)",
                  transform: on ? "scaleX(1)" : "scaleX(0)",
                  transition: "transform .5s ease, border-color .3s ease",
                  transitionDelay: `${i * 0.18 + 0.09}s`,
                }}
              />
            )}
          </li>
        ))}
      </ol>

      {/* mobile: vertical */}
      <ol className="md:hidden">
        {CHAIN.map((label, i) => (
          <li key={label} className="flex flex-col">
            {node(label, i, 0.16)}
            {i < CHAIN.length - 1 && (
              <span
                aria-hidden
                className="my-1 ml-[3px] block h-5 origin-top"
                style={{
                  width: 0,
                  borderLeft: "1.5px dashed",
                  borderColor: on ? "var(--brand)" : "var(--rule)",
                  transform: on ? "scaleY(1)" : "scaleY(0)",
                  transition: "transform .4s ease, border-color .3s ease",
                  transitionDelay: `${i * 0.16 + 0.08}s`,
                }}
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
