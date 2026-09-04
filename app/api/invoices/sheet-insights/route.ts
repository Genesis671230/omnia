// GET /api/invoices/sheet-insights?spreadsheetId=<id-or-full-url>&from=&to=
//
// Standalone stats off the payments sheet — total received, pending,
// exchange, cancelled/returned, cut by today/yesterday/this week/this
// month/all time, plus a gateway breakdown (country-aware: "Tabby KSA" vs
// "Tabby UAE" — see lib/finance/payments-sheet.ts for how the region tag is
// derived) over an optional [from, to] window. Deliberately Zoho-free: this
// must stay usable when Zoho is rate limited (see the fallback in
// ../sheet-matches/route.ts), and it's also what powers "paste a sheet
// URL" — pass a different spreadsheetId (or a full Google Sheets URL,
// extracted server-side) to read a different copy of this same SMSA
// Orders / Local orders layout.
//
// Also returns the full row set (id-light: no raw sheet text beyond what's
// needed to display) so the client can re-run the exact same gateway
// breakdown locally for instant filtering — see
// lib/finance/payments-sheet-insights.ts, imported identically on both
// sides so the numbers can never drift between server and client.

import { NextRequest, NextResponse } from "next/server";
import {
  computeGatewayBreakdown, computeSheetInsights, extractSpreadsheetId,
  paymentsSheetConfigured, readAllPaymentRows,
} from "@/lib/finance/payments-sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const rawId = p.get("spreadsheetId");
  const from = p.get("from") || null;
  const to = p.get("to") || null;

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    return NextResponse.json({ error: "Google Sheets not configured — set GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY" }, { status: 503 });
  }

  let spreadsheetId: string;
  if (rawId) {
    const extracted = extractSpreadsheetId(rawId);
    if (!extracted) return NextResponse.json({ error: "Couldn't find a spreadsheet id in that URL" }, { status: 400 });
    spreadsheetId = extracted;
  } else {
    if (!paymentsSheetConfigured()) {
      return NextResponse.json({ error: "No spreadsheetId given and no default payments sheet configured" }, { status: 503 });
    }
    spreadsheetId = process.env.GOOGLE_SHEETS_PAYMENTS_SPREADSHEET_ID!;
  }

  try {
    const rows = await readAllPaymentRows(spreadsheetId);
    const insights = computeSheetInsights(rows, spreadsheetId);
    const gatewayBreakdown = computeGatewayBreakdown(rows, from, to);
    return NextResponse.json({ ...insights, gatewayBreakdown, rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
