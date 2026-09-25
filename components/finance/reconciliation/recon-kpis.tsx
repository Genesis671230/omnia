"use client";

/* KPI strip. Totals cover the rows in view (gateway + search + date filters,
 * every status). The arrow compares the latest bank day with the day before it,
 * as color + icon + text; for exceptions and variance, up is bad. */

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { dayKpis } from "@/lib/reconciliation/match-status";
import { aed2, type ReconLine } from "./types";

type Key = "credits" | "aed" | "pctSettled" | "exceptions" | "variance";

const CARDS: { key: Key; label: string; upIsGood: boolean; fmt: (n: number) => string }[] = [
  { key: "credits", label: "Credits", upIsGood: true, fmt: (n) => n.toLocaleString("en-US") },
  { key: "aed", label: "Total AED", upIsGood: true, fmt: (n) => aed2(n) },
  { key: "pctSettled", label: "Settled", upIsGood: true, fmt: (n) => `${n.toFixed(1)}%` },
  { key: "exceptions", label: "Open exceptions", upIsGood: false, fmt: (n) => n.toLocaleString("en-US") },
  { key: "variance", label: "Total variance", upIsGood: false, fmt: (n) => aed2(n) },
];

const shortDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function Trend({ now, prev, upIsGood, fmt, prevDay }: { now: number; prev: number; upIsGood: boolean; fmt: (n: number) => string; prevDay: string }) {
  const diff = now - prev;
  if (Math.abs(diff) < 0.005) {
    return <span className="inline-flex items-center gap-1 text-[11px] text-[#8A8175]"><Minus size={11} aria-hidden /> same as {shortDay(prevDay)}</span>;
  }
  const up = diff > 0;
  const good = up === upIsGood;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${good ? "text-[#2F6B3B]" : "text-[#9B3A24]"}`}>
      <Icon size={12} aria-hidden />
      {up ? "up" : "down"} {fmt(Math.abs(diff))} vs {shortDay(prevDay)}
    </span>
  );
}

export function ReconKpis({ lines, loading }: { lines: ReconLine[]; loading: boolean }) {
  const toKpi = (ls: ReconLine[]) => dayKpis(ls.map((l) => ({ ...l, forceBook: l.forceBook ?? null })));
  const total = toKpi(lines);
  const days = [...new Set(lines.map((l) => l.date?.slice(0, 10)).filter((d): d is string => !!d))].sort().reverse();
  const today = days[0] ? toKpi(lines.filter((l) => l.date?.startsWith(days[0]))) : null;
  const prior = days[1] ? toKpi(lines.filter((l) => l.date?.startsWith(days[1]))) : null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {CARDS.map((c) => (
        <div key={c.key} className="rounded-xl border border-[#EAE3D6] bg-white px-3.5 py-2.5">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#8A8175]">{c.label}</div>
          {loading ? (
            <div className="mt-2 h-5 w-2/3 animate-pulse rounded bg-[#EFE9DD]" />
          ) : (
            <>
              <div className={`mt-0.5 font-mono text-[18px] font-semibold tabular-nums ${c.key === "exceptions" && total.exceptions > 0 ? "text-[#9B3A24]" : "text-[#1F1B16]"}`}>
                {c.fmt(total[c.key])}
              </div>
              <div className="h-4">
                {today && prior && days[1] && (
                  <Trend now={today[c.key]} prev={prior[c.key]} upIsGood={c.upIsGood} fmt={c.fmt} prevDay={days[1]} />
                )}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
