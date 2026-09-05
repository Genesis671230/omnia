import { NextResponse } from "next/server";
import {
  bestWorstGatewayByFeePercent, computeGatewayBreakdown, computeSheetInsights,
  readAllPaymentRowsAllMonths,
} from "@/lib/finance/payments-sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/dashboard/payments-insights — the main-dashboard analytics feed:
// Gross/Net Sales, Fees, Exchanges, Refunds/Cancellations (today/this
// week/this month/all time), a per-gateway breakdown (fee, net payout),
// and best/worst gateway by fee %. Aggregates across every month
// registered in payment_sheet_months (Task 1) — no date-range param
// needed here since the periods are fixed buckets computed server-side,
// same convention as /api/invoices/sheet-insights.
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
    const feeRanking = bestWorstGatewayByFeePercent(gatewayBreakdown);
    return NextResponse.json({ ...insights, gatewayBreakdown, feeRanking, monthsIncluded: months.map((m) => m.label) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
