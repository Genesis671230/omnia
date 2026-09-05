import { NextRequest, NextResponse } from "next/server";
import { PaymentSheetMonthsRepository } from "@/lib/repositories/payment-sheet-months.repository";
import { extractSpreadsheetId } from "@/lib/finance/payments-sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const months = await PaymentSheetMonthsRepository.list();
  return NextResponse.json({ months });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const monthKey = String(body.monthKey || "");
  const label = String(body.label || "");
  const rawUrl = String(body.spreadsheetUrlOrId || "");
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    return NextResponse.json({ error: "monthKey must look like YYYY-MM, e.g. 2026-09" }, { status: 400 });
  }
  const spreadsheetId = extractSpreadsheetId(rawUrl);
  if (!spreadsheetId) {
    return NextResponse.json({ error: "Couldn't find a spreadsheet id in that URL" }, { status: 400 });
  }
  await PaymentSheetMonthsRepository.upsert(monthKey, spreadsheetId, label || monthKey);
  return NextResponse.json({ ok: true });
}
