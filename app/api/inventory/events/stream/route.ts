import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const since = Number(req.nextUrl.searchParams.get("since") ?? 0);
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 60), 100);

  let q = supabase.from("stock_events")
    .select("id, sku, source, event_type, delta, new_qty, correlation, occurred_at, raw")
    .order("id", { ascending: false })
    .limit(limit);
  if (since > 0) q = q.gt("id", since);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    events: data ?? [],
    highWatermark: data?.[0]?.id ?? since,
  });
}