"use client";

/* What sells and when — on the Orders page, under the sales overview.
 *   When orders come in  every quarter-hour of the day (Dubai), summed over the
 *                        period, with the best 3-hour window lifted out
 *   Top-selling products the SKUs bringing in the most, with trend against the
 *                        period before and stock on hand */

import { useState } from "react";
import type { SkuRow, TimeOfDay } from "@/lib/orders/orders-analytics";
import { Card, Eyebrow, Seg, compact, fmt } from "@/components/finance/dashboard-v2/overview/kit";
import { ui } from "@/components/finance/dashboard-v2/overview/ui";
import { PeakBars } from "@/components/finance/charts/peak-bars";

export function TimeOfDayCard({ data }: { data: TimeOfDay }) {
  const [metric, setMetric] = useState<"revenue" | "orders">("revenue");
  const values = data.slots.map((s) => (metric === "revenue" ? s.revenue : s.orders));
  const p = data.peak;
  return (
    <Card delay={0.12}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>When orders come in</Eyebrow>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className={ui.number}>{p.label}</span>
            <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11.5px] font-medium text-indigo-700">{Math.round(p.share * 100)}% of sales</span>
          </div>
          <p className={`mt-1 ${ui.caption}`}>The busiest 3 hours (Dubai time): {fmt(p.orders)} orders, AED {compact(p.revenue)} in the period</p>
        </div>
        <Seg value={metric} options={[["revenue", "Sales"], ["orders", "Orders"]]} onChange={setMetric} />
      </div>
      <div className="mt-6 pb-5">
        <PeakBars
          values={values}
          labels={data.slots.map((s) => s.label)}
          highlight={[p.fromSlot, p.toSlot]}
          peakLabel={`Peak ${p.label}`}
          tickEvery={12}
          format={(v) => (metric === "revenue" ? `AED ${fmt(v)}` : `${fmt(v)} orders`)}
        />
      </div>
    </Card>
  );
}

const TREND: Record<SkuRow["trend"], { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-indigo-50 text-indigo-700" },
  rising: { label: "Rising", cls: "bg-emerald-50 text-emerald-700" },
  steady: { label: "Steady", cls: "bg-slate-100 text-slate-600" },
  falling: { label: "Falling", cls: "bg-rose-50 text-rose-700" },
};

export function TopSkusCard({ rows }: { rows: SkuRow[] }) {
  return (
    <Card delay={0.14}>
      <div className="flex items-baseline justify-between gap-3">
        <Eyebrow>Top-selling products</Eyebrow>
        <span className={ui.hint}>By sales in the period · trend vs the period before</span>
      </div>
      {rows.length === 0 ? (
        <p className={`mt-4 ${ui.caption}`}>No product lines on the orders in this period.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="text-left">
                <th className={`${ui.th} w-8`}>#</th>
                <th className={ui.th}>Product</th>
                <th className={`${ui.th} text-right`}>Avg price</th>
                <th className={`${ui.th} text-right`}>Units</th>
                <th className={ui.th}>Trend</th>
                <th className={`${ui.th} text-right`}>Sales</th>
                <th className={`${ui.th} text-right`}>In stock</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.sku}-${r.title}`} className="group">
                  <td className={`${ui.td} text-slate-400`}>{i + 1}</td>
                  <td className={ui.td}>
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-100">
                        {r.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`${r.imageUrl}${r.imageUrl.includes("?") ? "&" : "?"}width=96`} alt="" className="h-full w-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block max-w-[340px] truncate font-medium text-slate-900" title={r.title}>{r.title}</span>
                        {r.sku && <span className="block text-[11.5px] text-slate-400">{r.sku}</span>}
                      </span>
                    </div>
                  </td>
                  <td className={`${ui.td} text-right text-slate-600`}>AED {fmt(r.avgPrice)}</td>
                  <td className={`${ui.td} text-right text-slate-600`}>{fmt(r.units)}</td>
                  <td className={ui.td}><span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${TREND[r.trend].cls}`}>{TREND[r.trend].label}</span></td>
                  <td className={`${ui.td} text-right font-medium text-slate-900`} title={`AED ${fmt(r.revenue, 2)}`}>AED {compact(r.revenue)}</td>
                  <td className={`${ui.td} text-right ${r.stock != null && r.stock <= 2 ? "text-rose-600" : "text-slate-600"}`}>{r.stock ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
