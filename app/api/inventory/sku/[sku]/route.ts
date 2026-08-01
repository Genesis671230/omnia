import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { sku: string } }) {
  const storeParams = await params
  const sku = decodeURIComponent(storeParams.sku);

  const [zohoRes, storesRes, eventsRes] = await Promise.all([
    supabase.from("zoho_items").select("name, available_stock, stock_on_hand").eq("sku", sku).maybeSingle(),
    supabase.from("store_inventory").select("store_id, quantity, product_status").eq("sku", sku),
    supabase.from("stock_events").select("*").eq("sku", sku).order("id", { ascending: false }).limit(20),
  ]);

  return NextResponse.json({
    sku,
    name: zohoRes.data?.name ?? "",
    zoho: {
      available_stock: zohoRes.data?.available_stock ?? 0,
      stock_on_hand:   zohoRes.data?.stock_on_hand ?? 0,
    },
    stores: (storesRes.data ?? []).map((s) => ({
      channel: s.store_id.toLowerCase().startsWith("shopify") ? s.store_id.toLowerCase() : s.store_id.toLowerCase(),
      quantity: s.quantity,
      product_status: s.product_status,
    })),
    recentEvents: eventsRes.data ?? [],
  });
}