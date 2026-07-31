import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const CHANNELS = ["shopify_uae", "shopify_ksa", "shopify_wa", "woo"] as const;

export async function GET() {
  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const since5m  = new Date(Date.now() - 5 * 60_000).toISOString();

  const health = await Promise.all(CHANNELS.map(async (channel) => {
    // Store totals from inventory table
    const storeId =
      channel === "woo" ? "WOO"
      : channel === "shopify_uae" ? "UAE"
      : channel === "shopify_ksa" ? "KSA" : "WA";

    const { data: inv } = await supabase.from("store_inventory")
      .select("quantity, sku, product_status")
      .eq("store_id", storeId);

    const totalQty = (inv ?? []).reduce((s, r) => s + (r.quantity ?? 0), 0);
    const skuCount = new Set((inv ?? []).map((r) => r.sku)).size;

    // Event activity in last 24h
    const { count: events24h } = await supabase.from("stock_events")
      .select("id", { count: "exact", head: true })
      .eq("source", channel)
      .gte("occurred_at", since24h);

    // Recent activity → pulses green
    const { data: recent } = await supabase.from("stock_events")
      .select("occurred_at").eq("source", channel)
      .order("occurred_at", { ascending: false }).limit(1);

    const lastActivity = recent?.[0]?.occurred_at ?? null;
    const isPulsing = lastActivity && new Date(lastActivity) > new Date(since5m);

    return {
      channel, storeId,
      totalQty, skuCount,
      events24h: events24h ?? 0,
      lastActivity, isPulsing,
    };
  }));

  return NextResponse.json({ health });
}