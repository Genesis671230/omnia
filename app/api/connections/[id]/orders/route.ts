import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { chunkForInFilter } from "@/lib/repositories/in-filter-chunks";
import { getAccessToken, getConnection, getConnector, ReauthRequiredError } from "@/lib/connectors";

export const dynamic = "force-dynamic";

// GET ?limit=50 → { storeId, totalInDb, orders: [{ ...OrderRow, inOurDb }] }
// Live preview straight from the provider, marked against our orders table.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const conn = await getConnection((await params).id);
  if (!conn) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const def = getConnector(conn.provider);
  if (!def.listOrders) return NextResponse.json({ error: `${def.label} has no orders` }, { status: 400 });
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit")) || 50, 1), 50);
  try {
    const live = await def.listOrders(conn, await getAccessToken(conn), { limit });
    const storeId = String((conn.config as { store_id?: string }).store_id ?? "");
    const known = new Set<string>();
    for (const chunk of chunkForInFilter(live.map((o) => o.id))) {
      const { data, error } = await supabase.from("orders").select("id").in("id", chunk);
      if (error) throw new Error(`orders lookup failed: ${error.message}`);
      for (const r of data ?? []) known.add(r.id as string);
    }
    const { count } = await supabase.from("orders").select("*", { count: "exact", head: true }).eq("store_id", storeId);
    return NextResponse.json({ storeId, totalInDb: count ?? 0, orders: live.map((o) => ({ ...o, inOurDb: known.has(o.id) })) });
  } catch (e) {
    if (e instanceof ReauthRequiredError) return NextResponse.json({ error: e.message, reauth: true }, { status: 409 });
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
