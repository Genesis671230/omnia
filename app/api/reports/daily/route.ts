import { NextResponse } from "next/server";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";

// GET /api/reports/daily?date=YYYY-MM-DD — the settlement proof for one day:
// every order whose bank credit was confirmed that day, grouped by gateway.
// Defaults to the most recent day with any settled records.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const dates = await SettlementsRepository.listDatesWithCounts();
  const date = url.searchParams.get("date") || dates[0]?.date || new Date().toISOString().slice(0, 10);

  const records = await SettlementsRepository.listByDate(date);

  const byGateway = new Map<string, { gateway: string; count: number; gross: number }>();
  for (const r of records) {
    const g = byGateway.get(r.gateway) ?? { gateway: r.gateway, count: 0, gross: 0 };
    g.count += 1;
    g.gross += Number(r.gross_aed || 0);
    byGateway.set(r.gateway, g);
  }

  return NextResponse.json({
    date,
    records,
    byGateway: [...byGateway.values()].map((g) => ({ ...g, gross: +g.gross.toFixed(2) })).sort((a, b) => b.gross - a.gross),
    total: +records.reduce((s, r) => s + Number(r.gross_aed || 0), 0).toFixed(2),
    recentDates: dates.slice(0, 60),
  });
}
