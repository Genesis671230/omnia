"use client";

import { CalendarDays, Layers, Search, X } from "lucide-react";
import type { GroupMode } from "@/lib/reconciliation/filters";

/* Filters live in ONE row above the content, and every one of them is visible
 * at rest — a filter hidden behind a menu is a filter the reader forgets is
 * on, which is how a "missing" credit gets reported as a bug. */

type Preset = { label: string; days: number | "mtd" | "lastMonth" };

const PRESETS: Preset[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "This month", days: "mtd" },
  { label: "Last month", days: "lastMonth" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

function presetRange(p: Preset): { from: string; to: string } {
  const now = new Date();
  if (p.days === "mtd") {
    return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  }
  if (p.days === "lastMonth") {
    return {
      from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  return { from: iso(new Date(now.getTime() - p.days * 86_400_000)), to: iso(now) };
}

export function ReconFilters({
  query, onQuery, fromDate, toDate, onRange, groupMode, onGroupMode, resultCount, totalCount,
}: {
  query: string;
  onQuery: (v: string) => void;
  fromDate: string;
  toDate: string;
  onRange: (from: string, to: string) => void;
  groupMode: GroupMode;
  onGroupMode: (m: GroupMode) => void;
  resultCount: number;
  totalCount: number;
}) {
  const filtering = query.trim() !== "" || fromDate !== "" || toDate !== "";

  return (
    <div className="mb-4 rounded-xl border border-[#EAE3D6] bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative min-w-[240px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8A8175]" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search order #, bank ref, payout ID, gateway, narration…"
            aria-label="Search reconciliation credits"
            className="w-full rounded-lg border border-[#EAE3D6] bg-[#FBF8F1] py-2 pl-9 pr-8 text-[13px] text-[#1F1B16] outline-none transition-colors placeholder:text-[#A79E90] focus:border-[#B08343] focus:bg-white"
          />
          {query && (
            <button
              onClick={() => onQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[#8A8175] hover:bg-[#F3EFE7] hover:text-[#1F1B16]"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Group by */}
        <div className="flex items-center gap-1.5 rounded-lg border border-[#EAE3D6] bg-[#FBF8F1] px-2 py-1">
          <Layers size={13} className="text-[#8A8175]" />
          <span className="text-[11px] font-medium uppercase tracking-wider text-[#8A8175]">Group</span>
          {(["gateway", "date", "status", "none"] as GroupMode[]).map((m) => (
            <button
              key={m}
              onClick={() => onGroupMode(m)}
              className={`rounded-md px-2 py-1 text-[12px] font-medium capitalize transition-colors ${
                groupMode === m ? "bg-[#1F1B16] text-[#FBF8F1]" : "text-[#8A8175] hover:bg-white hover:text-[#1F1B16]"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-[#EAE3D6] pt-2.5">
        <CalendarDays size={14} className="text-[#8A8175]" />
        <label className="flex items-center gap-1.5 text-[12px] font-medium text-[#8A8175]">
          From
          <input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => onRange(e.target.value, toDate)}
            className="rounded-md border border-[#D6CCBA] bg-white px-2 py-1 text-[12.5px] text-[#1F1B16] outline-none focus:border-[#B08343]"
          />
        </label>
        <label className="flex items-center gap-1.5 text-[12px] font-medium text-[#8A8175]">
          To
          <input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => onRange(fromDate, e.target.value)}
            className="rounded-md border border-[#D6CCBA] bg-white px-2 py-1 text-[12.5px] text-[#1F1B16] outline-none focus:border-[#B08343]"
          />
        </label>

        <div className="flex items-center gap-1">
          {PRESETS.map((p) => {
            const r = presetRange(p);
            const on = fromDate === r.from && toDate === r.to;
            return (
              <button
                key={p.label}
                onClick={() => onRange(r.from, r.to)}
                className={`rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                  on
                    ? "border-[#B08343] bg-[#FBF3E6] text-[#6F5325]"
                    : "border-[#EAE3D6] bg-white text-[#8A8175] hover:border-[#D6CCBA] hover:text-[#1F1B16]"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {filtering && (
          <>
            <button
              onClick={() => { onRange("", ""); onQuery(""); }}
              className="rounded-md border border-[#EAE3D6] bg-white px-2.5 py-1 text-[12px] font-medium text-[#8A8175] hover:border-[#D6CCBA] hover:text-[#1F1B16]"
            >
              Clear all
            </button>
            {/* Stated plainly so a narrow result never reads as missing data. */}
            <span className="ml-auto text-[12px] text-[#8A8175]">
              Showing <b className="font-semibold text-[#1F1B16]">{resultCount}</b> of {totalCount} credits
            </span>
          </>
        )}
      </div>
    </div>
  );
}
