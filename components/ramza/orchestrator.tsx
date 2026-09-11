"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Section, SectionHeading } from "./ui/section";
import { ORCHESTRATOR, ORCHESTRATOR_INTRO } from "@/lib/ramza/copy";

/* One orchestrator, four specialists. The connector to each specialist draws
   in ("jumps") in sequence, the specialist lights up and reveals its status,
   then everything holds lit and the cycle resets. Original animation, no video.
   Pauses when the tab is hidden; reduced-motion shows the fully-lit end state. */

const SPECIALISTS = ORCHESTRATOR.specialists;
const STEP_MS = 900;
const HOLD_MS = 2600;

// desktop SVG space
const VB_W = 640;
const VB_H = 384;
const HUB = { x: 214, y: 192 };
const ROWS = [52, 148, 244, 340]; // specialist row centres
const TARGET_X = 388;

function pathTo(y: number): string {
  const midX = (HUB.x + TARGET_X) / 2;
  return `M ${HUB.x} ${HUB.y} C ${midX} ${HUB.y}, ${midX} ${y}, ${TARGET_X} ${y}`;
}

export function Orchestrator() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(reduce ? SPECIALISTS.length : 0);
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
    const atEnd = active >= SPECIALISTS.length;
    const delay = atEnd ? HOLD_MS : STEP_MS;
    let id: ReturnType<typeof setTimeout>;
    const run = () => {
      if (pausedRef.current) {
        id = setTimeout(run, 180);
        return;
      }
      setActive(atEnd ? 0 : active + 1);
    };
    id = setTimeout(run, delay);
    return () => clearTimeout(id);
  }, [active, reduce]);

  return (
    <Section field>
      <SectionHeading>One orchestrator, four specialists</SectionHeading>
      <p className="r-lead r-measure mt-4" style={{ color: "var(--ink-60)" }}>
        {ORCHESTRATOR_INTRO}
      </p>

      {/* desktop */}
      <div
        className="relative mx-auto mt-12 hidden lg:block"
        style={{ maxWidth: 880, aspectRatio: `${VB_W} / ${VB_H}` }}
        aria-hidden
      >
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="none"
        >
          {ROWS.map((y, i) => {
            const on = active > i;
            const d = pathTo(y);
            return (
              <g key={i}>
                {/* dashed rail */}
                <path
                  d={d}
                  fill="none"
                  stroke={on ? "var(--brand)" : "var(--rule)"}
                  strokeWidth={1.5}
                  strokeDasharray="6 5"
                  style={{ transition: "stroke .3s ease" }}
                />
                {/* pulse that travels hub -> specialist when it activates */}
                {on && (
                  <path
                    d={d}
                    fill="none"
                    stroke="var(--brand)"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeDasharray="16 560"
                    strokeDashoffset={576}
                    style={{
                      animation: "r-pulse .6s ease forwards",
                    }}
                  />
                )}
              </g>
            );
          })}
        </svg>

        <Card
          style={{ left: "1%", top: "50%", transform: "translateY(-50%)", width: "31%" }}
          title={ORCHESTRATOR.hub.name}
          body={ORCHESTRATOR.hub.body}
          lit
        />
        {SPECIALISTS.map((sp, i) => (
          <Card
            key={sp.name}
            style={{
              left: "60%",
              top: `${(ROWS[i] / VB_H) * 100}%`,
              transform: "translateY(-50%)",
              width: "39%",
            }}
            title={sp.name}
            body={sp.body}
            status={sp.status}
            lit={active > i}
          />
        ))}
      </div>

      {/* mobile / tablet */}
      <ol className="mt-10 lg:hidden">
        <li>
          <MiniCard title={ORCHESTRATOR.hub.name} body={ORCHESTRATOR.hub.body} lit />
        </li>
        {SPECIALISTS.map((sp, i) => (
          <li key={sp.name}>
            <span
              aria-hidden
              className="my-1 ml-4 block h-5 origin-top"
              style={{
                width: 0,
                borderLeft: "1.5px dashed",
                borderColor: active > i ? "var(--brand)" : "var(--rule)",
                transform: active > i ? "scaleY(1)" : "scaleY(0.3)",
                transition: "transform .4s ease, border-color .3s ease",
              }}
            />
            <MiniCard title={sp.name} body={sp.body} status={sp.status} lit={active > i} />
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Card({
  title,
  body,
  status,
  lit,
  style,
}: {
  title: string;
  body: string;
  status?: string;
  lit?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="r-glass absolute rounded-2xl p-3.5"
      style={{
        ...style,
        borderColor: lit ? "var(--brand)" : "var(--glass-border)",
        boxShadow: lit
          ? "0 0 0 1px var(--brand), var(--glass-shadow)"
          : "var(--glass-shadow)",
        transition: "border-color .3s ease, box-shadow .3s ease",
      }}
    >
      <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
        {title}
      </div>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--ink-60)" }}>
        {body}
      </p>
      {status && (
        <div
          className="tnum mt-2 overflow-hidden text-xs font-medium"
          style={{
            color: "var(--ledger)",
            maxHeight: lit ? 20 : 0,
            opacity: lit ? 1 : 0,
            transition: "max-height .35s ease, opacity .35s ease",
          }}
        >
          {status}
        </div>
      )}
    </div>
  );
}

function MiniCard(props: { title: string; body: string; status?: string; lit?: boolean }) {
  return (
    <div
      className="r-glass rounded-2xl p-4"
      style={{
        borderColor: props.lit ? "var(--brand)" : "var(--glass-border)",
        transition: "border-color .3s ease",
      }}
    >
      <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
        {props.title}
      </div>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--ink-60)" }}>
        {props.body}
      </p>
      {props.status && props.lit && (
        <div className="tnum mt-2 text-xs font-medium" style={{ color: "var(--ledger)" }}>
          {props.status}
        </div>
      )}
    </div>
  );
}
