// Per-warehouse stock only comes from Zoho's item-detail endpoint and the
// bulk delta sync is not scheduled, so zoho_item_warehouse_stock goes stale
// (new items have no rows at all → the warehouse picker read 0 while the
// inventory page showed real stock). Callers that are about to decide on
// stock refresh just the SKUs they need: one Zoho call per item, skipped
// while its rows are fresher than FRESH_MS.

import { supabase } from "@/lib/supabase";
import { getAccessToken } from "@/lib/integrations/zoho";
import { fetchZohoItemDetail } from "@/lib/integrations/zoho-warehouses";
import { ZohoItemWarehouseStockRepository } from "@/lib/repositories/zoho-warehouses.repository";

const FRESH_MS = 60 * 1000;

/** Refresh the stored per-warehouse stock of these SKUs from Zoho. Returns SKU → item_id. */
export async function refreshWarehouseStock(skus: string[], opts: { force?: boolean } = {}): Promise<Map<string, string>> {
  const wanted = [...new Set(skus.map((s) => s.trim()).filter(Boolean))];
  const bySku = new Map<string, string>();
  if (wanted.length === 0) return bySku;

  const { data: items } = await supabase.from("zoho_items").select("item_id, sku").in("sku", wanted);
  for (const i of items ?? []) if (!bySku.has(String(i.sku).toUpperCase())) bySku.set(String(i.sku).toUpperCase(), String(i.item_id));
  const itemIds = [...new Set(bySku.values())];
  if (itemIds.length === 0) return bySku;

  const { data: fresh } = await supabase
    .from("zoho_item_warehouse_stock")
    .select("item_id")
    .in("item_id", itemIds)
    .gte("synced_at", new Date(Date.now() - (opts.force ? 0 : FRESH_MS)).toISOString());
  const freshIds = new Set((fresh ?? []).map((r) => r.item_id as string));
  const stale = itemIds.filter((id) => !freshIds.has(id));
  if (stale.length === 0) return bySku;

  const token = await getAccessToken();
  const details = await Promise.all(
    stale.map((id) => fetchZohoItemDetail(id, token).catch((e) => {
      console.error(`[live-warehouse-stock] item ${id}: ${(e as Error).message}`);
      return null;
    })),
  );
  await ZohoItemWarehouseStockRepository.saveMany(details.filter((d) => d !== null));
  return bySku;
}

/** Sellable stock minus other orders' open reservations, per item, in one warehouse. */
export async function effectiveStock(itemIds: string[], warehouseId: string, exceptOrderUid: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (itemIds.length === 0) return out;
  const [{ data: ws }, { data: res }] = await Promise.all([
    supabase.from("zoho_item_warehouse_stock").select("item_id, actual_available_for_sale_stock").in("item_id", itemIds).eq("warehouse_id", warehouseId),
    supabase.from("inventory_reservations").select("item_id, qty, order_uid").in("item_id", itemIds).eq("warehouse_id", warehouseId).is("released_at", null),
  ]);
  for (const id of itemIds) out.set(id, 0);
  for (const w of ws ?? []) out.set(String(w.item_id), Number(w.actual_available_for_sale_stock ?? 0));
  for (const r of res ?? []) if (r.order_uid !== exceptOrderUid) out.set(String(r.item_id), (out.get(String(r.item_id)) ?? 0) - Number(r.qty ?? 0));
  return out;
}
