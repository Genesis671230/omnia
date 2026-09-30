"use client";

/* Peak bars — the reference's hero chart: a dense field of thin bars, a
 * smooth line riding over them, and the peak window lifted out in colour with
 * a pill naming it. Hover any bar for its value. Pure SVG (viewBox-scaled, so
 * it fills any width) + framer-motion; no chart library.
 *
 *   <PeakBars values={slots.map(s => s.revenue)} labels={slots.map(s => s.label)}
 *     highlight={[80, 91]} peakLabel="Peak 20:00–23:00" format={aed} /> */

import { useId, useMemo, useState } from "react";
import { motion } from "framer-motion";

const W = 1000;
const H = 260;
const PAD_T = 44;
const PAD_B = 26;

/** Moving average — the line reads the trend, the bars keep the detail. */
function smooth(values: number[], radius: number): number[] {
  return values.map((_, i) => {
    let s = 0; let n = 0;
    for (let k = -radius; k <= radius; k++) {
      const v = values[(i + k + values.length) % values.length];
      s += v; n += 1;
    }
    return s / n;
  });
}

/** Catmull-Rom through the points, as cubic Béziers. */
function curve(points: [number, number][]): string {
  if (points.length < 2) return "";
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export function PeakBars({
  values, labels, highlight, peakLabel, format = (v) => v.toLocaleString(), tickEvery, height = 260, accent = "#4F46E5",
}: {
  values: number[];
  labels: string[];
  /** Inclusive slot range to lift out; wraps when from > to. */
  highlight?: [number, number] | null;
  peakLabel?: string;
  format?: (v: number) => string;
  /** Label every Nth slot on the x axis. */
  tickEvery?: number;
  height?: number;
  accent?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = values.length;
  const step = W / Math.max(n, 1);
  const max = Math.max(...values, 0) || 1;
  const plotH = H - PAD_T - PAD_B;
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;
  const inPeak = (i: number) => {
    if (!highlight) return false;
    const [a, b] = highlight;
    return a <= b ? i >= a && i <= b : i >= a || i <= b;
  };
  const line = useMemo(() => {
    const s = smooth(values, Math.max(1, Math.round(n / 24)));
    return curve(s.map((v, i) => [i * step + step / 2, y(v) - 6] as [number, number]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, n, step, max]);
  const every = tickEvery ?? Math.max(1, Math.round(n / 8));
  const gid = `pb${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  // Where the peak pill sits: over the window's tallest bar.
  const peakIdx = highlight ? values.reduce((best, v, i) => (inPeak(i) && v > values[best] ? i : best), highlight[0]) : null;

  return (
    <div className="relative w-full select-none" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`${gid}-on`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.95} />
            <stop offset="100%" stopColor={accent} stopOpacity={0.35} />
          </linearGradient>
          <linearGradient id={`${gid}-off`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#CBD5E1" stopOpacity={0.9} />
            <stop offset="100%" stopColor="#E2E8F0" stopOpacity={0.35} />
          </linearGradient>
          <linearGradient id={`${gid}-band`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.08} />
            <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={PAD_T + plotH * (1 - f)} y2={PAD_T + plotH * (1 - f)} stroke="#EEF2F7" strokeDasharray="3 5" />
        ))}

        {values.map((v, i) => {
          const on = inPeak(i);
          const bw = Math.max(step * 0.42, 1.2);
          const top = y(v);
          return (
            <g key={i}>
              {on && <rect x={i * step} y={PAD_T - 12} width={step} height={plotH + 12} fill={`url(#${gid}-band)`} />}
              <motion.rect
                x={i * step + (step - bw) / 2}
                width={bw}
                rx={bw / 2}
                initial={{ y: PAD_T + plotH, height: 0 }}
                animate={{ y: Math.min(top, PAD_T + plotH - 2), height: Math.max(PAD_T + plotH - top, 2) }}
                transition={{ duration: 0.6, delay: (i / n) * 0.5, ease: [0.22, 1, 0.36, 1] }}
                fill={on ? `url(#${gid}-on)` : `url(#${gid}-off)`}
                opacity={hover == null || hover === i ? 1 : 0.55}
              />
              <rect x={i * step} y={0} width={step} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}

        <motion.path
          d={line} fill="none" stroke={accent} strokeOpacity={0.55} strokeWidth={2.2} vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />

      </svg>

      {/* axis labels in HTML: the SVG stretches to fit, which would distort text */}
      {labels.map((l, i) => (i % every === 0 ? (
        <span key={i} className="pointer-events-none absolute bottom-0 -translate-x-1/2 text-[11px] tabular-nums text-slate-400" style={{ left: `${((i + 0.5) / n) * 100}%` }}>{l}</span>
      ) : null))}

      {peakIdx != null && peakLabel && hover == null && (
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}
          className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-3 py-1 text-[12px] shadow-[0_8px_24px_-10px_rgba(15,23,42,0.35)] ring-1 ring-slate-100"
          style={{ left: `${((peakIdx + 0.5) / n) * 100}%`, top: 6 }}
        >
          <span className="text-slate-500">{peakLabel}</span>
        </motion.div>
      )}
      {hover != null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-900 px-3 py-1 text-[12px] text-white shadow-lg"
          style={{ left: `${((hover + 0.5) / n) * 100}%`, top: 6 }}
        >
          {labels[hover]} · <b className="font-medium tabular-nums">{format(values[hover])}</b>
        </div>
      )}

      {highlight && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[-14px] h-2.5 rounded-full bg-slate-100">
          <div
            className="absolute inset-y-0 rounded-full bg-white shadow-[0_1px_3px_rgba(15,23,42,0.25)] ring-1 ring-slate-200"
            style={highlight[0] <= highlight[1]
              ? { left: `${(highlight[0] / n) * 100}%`, width: `${((highlight[1] - highlight[0] + 1) / n) * 100}%` }
              : { left: `${(highlight[0] / n) * 100}%`, right: 0 }}
          />
        </div>
      )}
    </div>
  );
}
