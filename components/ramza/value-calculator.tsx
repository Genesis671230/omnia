"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Section, SectionHeading } from "./ui/section";
import { calculate, type CalcInput } from "@/lib/ramza/calculator";
import {
  CALC_BOUNDS,
  CALC_DEFAULTS,
  CALC_FOOTNOTE,
  CALC_HEADING,
  CALC_INTRO,
  CTA_PRIMARY,
} from "@/lib/ramza/copy";

/* Four sliders, and everything on the right is arithmetic on them.

   No benchmark is asserted anywhere in here. The panel shows the working
   ("1,500 orders plus 16 payout reconciliations") precisely so a finance
   reader can check it rather than take it on trust, which is the only way a
   calculator like this survives contact with the person it is aimed at. */

const fmt = (n: number) =>
  n.toLocaleString("en-AE", { maximumFractionDigits: 0 });

export function ValueCalculator() {
  const [input, setInput] = useState<CalcInput>(CALC_DEFAULTS);
  const reduce = useReducedMotion();
  const r = useMemo(() => calculate(input), [input]);

  const set = (k: keyof CalcInput) => (v: number) =>
    setInput((p) => ({ ...p, [k]: v }));

  return (
    <Section id="pricing" field>
      <div className="max-w-2xl">
        <SectionHeading>{CALC_HEADING}</SectionHeading>
        <p className="r-lead mt-4" style={{ color: "var(--ink-60)" }}>
          {CALC_INTRO}
        </p>
      </div>

      <div className="mt-10 grid gap-5 lg:grid-cols-[0.95fr_1.05fr] lg:gap-8">
        {/* inputs */}
        <div className="r-glass r-grain relative overflow-hidden rounded-2xl p-6 sm:p-8">
          <div className="relative z-[1] space-y-7">
            <Slider
              label="Orders a month"
              value={input.ordersPerMonth}
              onChange={set("ordersPerMonth")}
              bounds={CALC_BOUNDS.ordersPerMonth}
              display={fmt(input.ordersPerMonth)}
            />
            <Slider
              label="Payment gateways you use"
              value={input.gateways}
              onChange={set("gateways")}
              bounds={CALC_BOUNDS.gateways}
              display={String(input.gateways)}
            />
            <Slider
              label="Hours a month spent reconciling"
              value={input.hoursPerMonth}
              onChange={set("hoursPerMonth")}
              bounds={CALC_BOUNDS.hoursPerMonth}
              display={`${input.hoursPerMonth} h`}
            />
            <Slider
              label="Cost of that hour"
              value={input.hourlyCostAed}
              onChange={set("hourlyCostAed")}
              bounds={CALC_BOUNDS.hourlyCostAed}
              display={`AED ${fmt(input.hourlyCostAed)}`}
              hint="Loaded cost of whoever does it. Your accountant's rate, or your own."
            />
          </div>
        </div>

        {/* outputs */}
        <div className="r-mesh rounded-2xl p-6 sm:p-8">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-white/55">
            Every year, as things stand
          </p>

          <Figure
            value={`AED ${fmt(r.annualCostAed)}`}
            caption="spent reconciling by hand"
            reduce={reduce}
          />

          <dl className="mt-7 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Stat label="Lines to match" value={fmt(r.matchesPerYear)} />
            <Stat label="Hours" value={fmt(r.hoursPerYear)} />
            <Stat label="Working days" value={fmt(r.workingDaysPerYear)} />
            <Stat label="Per month" value={`AED ${fmt(r.monthlyCostAed)}`} />
          </dl>

          <div
            className="mt-7 border-t pt-5 text-[0.75rem] leading-relaxed"
            style={{ borderColor: "rgba(255,255,255,0.14)", color: "rgba(226,235,255,0.68)" }}
          >
            <p>
              {fmt(input.ordersPerMonth)} orders plus {input.gateways * 4} payout
              reconciliations is {fmt(r.matchesPerMonth)} lines a month, about{" "}
              {r.secondsPerMatch} seconds each at your stated pace. Times twelve.
            </p>
          </div>

          <div className="mt-7">
            {/* Not CtaLink: it hard-codes r-btn-primary, which is declared
                after r-btn-on-mesh at equal specificity and would repaint this
                blue on a blue-green field. */}
            <a href="#audit" className="r-btn r-btn-on-mesh !px-7">
              {CTA_PRIMARY}
            </a>
          </div>
        </div>
      </div>

      <p className="r-measure mt-6 text-[0.8125rem] leading-relaxed" style={{ color: "var(--ink-60)" }}>
        {CALC_FOOTNOTE}
      </p>
    </Section>
  );
}

function Figure({
  value,
  caption,
  reduce,
}: {
  value: string;
  caption: string;
  reduce: boolean | null;
}) {
  return (
    <div className="mt-4">
      <motion.p
        key={value}
        initial={reduce ? false : { opacity: 0.35, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 0.7, 0.3, 1] }}
        className="tnum text-[clamp(2rem,4.6vw,3rem)] leading-[1.05] tracking-[-0.02em]"
        style={{ fontFamily: "var(--font-fraunces), Georgia, serif", fontWeight: 400 }}
      >
        {value}
      </motion.p>
      <p className="mt-1.5 text-[0.875rem]" style={{ color: "rgba(226,235,255,0.72)" }}>
        {caption}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.6875rem] uppercase tracking-[0.12em]" style={{ color: "rgba(226,235,255,0.5)" }}>
        {label}
      </dt>
      <dd className="tnum mt-1 text-lg font-semibold">{value}</dd>
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
  bounds,
  display,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  bounds: { min: number; max: number; step: number };
  display: string;
  hint?: string;
}) {
  const pct = ((value - bounds.min) / (bounds.max - bounds.min)) * 100;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label className="text-[0.875rem] font-medium" style={{ color: "var(--ink)" }}>
          {label}
        </label>
        <span
          className="tnum text-[0.9375rem] font-semibold"
          style={{ color: "var(--ledger)" }}
        >
          {display}
        </span>
      </div>
      <input
        type="range"
        className="r-range mt-3"
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ["--r-range-pct" as string]: `${pct}%` }}
      />
      {hint && (
        <p className="mt-2 text-[0.75rem] leading-relaxed" style={{ color: "var(--ink-40)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}
