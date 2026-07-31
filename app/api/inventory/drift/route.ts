// app/api/inventory/drift/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  // Pull the same data your summary route pulls. Only difference: return
  // rows where any active store's qty ≠ zoho.available_stock. No new
  // tables, no dependencies. Works today.
  const { data: zoho } = await supabase.from("zoho_items")
    .select("sku, name, available_stock").not("sku", "is", null);
  const { data: store } = await supabase.from("store_inventory")
    .select("sku, store_id, quantity, product_status")
    .in("product_status", ["ACTIVE", "publish", "active"]);

  const zohoBySku = new Map(zoho?.map((z) => [z.sku, z]) ?? []);
  const storeBySku = new Map<string, any[]>();
  for (const row of store ?? []) {
    const arr = storeBySku.get(row.sku) ?? [];
    arr.push(row);
    storeBySku.set(row.sku, arr);
  }

  const rows: any[] = [];
  for (const [sku, z] of zohoBySku) {
    const stores = storeBySku.get(sku) ?? [];
    if (stores.length === 0) continue;                    // coverage issue, not drift
    const zohoAvail = z.available_stock ?? 0;
    const cells = stores.map((s) => ({
      channel: s.store_id.toLowerCase().startsWith("shopify") ? s.store_id.toLowerCase() : s.store_id.toLowerCase(),
      quantity: s.quantity,
      diff: (s.quantity ?? 0) - zohoAvail,
    }));
    const worst = Math.max(...cells.map((c) => Math.abs(c.diff)));
    if (worst > 0) {
      rows.push({
        sku, name: z.name, zoho_available: zohoAvail,
        stores: cells,
        worstDiff: worst,
      });
    }
  }

  rows.sort((a, b) => b.worstDiff - a.worstDiff);
  return NextResponse.json({ rows: rows.slice(0, 100) });
}