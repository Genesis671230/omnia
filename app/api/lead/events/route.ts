import { NextResponse } from "next/server";
import { storeEvents } from "@/lib/ramza/funnel.server";

/* Public: funnel events from the RAMZA pages (lib/ramza/funnel.ts), sent as
   fetch or sendBeacon. Small batches only; props are flattened server-side. */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 32_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  const body = await request.json().catch(() => null);
  const r = await storeEvents(body);
  if ("error" in r) {
    if (r.error !== "bad anon id") console.warn("[ramza/events]", r.error);
    return NextResponse.json({ ok: false }, { status: r.error === "bad anon id" ? 400 : 500 });
  }
  return NextResponse.json({ ok: true, stored: r.stored });
}
