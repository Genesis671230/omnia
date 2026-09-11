"use client";

/* Month-by-month, spreadsheet-style. Two cuts:

   By order month — a month owns the orders PLACED in it. "Gross sales" is
   every order that month; "Net (paid)" is the after-fee amount for that
   month's orders whose payout is confirmed; "Awaiting" is the rest, which
   becomes net once the payout lands. A July order paid in an early-August
   payout does NOT show in August — its order date is July.

   By payout month — a month owns the cash that SETTLED in it. "Carried in"
   is how much of that cash was actually for earlier-month orders (the
   amount you'd subtract to get back to the month's own sales).

   Pure over the row set the API already returned (computeMonthlyRollup in
   lib/finance/payments-sheet-insights.ts). Follows the panel's date filter.
   "CSV" drops the current view into Excel / Google Sheets. */

import { useMemo, useState } from "react";
import { AlertTriangle, Download } from "lucide-react";
import {
  computeMonthlyRollup, computePaymentDateAudit, type MonthlyRollupRow, type PaymentSheetRow,
} from "@/lib/finance/payments-sheet-insights";

const AED2 = new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const aed2 = (n: number) => AED2.format(n);

type Basis = "order" | "payment";

type Col = { key: string; label: string; get: (m: MonthlyRollupRow) => string; tone?: string };

const ORDER_COLS: Col[] = [
  { key: "label", label: "Month", get: (m) => m.label },
  { key: "orderCount", label: "Orders", get: (m) => String(m.orderCount) },
  { key: "grossAed", label: "Gross sales", get: (m) => `AED ${aed2(m.grossAed)}` },
  { key: "netAed", label: "Net (paid)", get: (m) => `AED ${aed2(m.netAed)}`, tone: "#15803D" },
  { key: "awaitingAed", label: "Awaiting payout", get: (m) => `AED ${aed2(m.awaitingAed)}`, tone: "#B45309" },
  { key: "feesAed", label: "Fees", get: (m) => `AED ${aed2(m.feesAed)}`, tone: "#8A8175" },
  { key: "feePercent", label: "Fee %", get: (m) => (m.feePercent == null ? "—" : `${m.feePercent}%`), tone: "#8A8175" },
];

const PAYMENT_COLS: Col[] = [
  { key: "label", label: "Payout month", get: (m) => m.label },
  { key: "receivedCount", label: "Payouts", get: (m) => String(m.receivedCount) },
  { key: "receivedAed", label: "Received", get: (m) => `AED ${aed2(m.receivedAed)}` },
  { key: "crossMonthInAed", label: "Carried from earlier", get: (m) => `AED ${aed2(m.crossMonthInAed)}`, tone: "#7C3AED" },
  { key: "netAed", label: "Net", get: (m) => `AED ${aed2(m.netAed)}`, tone: "#15803D" },
  { key: "feesAed", label: "Fees", get: (m) => `AED ${aed2(m.feesAed)}`, tone: "#8A8175" },
  { key: "feePercent", label: "Fee %", get: (m) => (m.feePercent == null ? "—" : `${m.feePercent}%`), tone: "#8A8175" },
];

