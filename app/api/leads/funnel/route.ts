import { NextResponse } from "next/server";
import { funnelStats } from "@/lib/ramza/funnel.server";

// GET /api/leads/funnel?days=30 — the RAMZA funnel for the /leads inbox (signed-in only).
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const d = Math.min(Math.max(Number(new URL(req.url).searchParams.get("days")) || 30, 1), 180);
  try {
    return NextResponse.json(await funnelStats(d));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
