import { NextResponse } from "next/server";
import { runInZohoOrgOr400 } from "@/lib/integrations/zoho-org";
import { searchItems } from "@/lib/sales-orders/zoho-so";

export const dynamic = "force-dynamic";

// GET /api/sales-orders/items?q=SET101&org=env — item search for the editor's "add line".
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });
  return runInZohoOrgOr400(sp.get("org") || "env", async () => {
    try {
      return NextResponse.json({ items: await searchItems(q) });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  });
}
