import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const since = new Date(Date.now() - 4 * 3600_000).toISOString();
  const { data } = await supabase.from("stock_events")
    .select("source, occurred_at")
    .gte("occurred_at", since)
    .not("source", "in", "(reconciler,master)");

  // 16 buckets of 15 min each. Round each event to its bucket.
  const now = Date.now();
  const bucketMs = 15 * 60_000;
  const buckets: Record<string, Record<string, number>> = {};
  for (let i = 0; i < 16; i++) {
    const t = now - (15 - i) * bucketMs;
    const key = new Date(Math.floor(t / bucketMs) * bucketMs).toISOString();
    buckets[key] = { shopify_uae: 0, shopify_ksa: 0, shopify_wa: 0, woo: 0, zoho: 0 };
  }

  for (const evt of data ?? []) {
    const t = new Date(evt.occurred_at).getTime();
    const key = new Date(Math.floor(t / bucketMs) * bucketMs).toISOString();
    if (buckets[key] && buckets[key][evt.source] !== undefined) {
      buckets[key][evt.source]++;
    }
  }

  return NextResponse.json({
    buckets: Object.entries(buckets).map(([time, counts]) => ({ time, ...counts })),
  });
}