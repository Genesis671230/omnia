// GET /api/invoices/sheet-exchanges?spreadsheetId=&from=&to=
//
// Exchange rows from the payments sheet (see lib/finance/payments-sheet.ts
// for how "exchange" is detected — the "Part"/"Type of Sale" column, not
// Party), joined to each order's line_items from Supabase so Finance can
// see exactly which SKUs were exchanged. Supabase-only join — no Zoho — so
// this stays available when Zoho is rate limited, same as sheet-insights.

import { NextRequest, NextResponse } from "next/server";
import {
  extractSpreadsheetId, joinExchangeLineItems, listExchangeRows,
  readPaymentRowsScoped,
} from "@/lib/finance/payments-sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const rawId = p.get("spreadsheetId");
  const from = p.get("from") || null;
  const to = p.get("to") || null;

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    return NextResponse.json({ error: "Google Sheets not configured" }, { status: 503 });
  }

  // Same rule as sheet-insights: no explicit id means every registered
  // month, not just whichever single sheet the env var is pinned to.
  let explicitId: string | null = null;
  if (rawId) {
    const extracted = extractSpreadsheetId(rawId);
    if (!extracted) return NextResponse.json({ error: "Couldn't find a spreadsheet id in that URL" }, { status: 400 });
    explicitId = extracted;
  }

  try {
    const { rows } = await readPaymentRowsScoped(explicitId);
    const exchangeRows = listExchangeRows(rows, from, to);
    const exchanges = await joinExchangeLineItems(exchangeRows);
    return NextResponse.json({ exchanges });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
