import { NextResponse } from "next/server";
import { searchZohoItems } from "@/lib/orders/order-adjustment.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/orders/:uid/adjust/items?zohoOrg=…&q=…  — exchange item search in
// the org that holds the order's invoice (items differ per org).
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });
  try {
    return NextResponse.json({ items: await searchZohoItems(sp.get("zohoOrg") || "env", q) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
