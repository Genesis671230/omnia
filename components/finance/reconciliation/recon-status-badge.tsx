"use client";

/* Status is always color + icon + text — never color alone. */

import { AlertOctagon, CheckCircle2, Clock, Scale } from "lucide-react";
import { matchKind, type MatchKind } from "@/lib/reconciliation/match-status";
import { aed2, type ReconLine } from "./types";

export const MATCH_META: Record<MatchKind, { label: string; Icon: typeof Clock; cls: string; dot: string }> = {
  matched: { label: "Matched", Icon: CheckCircle2, cls: "text-[#1F7A4D] ring-[#CFE6D8]", dot: "#1F9D5C" },
  force: { label: "Matched with difference", Icon: Scale, cls: "text-[#8A5A12] ring-[#EBDDBF]", dot: "#C68A1E" },
  exception: { label: "To check", Icon: AlertOctagon, cls: "text-[#B42318] ring-[#F2D3CF]", dot: "#D92D20" },
  awaiting: { label: "Needs payout file", Icon: Clock, cls: "text-[#4A5263] ring-[#E3E7F0]", dot: "#9AA1B0" },
};

export function MatchStatusBadge({ line }: { line: ReconLine }) {
  const { kind, gap } = matchKind({ ...line, forceBook: line.forceBook ?? null });
  const m = MATCH_META[kind];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[4px] bg-white px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset ${m.cls}`}>
      <i className="h-1.5 w-1.5 rounded-full" style={{ background: m.dot }} aria-hidden />
      {m.label}
      {(kind === "force" || kind === "exception") && Math.abs(gap) >= 0.01 && (
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
        <span className="inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium text-[#8A5A12] ring-1 ring-inset ring-[#EBDDBF]" title={line.reviewNote || "Flagged for review"}>
          Flagged
        </span>
      )}
      {posted && (
        <span className="inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium text-[#0B1533] ring-1 ring-inset ring-[#D9DEE8]">
          In Zoho
        </span>
      )}
    </span>
  );
}
