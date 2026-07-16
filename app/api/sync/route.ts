import { NextResponse } from "next/server";
import { syncAllStores } from "@/lib/sync/order-sync.service";

export const maxDuration = 120;

export async function POST(request: Request) {
  const { windowDays } = await request.json().catch(() => ({}));
  const results = await syncAllStores(typeof windowDays === "number" ? windowDays : undefined);
  const ok = results.every((r) => !r.error);
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 502 });
}
