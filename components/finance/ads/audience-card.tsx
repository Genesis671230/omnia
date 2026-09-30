"use client";

/* Who responds — age × gender as a mirrored pyramid (women left, men right),
 * with each side's share and the single best segment to target. */

import { useState } from "react";
import { motion } from "framer-motion";
import type { AdMetrics } from "@/lib/integrations/ads/meta-explorer";
import { Card, Eyebrow, Seg, compact, fmt } from "@/components/finance/dashboard-v2/overview/kit";
import { ui } from "@/components/finance/dashboard-v2/overview/ui";

type Row = { age: string; gender: string } & AdMetrics;
type Metric = "purchases" | "linkClicks" | "spend";

const WOMEN = "#DB2777";
const MEN = "#4F46E5";

export function AudienceCard({ rows }: { rows: Row[] }) {
  const [metric, setMetric] = useState<Metric>("purchases");
  const ages = [...new Set(rows.map((r) => r.age))].sort();
  const get = (age: string, gender: string) => rows.find((r) => r.age === age && r.gender === gender);
  const val = (r?: Row) => (r ? r[metric] : 0);
  const max = Math.max(...rows.filter((r) => r.gender !== "unknown").map(val), 1);
  const side = (gender: string) => rows.filter((r) => r.gender === gender);
  const total = (g: string, k: keyof AdMetrics) => side(g).reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const all = total("female", metric) + total("male", metric);
  const share = (g: string) => (all > 0 ? Math.round((total(g, metric) / all) * 100) : 0);
  const roasOf = (g: string) => { const s = total(g, "spend"); return s ? total(g, "value") / s : null; };

  // The segment to target: best ROAS among segments with real spend.
  const minSpend = Math.max(rows.reduce((s, r) => s + r.spend, 0) * 0.03, 100);
  const best = [...rows].filter((r) => r.gender !== "unknown" && r.spend >= minSpend && r.purchases > 0).sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))[0];
  const fmtV = (v: number) => (metric === "spend" ? `AED ${compact(v)}` : fmt(v));

  return (
    <Card delay={0.14}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>Who responds</Eyebrow>
          {best ? (
            <p className="mt-2 text-[15px] text-slate-900">
              Best: <b className="font-medium">{best.gender === "female" ? "Women" : "Men"} {best.age}</b>
              <span className={ui.caption}> · {best.roas?.toFixed(2)}× ROAS · AED {fmt(best.cpa ?? 0)} per purchase</span>
            </p>
          ) : <p className={`mt-2 ${ui.caption}`}>Not enough purchases to rank segments yet.</p>}
        </div>
        <Seg value={metric} options={[["purchases", "Purchases"], ["linkClicks", "Clicks"], ["spend", "Spend"]]} onChange={setMetric} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {([["female", "Women", WOMEN], ["male", "Men", MEN]] as const).map(([g, label, color]) => (
          <div key={g} className="rounded-2xl bg-slate-50 px-4 py-3">
            <p className="flex items-center gap-1.5 text-[12px] text-slate-500"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}</p>
            <p className="mt-1 text-[20px] font-light tabular-nums text-slate-900">{share(g)}%</p>
            <p className={ui.hint}>{roasOf(g) != null ? `${roasOf(g)!.toFixed(2)}× ROAS` : "no spend"}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 space-y-2">
        {ages.map((age, i) => {
          const f = get(age, "female"); const m = get(age, "male");
          return (
            <div key={age} className="grid grid-cols-[1fr_56px_1fr] items-center gap-2">
              <div className="flex items-center justify-end gap-2">
                <span className="text-[11.5px] tabular-nums text-slate-500">{fmtV(val(f))}</span>
                <span className="relative h-5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <motion.span className="absolute inset-y-0 right-0 rounded-full" style={{ background: `linear-gradient(270deg, ${WOMEN}, ${WOMEN}99)` }}
                    initial={{ width: 0 }} animate={{ width: `${(val(f) / max) * 100}%` }} transition={{ duration: 0.6, delay: i * 0.05 }} />
                </span>
              </div>
              <span className="text-center text-[12px] font-medium tabular-nums text-slate-700">{age}</span>
              <div className="flex items-center gap-2">
                <span className="relative h-5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <motion.span className="absolute inset-y-0 left-0 rounded-full" style={{ background: `linear-gradient(90deg, ${MEN}, ${MEN}99)` }}
                    initial={{ width: 0 }} animate={{ width: `${(val(m) / max) * 100}%` }} transition={{ duration: 0.6, delay: i * 0.05 }} />
                </span>
                <span className="text-[11.5px] tabular-nums text-slate-500">{fmtV(val(m))}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className={`mt-4 ${ui.hint}`}>Meta&apos;s age × gender breakdown for the period. Purchases are pixel-attributed.</p>
    </Card>
  );
}
