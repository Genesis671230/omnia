"use client";

/* Shared pieces for the dashboard overview: number formatting, the meaning
   colours every figure wears (so "received" is the same green in the KPI, the
   ring, the chart and the table), the per-day progress ring and animated
   numbers. Gateway identity colours come from reconciliation/colors.ts — one
   source for the whole app. */

import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect } from "react";
import { gatewayColor } from "@/components/finance/reconciliation/colors";
import { ui } from "./ui";

export { gatewayColor };

/** Figures stay in ink; colour is reserved for gateway identity and the one
 *  "received" green. Kept as named tones so callers say what a number means. */
export const TONE = {
  sold: "#0F1B3D",
  received: "#0F1B3D",
  pending: "#0F1B3D",
  fee: "#0F1B3D",
  ads: "#0F1B3D",
  roas: "#0F1B3D",
} as const;

/** Ring / bar fills: green = in the bank, soft grey = still on its way. */
export const FILL = { received: "#10B981", pending: "#CBD5E6", track: "#E3E9F5" } as const;

export const fmt = (v: number, digits = 0) =>
  new Intl.NumberFormat("en-AE", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v || 0);
export const aed = (v: number) => `AED ${fmt(v)}`;
export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}m`;
  if (a >= 1000) return `${(v / 1000).toFixed(a >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return fmt(v);
}
export const pct = (v: number) => `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)}%`;
export const dayLong = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** A number that counts up to its value when it changes. */
export function CountUp({ value, format = (n: number) => fmt(n) }: { value: number; format?: (n: number) => string }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (n) => format(n));
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.8, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [value, mv]);
  return <motion.span>{text}</motion.span>;
}

/** Received share of a day as a ring: green arc = in the bank, amber = pending.
 *  The % inside is the received share, so the ring reads on its own. */
export function ProgressRing({
  value, size = 34, stroke = 4, label = true, className = "", dark = false,
}: { value: number; size?: number; stroke?: number; label?: boolean; className?: string; dark?: boolean }) {
  const v = Math.min(Math.max(value, 0), 1);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const done = v >= 0.995;
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={dark ? "rgba(255,255,255,0.18)" : FILL.track} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={FILL.received} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      {label && (
        <span
          className={`absolute font-semibold tabular-nums ${dark ? "text-white" : "text-slate-900"}`}
          style={{ fontSize: Math.max(size * 0.27, 8.5) }}
        >
          {done ? "✓" : Math.round(v * 100)}
        </span>
      )}
    </span>
  );
}

/** A dashboard card — see ui.card. Fades up on mount. */
export function Card({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`min-w-0 ${ui.card} ${className}`}
    >
      {children}
    </motion.div>
  );
}

/** Card label — see ui.label. */
export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`${ui.label} ${className}`}>{children}</span>;
}

/** Underline tabs like the reference ("Week  Month  Quarter"). The underline
 *  slides between tabs (framer-motion layoutId). */
export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  const id = `tab-${options.map((o) => o[0]).join("-")}`;
  return (
    <div className="inline-flex items-center gap-5" role="tablist">
      {options.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)} className={`${ui.tab} ${value === k ? ui.tabActive : ""}`}>
          {label}
          {value === k && <motion.span layoutId={id} className="absolute inset-x-0 -bottom-px h-[1.5px] rounded-full bg-slate-900" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
        </button>
      ))}
    </div>
  );
}
