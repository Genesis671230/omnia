"use client";

/* The table's own toolbar: every filter in ONE compact row on top of the
 * table card, so the rows get the screen. Status as tabs with counts; gateway
 * and dates as small menus that say what is selected; unmatched payout files
 * as a toggle. Popovers use plain hex colors (theme tokens aren't defined at
 * <body>, where Radix portals them). */

import { AlertTriangle, CalendarDays, Check, ChevronDown, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { StatusFilter } from "@/lib/reconciliation/match-status";
import { gatewayColor } from "./colors";

export const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "settled", label: "Settled" },
  { key: "awaiting", label: "Awaiting" },
  { key: "exceptions", label: "Exceptions" },
  { key: "flagged", label: "Flagged" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const DATE_PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: "All time", range: () => ["", ""] },
  { label: "Last 7 days", range: () => [iso(new Date(Date.now() - 6 * 864e5)), iso(new Date())] },
  { label: "Last 30 days", range: () => [iso(new Date(Date.now() - 29 * 864e5)), iso(new Date())] },
  { label: "This month", range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), iso(n)]; } },
  { label: "Last month", range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 0))]; } },
];

const menuBtn = (active: boolean) =>
  `inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors ${
    active ? "bg-[#EAF1FD] text-[#1E3A8A] ring-1 ring-inset ring-[#E7D3B0]" : "text-[#5E564B] ring-1 ring-inset ring-[#D8E1F1] hover:bg-[#F3F6FC] hover:text-[#0F1B3D]"
  }`;
const panel = "w-64 rounded-2xl border border-[#D8E1F1] bg-white p-1.5 text-[#0F1B3D] shadow-[0_12px_32px_rgba(15,27,61,0.14)]";

function dateLabel(from: string, to: string) {
  if (!from && !to) return "All time";
  const hit = DATE_PRESETS.find((p) => { const [f, t] = p.range(); return f === from && t === to; });
  if (hit) return hit.label;
  const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${from ? fmt(from) : "Start"} to ${to ? fmt(to) : "today"}`;
}

export function ReconToolbar({
  status, onStatus, counts, gatewayOptions, gateways, onToggleGateway, onClearGateways,
  fromDate, toDate, onRange, unmatchedCount, unmatchedOpen, onToggleUnmatched, shown, total, updatedLabel, refreshing,
}: {
  status: StatusFilter; onStatus: (s: StatusFilter) => void; counts: Record<StatusFilter, number>;
  gatewayOptions: string[]; gateways: Set<string>; onToggleGateway: (g: string) => void; onClearGateways: () => void;
  fromDate: string; toDate: string; onRange: (f: string, t: string) => void;
  unmatchedCount: number; unmatchedOpen: boolean; onToggleUnmatched: () => void;
  shown: number; total: number; updatedLabel: string; refreshing: boolean;
}) {
  const gwLabel = gateways.size === 0 ? "All gateways" : gateways.size <= 2 ? [...gateways].join(", ") : `${gateways.size} gateways`;
  return (
    <div className="flex flex-col gap-2 border-b border-[#D8E1F1] px-3 py-2 lg:flex-row lg:items-center lg:gap-3">
      <div role="tablist" aria-label="Status" className="-mb-px flex items-center gap-0.5 overflow-x-auto">
        {STATUS_TABS.map((s) => {
          const on = status === s.key;
          return (
            <button
              key={s.key} role="tab" aria-selected={on} onClick={() => onStatus(s.key)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${on ? "bg-[#0F1B3D] text-[#F3F6FC]" : "text-[#46546F] hover:bg-[#F3F6FC] hover:text-[#0F1B3D]"}`}
            >
              {s.label}
              <span className={`rounded-md px-1 text-[11px] tabular-nums ${on ? "bg-white/15" : s.key === "exceptions" && counts.exceptions > 0 ? "bg-[#FBECE8] text-[#9B3A24]" : "bg-[#EEF2FA] text-[#46546F]"}`}>
                {counts[s.key] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 lg:ml-auto">
        <Popover>
          <PopoverTrigger asChild>
            <button className={menuBtn(gateways.size > 0)} aria-label={`Gateway filter: ${gwLabel}`}>
              {gateways.size === 1 && <i className="h-2 w-2 rounded-full" style={{ background: gatewayColor([...gateways][0]) }} aria-hidden />}
              {gwLabel} <ChevronDown size={13} className="opacity-60" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className={panel}>
            {gatewayOptions.map((g) => {
              const on = gateways.has(g);
              return (
                <button key={g} onClick={() => onToggleGateway(g)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-[#F3F6FC]" aria-pressed={on}>
                  <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? "border-[#0F1B3D] bg-[#0F1B3D] text-white" : "border-[#C9D5EA]"}`}>{on && <Check size={11} />}</span>
                  <i className="h-2 w-2 rounded-full" style={{ background: gatewayColor(g) }} aria-hidden />
                  {g}
                </button>
              );
            })}
            <button onClick={onClearGateways} disabled={gateways.size === 0} className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-[12.5px] font-medium text-[#1D4ED8] hover:bg-[#F3F6FC] disabled:text-[#C8D2E6]">
              Show all gateways
            </button>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <button className={menuBtn(!!(fromDate || toDate))}>
              <CalendarDays size={13} className="opacity-70" /> {dateLabel(fromDate, toDate)} <ChevronDown size={13} className="opacity-60" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className={panel}>
            {DATE_PRESETS.map((p) => {
              const [f, t] = p.range();
              const on = f === fromDate && t === toDate;
              return (
                <button key={p.label} onClick={() => onRange(f, t)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-[#F3F6FC]">
                  {p.label} {on && <Check size={13} className="text-[#1D4ED8]" />}
                </button>
              );
            })}
            <div className="mt-1 space-y-1.5 border-t border-[#EEF2FA] px-2 pb-1 pt-2">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#5E6B85]">Custom range</div>
              <div className="flex items-center gap-1.5">
                <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => onRange(e.target.value, toDate)} aria-label="From date" className="h-8 min-w-0 flex-1 rounded-md border-0 px-1.5 text-[12px] ring-1 ring-inset ring-[#D8E1F1] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]" />
                <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => onRange(fromDate, e.target.value)} aria-label="To date" className="h-8 min-w-0 flex-1 rounded-md border-0 px-1.5 text-[12px] ring-1 ring-inset ring-[#D8E1F1] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]" />
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {unmatchedCount > 0 && (
          <button onClick={onToggleUnmatched} aria-expanded={unmatchedOpen} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium ring-1 ring-inset transition-colors ${unmatchedOpen ? "bg-[#FBECE8] text-[#9B3A24] ring-[#F1CFC6]" : "text-[#9B3A24] ring-[#F1CFC6] hover:bg-[#FDF6F3]"}`}>
            <AlertTriangle size={13} aria-hidden /> {unmatchedCount} unmatched file{unmatchedCount === 1 ? "" : "s"}
          </button>
        )}

        <span className="ml-1 hidden whitespace-nowrap text-[11.5px] text-[#5E6B85] xl:inline">
          {shown === total ? `${total} credits` : `${shown} of ${total}`}
          {updatedLabel && <> · {refreshing ? <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> updating</span> : updatedLabel}</>}
        </span>
      </div>
    </div>
  );
}
