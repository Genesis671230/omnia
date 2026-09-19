"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { MessageCircle } from "lucide-react";
import { Section, SectionHeading } from "./ui/section";
import { CtaLink } from "./ui/cta-button";
import {
  CTA_PRIMARY,
  CTA_SECONDARY,
  WALKTHROUGH_BODY,
  WALKTHROUGH_CTA_NOTE,
  WALKTHROUGH_HEADING,
  WALKTHROUGH_PAYOUTS,
  WALKTHROUGH_STAGES,
} from "@/lib/ramza/copy";

/* The walkthrough that replaced the stock clip.

   Three stages on a pain → solution → value spine, ending in the ask. The
   month closing is the animation: eighteen chips start neutral, turn green as
   RAMZA matches them, then fill solid once they post to Zoho. One goes amber
   and stays there, because a product that claims to match everything is not
   believable to anyone who has actually done this work.

   Auto-advance is a convenience, never the only way through: the rail is real
   buttons, and under prefers-reduced-motion the cascade and the timer are both
   off with the final stage shown. */

const STAGE_MS = 4200;

/* Visual state of one payout chip at a given stage. */
function chipState(settlesAt: 1 | 2 | null, stage: number) {
  if (stage === 0) return "pending";
  if (settlesAt === null) return "transit";
  if (settlesAt === 2) return "flagged";
  return stage >= 2 ? "posted" : "matched";
}

export function Walkthrough({ whatsappHref }: { whatsappHref: string }) {
  const reduce = useReducedMotion();
  const [stage, setStage] = useState(0);
  const [paused, setPaused] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  /* Hold at stage 0 until the section is actually on screen, or the whole
     sequence plays out while the visitor is still reading the hero. */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (reduce) {
      setSeen(true);
      setStage(WALKTHROUGH_STAGES.length - 1);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduce]);

  useEffect(() => {
    if (reduce || !seen || paused) return;
    const id = window.setTimeout(
      () => setStage((s) => (s + 1) % WALKTHROUGH_STAGES.length),
      STAGE_MS
    );
    return () => window.clearTimeout(id);
  }, [reduce, seen, paused, stage]);

  const pick = useCallback((i: number) => {
    setStage(i);
    setPaused(true);
  }, []);

  const active = WALKTHROUGH_STAGES[stage];

  return (
    <Section id="walkthrough">
      <div className="max-w-2xl">
        <span className="r-eyebrow inline-flex items-center gap-2">
          <span aria-hidden className="inline-block h-px w-8" style={{ background: "var(--ledger)" }} />
          Walkthrough
        </span>
        <SectionHeading>{WALKTHROUGH_HEADING}</SectionHeading>
        <p className="r-lead r-measure mt-4" style={{ color: "var(--ink-60)" }}>
          {WALKTHROUGH_BODY}
        </p>
      </div>

      <div
        ref={rootRef}
        className="r-wt mt-10"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {/* stage rail */}
        <ol className="r-wt-rail" aria-label="Walkthrough stages">
          {WALKTHROUGH_STAGES.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => pick(i)}
                aria-current={i === stage ? "step" : undefined}
                className="r-wt-step"
                data-state={i === stage ? "active" : i < stage ? "done" : "todo"}
              >
                <span className="r-wt-step-dot" aria-hidden />
                <span className="r-wt-step-label">{s.rail}</span>
                {i === stage && !reduce && !paused && (
                  <span
                    aria-hidden
                    className="r-wt-step-progress"
                    style={{ animationDuration: `${STAGE_MS}ms` }}
                  />
                )}
              </button>
            </li>
          ))}
        </ol>

        <div className="r-wt-panel">
          {/* the month, turning over */}
          <div className="r-wt-chips" aria-hidden>
            {WALKTHROUGH_PAYOUTS.map((p, i) => (
              <span
                key={i}
                className="r-wt-chip"
                data-state={chipState(p.settlesAt, stage)}
                style={{ transitionDelay: reduce ? "0ms" : `${i * 45}ms` }}
              >
                {p.gateway}
              </span>
            ))}
          </div>

          {/* Metric and prose share one row: the copy measures ~54ch, which
              left the panel's right-hand side empty when they were stacked.
              One live region for the pair, so a screen reader hears the stage
              change once rather than eighteen chips re-announcing. */}
          <div className="r-wt-readout" aria-live="polite">
            <div>
              <p className="r-wt-metric r-nums">{active.metric}</p>
              <p className="r-wt-metric-note r-nums">{active.metricNote}</p>
            </div>
            <div>
              <h3 className="r-wt-headline">{active.headline}</h3>
              <p className="r-wt-body">{active.body}</p>
            </div>
          </div>
        </div>
      </div>

      {/* the ask */}
      <div className="r-wt-cta">
        <div className="flex flex-col gap-3 sm:flex-row">
          <CtaLink href="#audit">{CTA_PRIMARY}</CtaLink>
          <CtaLink href={whatsappHref} variant="outline" target="_blank" rel="noopener noreferrer">
            <MessageCircle className="size-4" />
            {CTA_SECONDARY}
          </CtaLink>
        </div>
        <p className="r-wt-cta-note">{WALKTHROUGH_CTA_NOTE}</p>
      </div>
    </Section>
  );
}
