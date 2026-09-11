"use client";

/* Per-payout drill-down for the payments-sheet insights panel.

   One gateway payout ("Payment Received on 05.09.2026 (25,794.83)")
   routinely settles orders from more than one calendar month — a September
   Tabby payout paying for late-August orders. This groups received rows
   back into their settlement batches and, inside each batch, splits the
   money by the ORDER's own month, so the cross-month composition of a
   payout is visible instead of lumped into whichever month it landed.

   Pure over the row set the API already returned (computePayoutBreakdown in
   lib/finance/payments-sheet-insights.ts) — windowed on the payout date, so
   it follows the same period selector as the rest of the panel. */

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { computePayoutBreakdown, type PaymentSheetRow } from "@/lib/finance/payments-sheet-insights";

const AED2 = new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const aed2 = (n: number) => AED2.format(n);

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function SheetPayoutBreakdown({
  rows,
  from = null,
  to = null,
}: {
  rows: PaymentSheetRow[];
  from?: string | null;
  to?: string | null;
}) {
  const groups = useMemo(() => computePayoutBreakdown(rows, from, to), [rows, from, to]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const totalMatched = useMemo(() => groups.reduce((s, g) => s + g.matchedTotalAed, 0), [groups]);

  return (
    <div className="overflow-hidden rounded-2xl border border-[#DBEAFE] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[#DBEAFE] bg-[#F8FAFF] px-4 py-3">
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[#64748B]">Payouts, split by order month</div>
          <div className="mt-0.5 text-[11px] text-[#94A3B8]">
            {groups.length} payout{groups.length === 1 ? "" : "s"} · AED {aed2(totalMatched)} matched
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="px-4 py-10 text-center text-[13px] text-[#94A3B8]">No settled payouts in this range.</div>
      ) : (
        <ul className="divide-y divide-[#EFF6FF]">
          {groups.map((g, i) => {
            const isOpen = expanded.has(g.key);
            const crossMonth = g.byOrderMonth.length > 1;
            const variance = g.varianceAed;
            const varianceOff = variance != null && Math.abs(variance) >= 0.01;
            return (
              <motion.li
                key={g.key}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 12) * 0.02, duration: 0.2 }}
              >
                <button
                  onClick={() => toggle(g.key)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[#F8FAFF]"
                >
                  <ChevronRight
                    size={15}
                    className={`mt-0.5 shrink-0 text-[#93C5FD] transition-transform ${isOpen ? "rotate-90" : ""}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-[13px] font-semibold text-[#0F172A]">{g.gatewayLabel}</span>
                      <span className="text-[11.5px] text-[#64748B]">{fmtDate(g.settlementDate)}</span>
                      <span className="text-[11.5px] text-[#94A3B8]">·</span>
                      <span className="text-[11.5px] text-[#64748B]">
                        {g.orderCount} order{g.orderCount === 1 ? "" : "s"}
                      </span>
                      {crossMonth && (
                        <span className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[10px] font-medium text-[#1D4ED8]">
                          spans {g.byOrderMonth.length} months
                        </span>
                      )}
                    </div>

                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {g.byOrderMonth.map((m) => (
                        <span
                          key={m.monthKey}
                          className="inline-flex items-center gap-1.5 rounded-md border border-[#DBEAFE] bg-[#F8FAFF] px-2 py-1 text-[11px]"
                        >
                          <span className="font-medium text-[#1E3A8A]">{m.label}</span>
                          <span className="font-mono tabular-nums text-[#0F172A]">AED {aed2(m.amountAed)}</span>
                          <span className="text-[#94A3B8]">({m.orderCount})</span>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="font-mono text-[13px] font-semibold tabular-nums text-[#0F172A]">
                      AED {aed2(g.matchedTotalAed)}
                    </div>
                    {g.declaredTotalAed != null && (
                      <div
                        className={`mt-0.5 font-mono text-[10.5px] tabular-nums ${
                          varianceOff ? "text-[#B45309]" : "text-[#15803D]"
                        }`}
                      >
                        {varianceOff
                          ? `${variance! > 0 ? "+" : "−"}AED ${aed2(Math.abs(variance!))} vs payout`
                          : `matches payout ✓`}
                      </div>
                    )}
                  </div>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden bg-[#FBFDFF]"
                    >
                      <table className="w-full border-collapse text-[12px]">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wider text-[#94A3B8]">
                            <th className="px-4 py-1.5 text-left font-semibold">Order</th>
                            <th className="px-3 py-1.5 text-left font-semibold">Order date</th>
                            <th className="px-3 py-1.5 text-left font-semibold">Month</th>
                            <th className="px-3 py-1.5 text-left font-semibold">Region</th>
                            <th className="px-4 py-1.5 text-right font-semibold">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.orders.map((o) => (
                            <tr key={`${o.tab}-${o.rowNumber}`} className="border-t border-[#EFF6FF]">
                              <td className="px-4 py-1.5 font-medium text-[#0F172A]">{o.orderNumber ?? "—"}</td>
                              <td className="px-3 py-1.5 text-[#64748B]">{o.date ? fmtDate(o.date) : "—"}</td>
                              <td className="px-3 py-1.5 text-[#64748B]">
                                {o.monthKey === "undated"
                                  ? "Undated"
                                  : new Date(o.monthKey + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                              </td>
                              <td className="px-3 py-1.5 text-[#64748B]">{o.region || "—"}</td>
                              <td className="px-4 py-1.5 text-right font-mono tabular-nums text-[#0F172A]">AED {aed2(o.amountAed)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
