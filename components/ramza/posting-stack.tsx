"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { Section, SectionHeading } from "./ui/section";
import { POSTING_ROWS, POSTING_INTRO } from "@/lib/ramza/copy";

/* Every payout line is proposed with an account and a date, then it posts.
   Rows drop onto the stack one by one; each account chip flips from a dashed
   "suggested" state to a solid "posted" state. Original animation, no video. */

const N = POSTING_ROWS.length;
const TICK_MS = 420;

export function PostingStack() {
  const reduce = useReducedMotion();
  const maxTick = N * 2;
  const panelRef = useRef<HTMLDivElement>(null);

  /* The sequence runs once, when the panel comes into view, and then holds the
     posted state. It used to loop back to tick 0 every 2.4s, which meant the
     panel sat completely empty for a third of its life — including whenever
     someone happened to scroll to it mid-reset. A ledger that blinks out is
     worse than no animation. */
  const [tick, setTick] = useState(reduce ? maxTick : 0);
  const [started, setStarted] = useState(reduce);

  useEffect(() => {
    if (reduce) return;
    const el = panelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setStarted(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    // Backstop: if the observer never fires, show the finished state anyway.
    const watchdog = window.setTimeout(() => setTick(maxTick), 4000);
    return () => {
      io.disconnect();
      window.clearTimeout(watchdog);
    };
  }, [reduce, maxTick]);

  useEffect(() => {
    if (!started || tick >= maxTick) return;
    const id = setTimeout(() => setTick((t) => t + 1), TICK_MS);
    return () => clearTimeout(id);
  }, [started, tick, maxTick]);

  return (
    <Section field>
      {/* min-w-0 on both columns: a grid item defaults to min-width auto, so
          without it the posting panel refused to shrink below its widest row
          and pushed the whole section past the viewport on a phone. */}
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
        <div className="min-w-0">
          <SectionHeading>Every line gets an account and a date</SectionHeading>
          <p className="r-lead r-measure mt-4" style={{ color: "var(--ink-60)" }}>
            {POSTING_INTRO}
          </p>
        </div>

        <div
          ref={panelRef}
          className="r-glass r-grain relative min-w-0 rounded-2xl p-3 sm:p-4 lg:-mt-6"
        >
          <div className="relative z-[1] mb-2 flex items-center justify-between px-1 text-[11px]" style={{ color: "var(--ink-60)" }}>
            <span>Proposed postings</span>
            <span className="tnum">March 2026</span>
          </div>
          <ul className="relative z-[1] space-y-1.5">
            {POSTING_ROWS.map((row, i) => {
              const arrived = tick >= i * 2 + 1;
              const posted = tick >= i * 2 + 2;
              return (
                <li
                  key={row.description}
                  /* Two lines on a phone (description + amount, then account +
                     date), one line from sm up. The four-across row clipped the
                     amounts off the right edge at 390px. */
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 rounded-lg border px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
                  style={{
                    borderColor: "var(--rule)",
                    background: "var(--paper)",
                    opacity: arrived ? 1 : 0,
                    transform: arrived ? "translateY(0) scale(1)" : "translateY(-14px) scale(0.98)",
                    transition: "opacity .3s ease, transform .35s cubic-bezier(.2,.7,.3,1)",
                  }}
                >
                  <span className="min-w-0 truncate sm:order-1" style={{ color: "var(--ink)" }}>
                    {row.description}
                  </span>

                  <span
                    className="col-start-1 row-start-2 inline-flex w-fit items-center gap-1.5 justify-self-start rounded-md border px-2 py-1 text-xs font-medium sm:order-2 sm:col-auto sm:row-auto"
                    style={{
                      borderStyle: posted ? "solid" : "dashed",
                      borderColor: posted ? "var(--ledger)" : "var(--residual)",
                      color: posted
                        ? "var(--ledger)"
                        : "color-mix(in srgb, var(--residual) 84%, var(--ink))",
                      background: posted
                        ? "color-mix(in srgb, var(--ledger) 10%, transparent)"
                        : "transparent",
                      transition: "all .3s ease",
                    }}
                  >
                    {posted && <Check className="size-3" />}
                    {row.account}
                  </span>

                  <span
                    className="tnum col-start-2 row-start-2 text-right text-xs sm:order-3 sm:col-auto sm:row-auto sm:text-left"
                    style={{ color: "var(--ink-60)", minWidth: 46 }}
                  >
                    {row.date}
                  </span>

                  <span
                    className="tnum col-start-2 row-start-1 whitespace-nowrap text-right text-xs font-medium sm:order-4 sm:col-auto sm:row-auto"
                    style={{
                      color: row.negative ? "var(--stamp)" : "var(--ink)",
                      minWidth: 96,
                    }}
                  >
                    {row.negative ? `−${row.amount}` : row.amount}
                  </span>
                </li>
              );
            })}
          </ul>
          <div
            className="relative z-[1] mt-2 px-1 text-[11px]"
            style={{
              color: "var(--ink-60)",
              opacity: tick >= maxTick ? 1 : 0,
              transition: "opacity .3s ease",
            }}
          >
            6 lines posted to Zoho. You approve the batch, nothing books on its own.
          </div>
        </div>
      </div>
    </Section>
  );
}
