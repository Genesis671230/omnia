"use client";

/* Month-end close panel (RAMZA brand): the month, how much of the sales money
 * that reached the bank is matched, where it came from, and the three steps
 * left before the month can be closed. Each step filters the table below.
 *
 * Deliberately plain: white surface, hairlines, small radii, ink figures,
 * navy as the only button colour, the gateways' own logos. No gradients,
 * glows, rings or icon bubbles (founder rule, design_quality_bar). */

import { useMemo } from "react";
import { Check, ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import { inStatus, type StatusFilter } from "@/lib/reconciliation/match-status";
import { GatewayLogo } from "./gateway-logo";
import type { ReconLine } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");
/** Local-date month bounds as YYYY-MM-DD, never via toISOString (Dubai is UTC+4). */
export function monthRange(y: number, m: number): [string, string] {
  const last = new Date(y, m + 1, 0).getDate();
  return [`${y}-${pad(m + 1)}-01`, `${y}-${pad(m + 1)}-${pad(last)}`];
}
export function currentMonthRange(): [string, string] {
  const n = new Date();
  return monthRange(n.getFullYear(), n.getMonth());
}
function monthOf(from: string, to: string): { y: number; m: number } | null {
  if (!from || !to) return null;
  const y = +from.slice(0, 4), m = +from.slice(5, 7) - 1;
  const [f, t] = monthRange(y, m);
  return f === from && t === to ? { y, m } : null;
}

export function compactAed(n: number) {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}m` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}k` : a.toFixed(0);
  return `${n < 0 ? "−" : ""}AED ${s}`;
}
const exact = (n: number) => `AED ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const btnQuiet =
  "inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[#D9DEE8] bg-white px-3 text-[12.5px] font-medium text-[#14131C] transition-colors hover:border-[#0B1533] disabled:opacity-40";

type Step = { key: string; n: number; title: string; done: boolean; line: string; filter?: StatusFilter; action?: React.ReactNode };

export function MonthCloseHero({
  lines, loading, fromDate, toDate, onRange, onStatus, status, statementMissing, actions, onExport, exporting,
}: {
  lines: ReconLine[];
  loading: boolean;
  fromDate: string;
  toDate: string;
  onRange: (f: string, t: string) => void;
  onStatus: (s: StatusFilter) => void;
  status: StatusFilter;
  statementMissing: boolean;
  actions?: React.ReactNode;
  onExport: () => void;
  exporting: boolean;
}) {
  const month = monthOf(fromDate, toDate);
  const now = new Date();
  const isCurrent = !!month && month.y === now.getFullYear() && month.m === now.getMonth();
  const title = month
    ? new Date(month.y, month.m, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : fromDate || toDate ? "Custom range" : "All time";
  const step = (d: number) => {
    const base = month ?? { y: now.getFullYear(), m: now.getMonth() };
    const t = new Date(base.y, base.m + d, 1);
    onRange(...monthRange(t.getFullYear(), t.getMonth()));
  };

  const m = useMemo(() => {
    const as = (l: ReconLine) => ({ ...l, forceBook: l.forceBook ?? null });
    let total = 0, settled = 0, awaitingN = 0, awaitingAed = 0, excN = 0, other = 0, credits = 0;
    const gw = new Map<string, { total: number; settled: number }>();
    for (const l of lines) {
      // Unclassified credits are owner transfers / funding, not sales money:
      // they stay in the table but don't count toward the close.
      if (l.provider === "Unclassified") { other += l.bankAmount; continue; }
      credits++;
      total += l.bankAmount;
      const g = gw.get(l.provider) ?? { total: 0, settled: 0 };
      g.total += l.bankAmount;
      if (inStatus(as(l), "settled")) { settled += l.bankAmount; g.settled += l.bankAmount; }
      if (inStatus(as(l), "awaiting")) { awaitingN++; awaitingAed += l.bankAmount; }
      if (inStatus(as(l), "exceptions")) excN++;
      gw.set(l.provider, g);
    }
    const gateways = [...gw.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total);
    return { other, credits, total, settled, awaitingN, awaitingAed, excN, pct: total > 0 ? (settled / total) * 100 : 0, gateways };
  }, [lines]);

  const steps: Step[] = [
    {
      key: "bank", n: 1, title: "Bank statement",
      done: lines.length > 0 && !statementMissing,
      line: lines.length ? `${lines.length} credits received` : "Upload the month's statement",
      action: actions,
    },
    {
      key: "files", n: 2, title: "Payout files", filter: "awaiting",
      done: m.credits > 0 && m.awaitingN === 0,
      line: m.awaitingN ? `${m.awaitingN} credits without a file · ${compactAed(m.awaitingAed)}` : "Every credit has its file",
    },
    {
      key: "review", n: 3, title: "Review differences", filter: "exceptions",
      done: m.credits > 0 && m.excN === 0,
      line: m.excN ? `${m.excN} credits to check` : "Nothing to check",
    },
  ];
  const left = steps.filter((s) => !s.done).length;

  return (
    <section className="rounded-[8px] border border-[#E3E7F0] bg-white">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[#EEF1F5] px-5 py-3.5">
        <div className="flex items-center gap-1">
          <button onClick={() => step(-1)} aria-label="Previous month" className="rounded-[6px] p-1.5 text-[#4A5263] hover:bg-[#F1F3F7] hover:text-[#14131C]"><ChevronLeft size={16} /></button>
          <h2 className="min-w-[150px] text-center text-[16px] font-semibold tracking-[-0.01em]">{title}</h2>
          <button onClick={() => step(1)} disabled={isCurrent} aria-label="Next month" className="rounded-[6px] p-1.5 text-[#4A5263] hover:bg-[#F1F3F7] hover:text-[#14131C] disabled:opacity-30"><ChevronRight size={16} /></button>
        </div>
        {!loading && m.credits > 0 && (
          <span className={`text-[12.5px] ${left ? "text-[#6B7385]" : "font-medium text-[#1F7A4D]"}`}>
            {left ? `${3 - left} of 3 steps done` : "All steps done · ready to close"}
          </span>
        )}
        <button
          onClick={onExport}
          disabled={exporting || lines.length === 0}
          className="ml-auto inline-flex h-9 items-center gap-2 rounded-[6px] bg-[#0B1533] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#1A2647] disabled:opacity-50"
        >
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Download close pack
        </button>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* A — the money */}
        <div className="px-5 py-5">
          <div className="text-[12px] font-medium text-[#6B7385]">Sales money in the bank</div>
          <div className="mt-1 text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums" title={exact(m.total)}>
            {loading ? <span className="inline-block h-8 w-40 animate-pulse rounded-[4px] bg-[#EEF1F5]" /> : compactAed(m.total)}
          </div>
          <div className="mt-4 flex items-baseline justify-between text-[12.5px]">
            <span className="text-[#4A5263]"><span className="font-semibold text-[#14131C] tabular-nums" title={exact(m.settled)}>{compactAed(m.settled)}</span> matched to orders</span>
            <span className="font-semibold tabular-nums">{loading ? "–" : `${Math.floor(m.pct)}%`}</span>
          </div>
          <div className="mt-1.5 h-[6px] overflow-hidden rounded-[2px] bg-[#EEF1F5]">
            <div className="h-full bg-[#0B1533] transition-[width] duration-700 ease-out" style={{ width: `${loading ? 0 : Math.min(100, m.pct)}%` }} />
          </div>
          {m.other > 0 && (
            <div className="mt-3 text-[12px] text-[#7A8294]" title={exact(m.other)}>
              {compactAed(m.other)} of owner transfers are left out: they are not sales.
            </div>
          )}
        </div>

        {/* B — by gateway */}
        <div className="border-t border-[#EEF1F5] px-5 py-4 lg:border-l lg:border-t-0">
          <div className="mb-2 flex justify-between text-[11px] font-medium uppercase tracking-[0.1em] text-[#9AA1B0]">
            <span>Gateway</span><span>Matched</span>
          </div>
          <ul className="space-y-[7px]">
            {m.gateways.slice(0, 7).map((g) => {
              const pct = g.total > 0 ? (g.settled / g.total) * 100 : 0;
              return (
                <li key={g.name} className="flex items-center gap-2.5 text-[12.5px]" title={`${exact(g.settled)} of ${exact(g.total)} matched`}>
                  <GatewayLogo name={g.name} size={18} />
                  <span className="min-w-0 flex-1 truncate text-[#14131C]">{g.name}</span>
                  <span className="w-[72px] text-right tabular-nums text-[#6B7385]">{compactAed(g.total)}</span>
                  <span className="h-[4px] w-14 overflow-hidden rounded-[2px] bg-[#EEF1F5]"><span className="block h-full bg-[#0B1533]" style={{ width: `${pct}%` }} /></span>
                  <span className={`w-9 text-right tabular-nums ${pct >= 99.5 ? "text-[#1F7A4D]" : "text-[#14131C]"}`}>{Math.floor(pct)}%</span>
                </li>
              );
            })}
            {!loading && m.gateways.length === 0 && <li className="text-[12.5px] text-[#7A8294]">No gateway credits this month yet.</li>}
          </ul>
        </div>

        {/* C — the close checklist */}
        <ol className="border-t border-[#EEF1F5] lg:border-l lg:border-t-0">
          {steps.map((s) => {
            const active = !!s.filter && status === s.filter;
            return (
              <li key={s.key} className={`flex items-center gap-3 border-b border-[#EEF1F5] px-5 py-3 last:border-b-0 ${active ? "bg-[#F6F7F9]" : ""}`}>
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-[12px] font-semibold ${s.done ? "bg-[#E7F4EC] text-[#1F7A4D]" : "border border-[#D9DEE8] text-[#4A5263]"}`}>
                  {s.done ? <Check size={13} strokeWidth={2.4} /> : s.n}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium">{s.title}</div>
                  <div className={`truncate text-[12px] ${s.done ? "text-[#1F7A4D]" : "text-[#6B7385]"}`}>{loading ? "…" : s.line}</div>
                </div>
                {s.filter && !s.done && (
                  <button onClick={() => onStatus(active ? "all" : s.filter!)} aria-pressed={active} className={btnQuiet}>
                    {active ? "Show all" : "Show"}
                  </button>
                )}
                {s.action && <div className="shrink-0">{s.action}</div>}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
