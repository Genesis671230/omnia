"use client";

/* Month-close reconciliation statement — the founder's own model.

   For the picked month M, every order PLACED in M ("dispatched sales") is
   settled within M, settled in a later month (still M's sales, collected
   later — a subtraction line, not "net sales"), or still awaiting a payout.
   The cash that actually LANDED in M is M's own orders settled in M plus
   earlier-month orders whose payout landed in M. Every figure is split
   International (SMSA tab) vs Local.

   "Carried in from earlier" only fills in when the previous month's sheet
   is also in the data — on the founder dashboard that means registering it
   in Settings; in the Invoices Workbench, paste a workbook that spans both.

   Pure over the row set the API already returned
   (computeMonthlyReconciliation in lib/finance/payments-sheet-insights.ts). */

import { useMemo, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import {
  computeMonthlyReconciliation, type MonthReconciliation, type ReconSplit, type PaymentSheetRow,
} from "@/lib/finance/payments-sheet-insights";

const AED2 = new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const aed2 = (n: number) => AED2.format(n);
const signed = (n: number) => (n < 0 ? `(${aed2(-n)})` : aed2(n));

type LineTone = "plain" | "sub" | "add" | "total" | "grand" | "memo";
type Line = {
  label: string;
  indent?: number;
  split: ReconSplit | { intlAed: number; localAed: number; totalAed: number };
  tone?: LineTone;
  sub?: { label: string; split: ReconSplit }[];
};

function toneClass(tone: LineTone | undefined): string {
  switch (tone) {
    case "sub": return "text-[#B91C1C]";
    case "add": return "text-[#7C3AED]";
    case "total": return "font-semibold text-[#0F172A]";
    case "grand": return "font-semibold text-[#15803D]";
    case "memo": return "text-[#94A3B8]";
    default: return "text-[#0F172A]";
  }
}

export function SheetMonthReconciliation({
  rows,
  from = null,
  to = null,
}: {
  rows: PaymentSheetRow[];
  from?: string | null;
  to?: string | null;
}) {
  const months = useMemo(() => computeMonthlyReconciliation(rows, { from, to }), [rows, from, to]);
  const keys = months.map((m) => m.monthKey);
  const [picked, setPicked] = useState<string>("");

  useEffect(() => {
    if (keys.length && !keys.includes(picked)) setPicked(keys[keys.length - 1]);
  }, [keys.join(","), picked]);

  const m = months.find((x) => x.monthKey === picked) ?? months[months.length - 1];
  const idx = m ? keys.indexOf(m.monthKey) : -1;

  if (!m) {
    return (
      <div className="rounded-2xl border border-[#DBEAFE] bg-white p-8 text-center text-[13px] text-[#94A3B8] shadow-sm">
        No orders with a readable date in this range.
      </div>
    );
  }

  const settledWithin = m.settledWithin;
  const cashFromOwn = settledWithin; // M's own orders settled in M
  const neg = (s: ReconSplit) => ({ intlAed: -s.intlAed, localAed: -s.localAed, totalAed: -s.totalAed });

  const lines: Line[] = [
    { label: `Dispatched sales — orders placed in ${m.label}`, split: m.dispatched, tone: "total" },
    { label: "settled within the month", indent: 1, split: settledWithin },
    {
      label: "settled in a later month", indent: 1, split: neg(m.settledLater), tone: "sub",
      sub: m.settledLater.byMonth.map((b) => ({ label: b.label, split: b })),
    },
    ...(m.awaiting.totalAed > 0
      ? [{ label: "still awaiting a payout", indent: 1, split: m.awaiting, tone: "memo" as LineTone }]
      : []),
    ...(m.unreadableSettlement.totalAed > 0
      ? [{ label: "received — settlement date unreadable", indent: 1, split: m.unreadableSettlement, tone: "memo" as LineTone }]
      : []),
    { label: `Cash from ${m.label}'s own orders`, split: cashFromOwn, tone: "total" },
    {
      label: "carried in from earlier months", indent: 1, split: m.carriedIn, tone: "add",
      sub: m.carriedIn.byMonth.map((b) => ({ label: b.label, split: b })),
    },
    { label: `Total cash received in ${m.label}`, split: m.cashReceived, tone: "grand" },
  ];

  const csv = () => {
    const header = ["Line", "International", "Local", "Total"];
    const body: (string | number)[][] = [
      ["Dispatched sales", m.dispatched.intlAed, m.dispatched.localAed, m.dispatched.totalAed],
      ["  settled within the month", settledWithin.intlAed, settledWithin.localAed, settledWithin.totalAed],
      ["  settled in a later month", -m.settledLater.intlAed, -m.settledLater.localAed, -m.settledLater.totalAed],
      ...m.settledLater.byMonth.map((b) => [`    ${b.label}`, b.intlAed, b.localAed, b.totalAed]),
      ["  still awaiting a payout", m.awaiting.intlAed, m.awaiting.localAed, m.awaiting.totalAed],
      ["  received — settlement date unreadable", m.unreadableSettlement.intlAed, m.unreadableSettlement.localAed, m.unreadableSettlement.totalAed],
      [`Cash from ${m.label}'s own orders`, settledWithin.intlAed, settledWithin.localAed, settledWithin.totalAed],
      ["  carried in from earlier months", m.carriedIn.intlAed, m.carriedIn.localAed, m.carriedIn.totalAed],
      ...m.carriedIn.byMonth.map((b) => [`    ${b.label}`, b.intlAed, b.localAed, b.totalAed]),
      [`Total cash received in ${m.label}`, m.cashReceived.intlAed, m.cashReceived.localAed, m.cashReceived.totalAed],
      ["less gateway fees", "", "", -m.cashReceivedFeesAed],
      [`Net cash received in ${m.label}`, "", "", m.cashReceivedNetAed],
      ["memo: cancelled / refunded on this month's orders", "", "", m.cancelledAed],
    ];
    const out = [header, ...body]
      .map((r) => r.map((c) => `"${String(typeof c === "number" ? c.toFixed(2) : c).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([out], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `reconciliation-${m.monthKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-[#DBEAFE] bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DBEAFE] bg-[#F8FAFF] px-4 py-3">
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[#64748B]">Month-close reconciliation</div>
          <div className="mt-0.5 text-[11px] text-[#94A3B8]">Dispatched sales → cash actually received, split International / Local</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => idx > 0 && setPicked(keys[idx - 1])}
            disabled={idx <= 0}
            className="rounded-md border border-[#BFDBFE] p-1 text-[#1D4ED8] hover:bg-[#DBEAFE] disabled:opacity-30"
          >
            <ChevronLeft size={14} />
          </button>
          <select
            value={m.monthKey}
            onChange={(e) => setPicked(e.target.value)}
            className="h-8 rounded-md border border-[#BFDBFE] bg-white px-2 text-[12.5px] font-medium text-[#0F172A]"
          >
            {months.map((x) => <option key={x.monthKey} value={x.monthKey}>{x.label}</option>)}
          </select>
          <button
            onClick={() => idx < keys.length - 1 && setPicked(keys[idx + 1])}
            disabled={idx >= keys.length - 1}
            className="rounded-md border border-[#BFDBFE] p-1 text-[#1D4ED8] hover:bg-[#DBEAFE] disabled:opacity-30"
          >
            <ChevronRight size={14} />
          </button>
          <button
            onClick={csv}
            className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-[#BFDBFE] px-2.5 py-1.5 text-[11.5px] font-medium text-[#1D4ED8] hover:bg-[#DBEAFE]"
          >
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-[#F8FAFF] text-[10.5px] uppercase tracking-wider text-[#64748B]">
              <th className="px-4 py-2 text-left font-semibold">Line</th>
              <th className="px-3 py-2 text-right font-semibold">International</th>
              <th className="px-3 py-2 text-right font-semibold">Local</th>
              <th className="px-4 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((ln, i) => (
              <ReconRows key={i} line={ln} />
            ))}
            <tr className="border-t border-[#EFF6FF]">
              <td className="px-4 py-2 pl-8 text-[#B91C1C]">less gateway fees</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
              <td className="px-4 py-2 text-right font-mono tabular-nums text-[#B91C1C]">({aed2(m.cashReceivedFeesAed)})</td>
            </tr>
            <tr className="border-t border-[#EFF6FF] bg-[#F0FDF4]">
              <td className="px-4 py-2.5 font-semibold text-[#15803D]">Net cash received in {m.label}</td>
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5" />
              <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-[#15803D]">AED {aed2(m.cashReceivedNetAed)}</td>
            </tr>
            {m.cancelledAed > 0 && (
              <tr className="border-t border-[#EFF6FF]">
                <td className="px-4 py-2 text-[#94A3B8]">memo: cancelled / refunded on {m.label} orders</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                <td className="px-4 py-2 text-right font-mono tabular-nums text-[#94A3B8]">AED {aed2(m.cancelledAed)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReconRows({ line }: { line: Line }) {
  const pad = line.indent ? "pl-10" : "pl-4";
  return (
    <>
      <tr className={`border-t border-[#EFF6FF] ${line.tone === "total" || line.tone === "grand" ? "bg-[#F8FAFF]" : ""}`}>
        <td className={`px-4 py-2 ${pad} ${toneClass(line.tone)}`}>{line.label}</td>
        <td className={`px-3 py-2 text-right font-mono tabular-nums ${toneClass(line.tone)}`}>{signed(line.split.intlAed)}</td>
        <td className={`px-3 py-2 text-right font-mono tabular-nums ${toneClass(line.tone)}`}>{signed(line.split.localAed)}</td>
        <td className={`px-4 py-2 text-right font-mono tabular-nums ${toneClass(line.tone)}`}>{signed(line.split.totalAed)}</td>
      </tr>
      {line.sub?.map((s, i) => (
        <tr key={i} className="text-[11.5px] text-[#94A3B8]">
          <td className="px-4 py-1 pl-14">{s.label}</td>
          <td className="px-3 py-1 text-right font-mono tabular-nums">{aed2(s.split.intlAed)}</td>
          <td className="px-3 py-1 text-right font-mono tabular-nums">{aed2(s.split.localAed)}</td>
          <td className="px-4 py-1 text-right font-mono tabular-nums">{aed2(s.split.totalAed)}</td>
        </tr>
      ))}
    </>
  );
}
