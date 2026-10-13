// app/api/orders/[uid]/fulfillment-options/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { effectiveStock, refreshWarehouseStock } from "@/lib/inventory/live-warehouse-stock";

// ?fresh=1 re-reads Zoho even when the stored rows are under a minute old —
// used right after the KSA panel loaded, so the cards and the panel agree.
export async function GET(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const force = Boolean(new URL(req.url).searchParams.get("fresh"));
  const { data: order } = await supabase.from("orders").select("line_items").eq("uid", uid).maybeSingle();
  const lines = ((order?.line_items ?? []) as Array<{ sku?: string; qty?: number }>)
    .map((l) => ({ sku: (l.sku ?? "").trim(), qty: Number(l.qty ?? 1) }))
    .filter((l) => l.sku && l.qty > 0);
  let itemIds = new Map<string, string>();
  try {
    // The stored per-warehouse stock goes stale — read this order's SKUs live first.
    itemIds = await refreshWarehouseStock(lines.map((l) => l.sku), { force });
  } catch (e) {
    // Fall back to the stored stock rather than failing the picker.
    console.error("[fulfillment-options] live stock refresh failed:", (e as Error).message);
  }
  const { data, error } = await supabase.rpc("order_fulfillment_options", { p_order_uid: uid });
  if (error) {
    console.error("[fulfillment-options]", error.message);
    return NextResponse.json({ options: [] });
  }
  // Only warehouses Zoho reports as active — drops seed/placeholder rows
  // (a status-less "Omniastores LLC" duplicate showed up as a second card).
  const { data: active } = await supabase.from("zoho_warehouses").select("warehouse_id").eq("status", "active");
  const activeIds = new Set((active ?? []).map((w) => w.warehouse_id as string));
  const options = await Promise.all((data ?? [])
    .filter((o: { warehouse_id: string }) => activeIds.has(o.warehouse_id))
    .map(async (o: { warehouse_id: string }) => {
      // Per-SKU counts with the same numbers the KSA panel shows.
      const have = await effectiveStock([...new Set(itemIds.values())], o.warehouse_id, uid);
      return { ...o, stock: lines.map((l) => ({ sku: l.sku, need: l.qty, have: itemIds.has(l.sku.toUpperCase()) ? have.get(itemIds.get(l.sku.toUpperCase())!) ?? 0 : null })) };
    }));
  return NextResponse.json({ options });
}
