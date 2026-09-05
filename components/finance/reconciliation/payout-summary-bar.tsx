"use client";

import { useEffect, useState } from "react";
import { ArrowLeftRight, Banknote, Clock, Percent, RotateCcw, TrendingUp } from "lucide-react";
import { computePayoutSummary } from "@/lib/reconciliation/payout-summary";
import { aed2, type ReconLine } from "./types";

function Tile({ label, value, icon: Icon, tone, note }: {
  label: string; value: string; icon: React.ElementType; tone: string; note?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#EAE3D6] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11.5px] text-[#8A8175]">
        <Icon size={13} style={{ color: tone }} /> {label}
      </div>
      <div className="mt-1.5 font-serif text-[22px] tabular-nums" style={{ color: tone }}>{value}</div>
      {note && <div className="mt-0.5 text-[11px] text-[#8A8175]">{note}</div>}
    </div>
  );
}

// Exchanges never touch a bank account (no cash movement), so — unlike the
// other five tiles — this figure cannot come from ReconLine at all. It
// lives entirely in the Google-Sheets pathway's own exchange detection
// (lib/finance/payments-sheet.ts's isExchange), already exposed by the
// existing /api/invoices/sheet-exchanges endpoint. Fetched independently so
// a slow/failed call never blocks the five locally-computed tiles.
function useExchangeCount(): { count: number | null; loading: boolean } {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch("/api/invoices/sheet-exchanges")
      .then((r) => r.json())
      .then((d: { exchanges?: unknown[] }) => { if (alive) setCount(d.exchanges?.length ?? 0); })
      .catch(() => { if (alive) setCount(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  return { count, loading };
}

export function PayoutSummaryBar({ lines }: { lines: ReconLine[] }) {
  const totals = computePayoutSummary(lines);
  const { count: exchangeCount, loading: exchangesLoading } = useExchangeCount();

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Tile label="Gross Sales" value={aed2(totals.grossAed)} icon={TrendingUp} tone="#2E6B7A" />
      <Tile label="Net Sales" value={aed2(totals.netAed)} icon={Banknote} tone="#4B7A54" />
      <Tile label="Awaiting Payments" value={aed2(totals.awaitingAed)} icon={Clock} tone="#B0742E" />
      <Tile label="Fees" value={aed2(totals.feesAed)} icon={Percent} tone="#8A8175" />
      <Tile label="Refunds" value={aed2(totals.refundsAed)} icon={RotateCcw} tone="#A6472F" />
      <Tile
        label="Exchanges"
        value={exchangesLoading ? "…" : exchangeCount == null ? "—" : String(exchangeCount)}
        note={exchangeCount == null && !exchangesLoading ? "couldn't load" : undefined}
        icon={ArrowLeftRight} tone="#6F5325"
      />
    </div>
  );
}
