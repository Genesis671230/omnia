"use client";

import { ChevronDown } from "lucide-react";
import { gatewayColor, STATE_COLORS } from "./colors";
import { aed2, type ReconLine } from "./types";
import type { GroupMode, ReconGroup } from "@/lib/reconciliation/filters";

/* A group header answers three questions before the rows are opened: how much
 * money is in here, how many credits, and how much of it is in trouble.
 *
 * The split bar carries a 2px surface gap between segments (per mark specs) so
 * adjacent fills stay separable, and every segment is also written out as a
 * labelled number below — the bar is the glance, the numbers are the truth. */

function SplitBar({ settled, awaiting, exception, total }: {
  settled: number; awaiting: number; exception: number; total: number;
}) {
  if (total <= 0) return null;
  const seg = [
    { v: settled, c: STATE_COLORS.SETTLED, label: "settled" },
    { v: awaiting, c: STATE_COLORS.AWAITING_PAYOUT, label: "awaiting" },
    { v: exception, c: STATE_COLORS.PAYOUT_VARIANCE, label: "exception" },
  ].filter((s) => s.v > 0);

  return (
    <div className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full bg-[#F3EFE7]">
      {seg.map((s) => (
        <div
          key={s.label}
          className="h-full rounded-full first:rounded-l-full last:rounded-r-full"
          style={{ width: `${(s.v / total) * 100}%`, background: s.c }}
          title={`${s.label}: ${aed2(s.v)}`}
        />
      ))}
    </div>
  );
}

export function ReconGroupHeader({ group, mode, open, onToggle }: {
  group: ReconGroup<ReconLine>;
  mode: GroupMode;
  open: boolean;
  onToggle: () => void;
}) {
  const color = mode === "gateway" ? gatewayColor(group.key) : "#B08343";
  const pct = group.total > 0 ? Math.round((group.settled / group.total) * 100) : 0;

  return (
    <button
      onClick={onToggle}
      className="group flex w-full items-center gap-3 rounded-xl border border-[#EAE3D6] bg-white px-4 py-3 text-left shadow-sm transition-shadow hover:shadow-md"
    >
      <span className="h-8 w-1.5 flex-shrink-0 rounded-full" style={{ background: color }} aria-hidden />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[14px] font-semibold text-[#1F1B16]">{group.label}</span>
          <span className="text-[12px] text-[#8A8175]">
            {group.count} credit{group.count === 1 ? "" : "s"}
          </span>
          <span className="font-serif text-[15px] text-[#1F1B16] tabular-nums">{aed2(group.total)}</span>
          <span className="text-[12px] text-[#8A8175]">{pct}% settled</span>
        </div>

        <div className="mt-2 max-w-lg">
          <SplitBar settled={group.settled} awaiting={group.awaiting} exception={group.exception} total={group.total} />
        </div>

        {/* Direct labels: the bar's segments are under 3:1 on white at this
            height, so the numbers must be readable without decoding color. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-[#8A8175]">
          {group.settled > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2 w-2 rounded-full" style={{ background: STATE_COLORS.SETTLED }} />
              settled {aed2(group.settled)}
            </span>
          )}
          {group.awaiting > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2 w-2 rounded-full" style={{ background: STATE_COLORS.AWAITING_PAYOUT }} />
              awaiting {aed2(group.awaiting)}
            </span>
          )}
          {group.exception > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2 w-2 rounded-full" style={{ background: STATE_COLORS.PAYOUT_VARIANCE }} />
              exception {aed2(group.exception)}
            </span>
          )}
        </div>
      </div>

      <ChevronDown
        size={18}
        className="flex-shrink-0 text-[#8A8175] transition-transform"
        style={{ transform: open ? "rotate(180deg)" : "none" }}
      />
    </button>
  );
}
