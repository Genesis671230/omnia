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
const TICK_MS = 480;
const HOLD_MS = 2400;

export function PostingStack() {
  const reduce = useReducedMotion();
  const maxTick = N * 2;
  const [tick, setTick] = useState(reduce ? maxTick : 0);
  const pausedRef = useRef(false);

  useEffect(() => {
    const onVis = () => {
      pausedRef.current = document.hidden;
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (reduce) return;
    const atEnd = tick >= maxTick;
    const delay = atEnd ? HOLD_MS : TICK_MS;
    let id: ReturnType<typeof setTimeout>;
    const run = () => {
      if (pausedRef.current) {
        id = setTimeout(run, 160);
        return;
      }
      setTick(atEnd ? 0 : tick + 1);
    };
    id = setTimeout(run, delay);
    return () => clearTimeout(id);
  }, [tick, reduce, maxTick]);

  return (
    <Section field>
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
        <div>
          <SectionHeading>Every line gets an account and a date</SectionHeading>
          <p className="r-lead r-measure mt-4" style={{ color: "var(--ink-60)" }}>
            {POSTING_INTRO}
          </p>
        </div>

        <div className="r-glass rounded-2xl p-3 sm:p-4 lg:-mt-6" aria-hidden>
          <div className="mb-2 flex items-center justify-between px-1 text-[11px]" style={{ color: "var(--ink-60)" }}>
            <span>Proposed postings</span>
            <span>March 2026</span>
          </div>
          <ul className="space-y-1.5">
            {POSTING_ROWS.map((row, i) => {
              const arrived = tick >= i * 2 + 1;
              const posted = tick >= i * 2 + 2;
              return (
                <li
                  key={row.description}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm"
                  style={{
                    borderColor: "var(--rule)",
                    background: "var(--paper)",
                    opacity: arrived ? 1 : 0,
                    transform: arrived ? "translateY(0) scale(1)" : "translateY(-14px) scale(0.98)",
                    transition: "opacity .3s ease, transform .35s cubic-bezier(.2,.7,.3,1)",
                  }}
                >
                  <span className="min-w-0 flex-1 truncate" style={{ color: "var(--ink)" }}>
                    {row.description}
                  </span>

                  <span
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium"
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
                    className="tnum shrink-0 text-xs"
                    style={{ color: "var(--ink-60)", minWidth: 46 }}
                  >
                    {row.date}
                  </span>

                  <span
                    className="tnum shrink-0 text-right text-xs font-medium"
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
            className="mt-2 px-1 text-[11px]"
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
