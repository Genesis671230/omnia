import { NextResponse } from "next/server";
import { buildSheetAdjustments } from "@/lib/dispatch/sheet-adjustments.service";
import { dubaiToday } from "@/lib/dubai-day";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/dispatch/sheet-adjustments?month=2026-09[&fresh=1]
//
// Orders the month's dispatch sheet (Local + SMSA) records as cancelled,
// refunded, returned or exchanged that the app hasn't marked — with the
// adjustment to apply. Read-only.
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const raw = (sp.get("month") || "").trim();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : dubaiToday().slice(0, 7);
  try {
    return NextResponse.json(await buildSheetAdjustments(month, sp.get("fresh") === "1"));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
