import { NextResponse } from "next/server";
import { buildSalesLedger } from "@/lib/orders/sales-ledger.service";
import { dubaiToday } from "@/lib/dubai-day";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/orders/sales-ledger?month=2026-09
//
// One month of paid orders by Dubai day, each traced to the payout file line
// that paid it (fee + net) and the bank credit that landed it, with a plain
// reason whenever the money isn't in yet ("Tabby payout file not uploaded
// yet"). Day totals match /api/orders/gross-sales exactly.
export async function GET(req: Request) {
  const raw = (new URL(req.url).searchParams.get("month") || "").trim();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : dubaiToday().slice(0, 7);
  try {
    return NextResponse.json(await buildSalesLedger(month));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
