import { NextResponse } from "next/server";
import { buildAdminMoney } from "@/lib/dashboard/admin-money.service";
import { dubaiToday } from "@/lib/dubai-day";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/dashboard/admin-money?from=2026-10-01&to=2026-10-13[&fresh=1]
//
// The Admin tab: sales → fee, VAT, deductions, net payout, FX, net received
// and awaiting, by day, by gateway and per order — one calculation for all
// (lib/dashboard/admin-money). Defaults to this month so far. Read-only.
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const today = dubaiToday();
  const from = p.get("from") || `${today.slice(0, 7)}-01`;
  const to = p.get("to") || today;
  try {
    return NextResponse.json(await buildAdminMoney(from, to, { fresh: p.get("fresh") === "1" }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
