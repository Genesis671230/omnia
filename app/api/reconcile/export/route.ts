import { NextResponse } from "next/server";
import { getReconLines } from "@/lib/reconciliation/snapshot";
import { runReconciliation } from "@/lib/reconciliation/engine";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { buildReconciliationWorkbook, type ExportOrder } from "@/lib/reconciliation/export-xlsx";

// GET /api/reconcile/export?from=YYYY-MM-DD&to=YYYY-MM-DD[&format=xlsx]
//
// format=csv (default): the full bank → payout → orders chain as one CSV row
//   per bank credit — every column the reconciliation UI shows plus the FX
//   rate actually used and its source, so a founder can trace any transaction
//   end to end outside the app.
//
// format=xlsx: a workbook mirroring the finance team's payments Google Sheet —
//   an "SMSA Orders" tab (international), a "Local orders" tab (UAE), and a
//   "Summary" tab (one row per credit), so each order shows its gateway and
//   whether its payout has landed.
const csvCell = (v: string | number) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function inRange(date: string | null, from: string | null, to: string | null): boolean {
  if (!date) return true;
  const day = date.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const format = (url.searchParams.get("format") ?? "csv").toLowerCase();

  const allLines = (await getReconLines()).lines;
  const lines = (from || to) ? allLines.filter((l) => inRange(l.date, from, to)) : allLines;

  const rangeSuffix = from || to ? `-${from ?? "start"}_${to ?? "end"}` : "";

  if (format === "xlsx") {
    const orderNumbers = [
      ...new Set(lines.flatMap((l) => [...l.resolvedOrders, ...l.refundedOrders])),
    ];
    const details = orderNumbers.length
      ? await OrdersRepository.getDetailsByOrderNumbers(orderNumbers)
      : [];
    const orders: ExportOrder[] = (details as Record<string, unknown>[]).map((d) => ({
      order_number: String(d.order_number ?? ""),
      order_date: (d.order_date as string) ?? null,
      customer_name: (d.customer_name as string) ?? null,
      city: (d.city as string) ?? null,
      country: (d.country as string) ?? null,
      currency: (d.currency as string) ?? null,
      gross_original: d.gross_original == null ? null : Number(d.gross_original),
      gross_aed: d.gross_aed == null ? null : Number(d.gross_aed),
      gateway: (d.gateway as string) ?? null,
    }));

    const buf = await buildReconciliationWorkbook(lines, orders, { from, to });
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="omnia-reconciliation${rangeSuffix}.xlsx"`,
      },
    });
  }

  const header = [
    "Date", "Provider", "Bank Reference", "Bank Narration", "Bank Amount (AED)",
    "Payout ID", "Payout Source File", "Original Currency", "FX Rate Used", "FX Rate Source",
    "Expected Net (AED)", "Variance (AED)", "State",
    "Resolved Orders", "Refunded Orders", "Unresolved Orders", "Quality Issues",
    "Confirmed By", "Confirmed At",
  ];
  const rows = lines.map((l) => [
    l.date ? l.date.slice(0, 10) : "",
    l.provider,
    l.reference,
    l.narration,
    l.bankAmount.toFixed(2),
    l.payout?.id ?? "",
    l.payout?.source ?? "",
    l.payout?.currency ?? "AED",
    l.payout?.fxRate ?? "",
    l.payout?.fxSource === "bank" ? "Bank-quoted (narration)" : l.payout?.fxSource === "estimate" ? "Static estimate" : "",
    l.payout ? l.payout.net.toFixed(2) : "",
    l.variance.toFixed(2),
    l.state,
    l.resolvedOrders.map((o) => `#${o}`).join(" "),
    l.refundedOrders.map((o) => `#${o}`).join(" "),
    l.unresolvedRefs.map((o) => `#${o}`).join(" "),
    l.qualityIssues.map((q) => `#${q.ref}:${q.quality}`).join(" "),
    l.confirmedBy ?? "",
    l.confirmedAt ?? "",
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="omnia-reconciliation${rangeSuffix}.csv"`,
    },
  });
}
