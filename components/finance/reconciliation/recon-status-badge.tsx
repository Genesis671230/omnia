"use client";

/* Status is always color + icon + text — never color alone. */

import { AlertOctagon, BookCheck, CheckCircle2, Clock, Flag, Scale } from "lucide-react";
import { matchKind, type MatchKind } from "@/lib/reconciliation/match-status";
import { aed2, type ReconLine } from "./types";

export const MATCH_META: Record<MatchKind, { label: string; Icon: typeof Clock; cls: string; dot: string }> = {
  matched: { label: "Matched", Icon: CheckCircle2, cls: "bg-[#EEF6EF] text-[#2F6B3B] ring-[#CFE5D3]", dot: "#2F6B3B" },
  force: { label: "Force matched", Icon: Scale, cls: "bg-[#FDF4E4] text-[#8A5A12] ring-[#F0DDB8]", dot: "#B7791F" },
  exception: { label: "Exception", Icon: AlertOctagon, cls: "bg-[#FBECE8] text-[#9B3A24] ring-[#F1CFC6]", dot: "#9B3A24" },
  awaiting: { label: "Awaiting payout", Icon: Clock, cls: "bg-[#EAF2F6] text-[#2B5F74] ring-[#CFE1EA]", dot: "#2B5F74" },
};

export function MatchStatusBadge({ line }: { line: ReconLine }) {
  const { kind, gap } = matchKind({ ...line, forceBook: line.forceBook ?? null });
  const m = MATCH_META[kind];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset ${m.cls}`}>
      <m.Icon size={12} aria-hidden />
      {m.label}
      {kind === "force" && Math.abs(gap) >= 0.01 && (
        <span className="font-mono tabular-nums opacity-80">· {gap > 0 ? "+" : "−"}{aed2(Math.abs(gap))}</span>
      )}
    </span>
  );
}

export function RowTags({ line, posted }: { line: ReconLine; posted: boolean }) {
  if (!line.reviewFlag && !posted) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {line.reviewFlag && (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#FDF4E4] px-1.5 py-0.5 text-[10.5px] font-medium text-[#8A5A12]" title={line.reviewNote || "Flagged for review"}>
          <Flag size={10} aria-hidden /> Flagged
        </span>
      )}
      {posted && (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#F3EFE7] px-1.5 py-0.5 text-[10.5px] font-medium text-[#6F5325]">
          <BookCheck size={10} aria-hidden /> In Zoho
        </span>
      )}
    </span>
  );
}
