import { NextResponse } from "next/server";
import { runReconciliation } from "@/lib/reconciliation/engine";

// GET /api/reconcile/export?from=YYYY-MM-DD&to=YYYY-MM-DD — the full bank →
// payout → orders chain as a CSV, one row per bank credit. Every column the
// reconciliation UI shows (plus the FX rate actually used, and its source)
// so a founder can trace any transaction end to end outside the app.
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

  const allLines = await runReconciliation();
  const lines = (from || to) ? allLines.filter((l) => inRange(l.date, from, to)) : allLines;

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
  const rangeSuffix = from || to ? `-${from ?? "start"}_${to ?? "end"}` : "";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="omnia-reconciliation${rangeSuffix}.csv"`,
    },
  });
}
