import { NextResponse } from "next/server";
import { buildGrossSalesReport } from "@/lib/orders/gross-sales.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/orders/gross-sales?days=30&store=UAE
//
// Gross Sales straight from store orders, split across the four storefronts
// and bucketed on the Dubai calendar: today, yesterday, the trailing 7 days,
// and a daily series for the chart.
//
// Deliberately separate from /api/dashboard: this answers "what did we sell"
// from the orders table alone, with no payout, settlement or reconciliation
// input, so the founder has one number that cannot drift when a gateway
// settles late. Paid orders only — see lib/orders/gross-sales.ts for why, and
// for the `excluded` block that shows what was left out.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;

  const daysRaw = parseInt(params.get("days") ?? "30", 10);
  const days = Number.isNaN(daysRaw) ? 30 : daysRaw;

  const storeRaw = (params.get("store") || "All").trim();
  const store = storeRaw.toLowerCase() === "all" ? null : storeRaw.toUpperCase();

  try {
    const report = await buildGrossSalesReport({ days, store });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
