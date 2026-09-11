import { NextResponse } from "next/server";
import { computeGatewayBreakdown, computeSheetInsights, readAllPaymentRowsAllMonths } from "@/lib/finance/payments-sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/dashboard/payments-sheet-full — the full row set aggregated
// across every month registered in payment_sheet_months (Settings), so the
// dashboard's trend chart / period cards / gateway table can recompute
// locally over any date range the same way sheet-insights-strip.tsx already
// does for a single sheet (lib/finance/payments-sheet-insights.ts, run
// identically on both sides). Distinct from /api/dashboard/payments-insights
// (fixed period buckets only, no rows) — this route exists specifically to
// give the client the raw rows a date-range picker needs.
export async function GET() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    return NextResponse.json({ error: "Google Sheets not configured" }, { status: 503 });
  }
  try {
    const { months, rows } = await readAllPaymentRowsAllMonths();
    if (months.length === 0) {
      return NextResponse.json({ error: "No months registered — add one in Settings first" }, { status: 503 });
    }
    const insights = computeSheetInsights(rows, months.map((m) => m.spreadsheetId).join(","));
    const gatewayBreakdown = computeGatewayBreakdown(rows, null, null);
    return NextResponse.json({
      ...insights,
      gatewayBreakdown,
      rows,
      months: months.map((m) => ({ monthKey: m.monthKey, label: m.label, spreadsheetId: m.spreadsheetId })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
