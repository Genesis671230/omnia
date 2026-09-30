import { NextResponse } from "next/server";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { dubaiMonthBounds, dubaiRangeBoundsUtc, dubaiToday } from "@/lib/dubai-day";
import { computeSalesByCountry } from "@/lib/orders/sales-by-country";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// GET /api/dashboard/geo?month=2026-09            whole Dubai month
// GET /api/dashboard/geo?from=2026-09-22&to=2026-09-28
//
// Counted sales by shipping country and city (lib/orders/sales-by-country.ts)
// — the same orders and totals as the sales ledger for that range.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const from = q.get("from") || "";
  const to = q.get("to") || "";
  const month = q.get("month") || "";

  let fromDay: string;
  let toDay: string;
  if (DAY.test(from) && DAY.test(to) && from <= to) {
    fromDay = from;
    toDay = to;
  } else {
    ({ fromDay, toDay } = dubaiMonthBounds(`${MONTH.test(month) ? month : dubaiToday().slice(0, 7)}-01`));
  }

  try {
    const { fromUtc, toUtc } = dubaiRangeBoundsUtc(fromDay, toDay);
    const rows = await OrdersRepository.listInWindow({ from: fromUtc, to: toUtc });
    return NextResponse.json(computeSalesByCountry(rows, { fromDay, toDay }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