export function SheetMonthlyTable({
  rows,
  from = null,
  to = null,
}: {
  rows: PaymentSheetRow[];
  from?: string | null;
  to?: string | null;
}) {
  const [basis, setBasis] = useState<Basis>("order");

  const months = useMemo(
    () => computeMonthlyRollup(rows, { from, to, basis }),
    [rows, from, to, basis],
  );
  const audit = useMemo(() => computePaymentDateAudit(rows), [rows]);

  const cols = basis === "order" ? ORDER_COLS : PAYMENT_COLS;

  const totals = useMemo(() => {
    const t = months.reduce(
      (acc, m) => ({
        orderCount: acc.orderCount + m.orderCount,
        receivedCount: acc.receivedCount + m.receivedCount,
        grossAed: acc.grossAed + m.grossAed,
        paidGrossAed: acc.paidGrossAed + m.paidGrossAed,
        netAed: acc.netAed + m.netAed,
        feesAed: acc.feesAed + m.feesAed,
        awaitingAed: acc.awaitingAed + m.awaitingAed,
        receivedAed: acc.receivedAed + m.receivedAed,
        crossMonthInAed: acc.crossMonthInAed + m.crossMonthInAed,
      }),
      { orderCount: 0, receivedCount: 0, grossAed: 0, paidGrossAed: 0, netAed: 0, feesAed: 0, awaitingAed: 0, receivedAed: 0, crossMonthInAed: 0 },
    );
    return { ...t, feePercent: t.paidGrossAed > 0 ? +((t.feesAed / t.paidGrossAed) * 100).toFixed(2) : null };
  }, [months]);

  const totalCell = (key: string): string => {
    switch (key) {
      case "label": return "Total";
      case "orderCount": return String(totals.orderCount);
      case "receivedCount": return String(totals.receivedCount);
      case "grossAed": return `AED ${aed2(totals.grossAed)}`;
      case "netAed": return `AED ${aed2(totals.netAed)}`;
      case "awaitingAed": return `AED ${aed2(totals.awaitingAed)}`;
      case "receivedAed": return `AED ${aed2(totals.receivedAed)}`;
      case "crossMonthInAed": return `AED ${aed2(totals.crossMonthInAed)}`;
      case "feesAed": return `AED ${aed2(totals.feesAed)}`;
      case "feePercent": return totals.feePercent == null ? "—" : `${totals.feePercent}%`;
      default: return "";
    }
  };

  const downloadCsv = () => {
    const rowsOut = [
      cols.map((c) => c.label),
      ...months.map((m) => cols.map((c) => c.get(m).replace(/^AED /, ""))),
      cols.map((c) => totalCell(c.key).replace(/^AED /, "")),
    ];
    const csv = rowsOut.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    const range = from || to ? `_${from ?? "start"}_${to ?? "end"}` : "";
    a.href = url;
    a.download = `monthly-${basis}${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-2">
      {audit.count > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-[#FBBF24]/40 bg-[#FFFBEB] px-3.5 py-2.5 text-[12px] text-[#92400E]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">{audit.count} verified payment{audit.count === 1 ? "" : "s"} (AED {aed2(audit.amountAed)}) have no readable settlement date.</span>{" "}
            They can't be placed in a payout month — fix the "Payment Received on …" note in the sheet.
            {" "}
            {audit.rows.slice(0, 6).map((r) => r.orderNumber ?? `row ${r.rowNumber}`).join(", ")}
            {audit.rows.length > 6 ? `, +${audit.rows.length - 6} more` : ""}.
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-[#DBEAFE] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DBEAFE] bg-[#F8FAFF] px-4 py-3">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[#64748B]">Monthly breakdown</div>
            <div className="mt-0.5 text-[11px] text-[#94A3B8]">
              {basis === "order"
                ? "Gross & net by the month each order was placed"
                : "Cash by the month it settled, with the earlier-month portion split out"}
              {from || to ? ` · ${from ?? "start"} → ${to ?? "end"}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex gap-1 rounded-lg border border-[#BFDBFE] bg-white p-0.5">
              {(["order", "payment"] as Basis[]).map((b) => (
                <button
                  key={b}
                  onClick={() => setBasis(b)}
                  className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                    basis === b ? "bg-[#2563EB] text-white" : "text-[#64748B] hover:text-[#0F172A]"
                  }`}
                >
                  {b === "order" ? "By order month" : "By payout month"}
                </button>
              ))}
            </div>
            <button
              onClick={downloadCsv}
              disabled={months.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#BFDBFE] px-2.5 py-1.5 text-[11.5px] font-medium text-[#1D4ED8] hover:bg-[#DBEAFE] disabled:opacity-40"
            >
              <Download size={13} /> CSV
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-[#F8FAFF]">
                {cols.map((c, i) => (
                  <th
                    key={c.key}
                    className={`px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-[#64748B] ${i === 0 ? "text-left" : "text-right"}`}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.length === 0 ? (
                <tr><td colSpan={cols.length} className="h-20 text-center text-[13px] text-[#94A3B8]">No data in this range.</td></tr>
              ) : (
                months.map((m) => (
                  <tr key={m.monthKey} className="border-t border-[#EFF6FF] hover:bg-[#F8FAFF]">
                    {cols.map((c, i) => (
                      <td
                        key={c.key}
                        className={`px-3 py-2.5 tabular-nums ${i === 0 ? "font-medium text-[#0F172A]" : "text-right font-mono"}`}
                        style={i === 0 ? undefined : { color: c.tone ?? "#0F172A" }}
                      >
                        {c.get(m)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {months.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-[#DBEAFE] bg-[#F8FAFF]">
                  {cols.map((c, i) => (
                    <td
                      key={c.key}
                      className={`px-3 py-2.5 font-semibold tabular-nums ${i === 0 ? "text-[#0F172A]" : "text-right font-mono"}`}
                      style={i === 0 ? undefined : { color: c.tone ?? "#0F172A" }}
                    >
                      {totalCell(c.key)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
