import { supabase } from "@/lib/supabase";
import type { ZohoWarehouse, ZohoItemDetail, ZohoItemWarehouseEntry } from "@/lib/integrations/zoho-warehouses";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";
const UPSERT_BATCH = 500;

/* ── warehouse metadata ────────────────────────────────────────────────── */

export const ZohoWarehousesRepository = {
  async upsertMany(warehouses: ZohoWarehouse[]): Promise<number> {
    if (warehouses.length === 0) return 0;
    const rows = warehouses.map((w) => ({
      warehouse_id: w.warehouse_id,
      tenant_id: TENANT,
      warehouse_name: w.warehouse_name,
      status: w.status ?? "",
      is_primary: Boolean(w.is_primary || w.is_org_level_primary),
      is_fba_warehouse: Boolean(w.is_fba_warehouse),
      address: {
        address: w.address ?? "",
        address1: w.address1 ?? "",
        address2: w.address2 ?? "",
        city: w.city ?? "",
        state: w.state ?? "",
        state_code: w.state_code ?? "",
        country: w.country ?? "",
        country_code: w.country_code ?? "",
        zip: w.zip ?? "",
        phone: w.phone ?? "",
        email: w.email ?? "",
        attention: w.attention ?? "",
      },
      synced_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("zoho_warehouses").upsert(rows, { onConflict: "warehouse_id" });
    if (error) throw new Error(`zoho_warehouses upsert failed: ${error.message}`);
    return rows.length;
  },

  async listAll(): Promise<{ warehouse_id: string; warehouse_name: string; is_primary: boolean; status: string; address: Record<string, string> }[]> {
    const { data, error } = await supabase
      .from("zoho_warehouses")
      .select("warehouse_id, warehouse_name, is_primary, status, address")
      .order("is_primary", { ascending: false })
      .order("warehouse_name", { ascending: true });
    if (error) throw new Error(`zoho_warehouses select failed: ${error.message}`);
    return (data ?? []) as { warehouse_id: string; warehouse_name: string; is_primary: boolean; status: string; address: Record<string, string> }[];
  },
};

/* ── per-item × per-warehouse stock ────────────────────────────────────── */

export const ZohoItemWarehouseStockRepository = {
  // Explodes ONE item's detail into N rows (one per warehouse) and upserts
  // them together. The item_id stays the same across rows; only warehouse_id
  // + numeric fields vary. Skipping `is_item_mapped=false` rows would drop
  // real zero-stock signal (a warehouse that USED to carry a SKU but no
  // longer does still deserves a row saying "0 here now") — so we save
  // every warehouse entry, including unmapped ones.
  async saveItemDetail(item: ZohoItemDetail): Promise<number> {
    if (!item.warehouses || item.warehouses.length === 0) return 0;
    const now = new Date().toISOString();
    const rows = item.warehouses.map((w: ZohoItemWarehouseEntry) => ({
      item_id: item.item_id,
      sku: (item.sku ?? "").trim(),
      warehouse_id: w.warehouse_id,
      tenant_id: TENANT,
      stock_on_hand: w.warehouse_stock_on_hand ?? 0,
      available_stock: w.warehouse_available_stock ?? 0,
      available_for_sale_stock: w.warehouse_available_for_sale_stock ?? 0,
      committed_stock: w.warehouse_committed_stock ?? 0,
      actual_available_stock: w.warehouse_actual_available_stock ?? 0,
      actual_committed_stock: w.warehouse_actual_committed_stock ?? 0,
      actual_available_for_sale_stock: w.warehouse_actual_available_for_sale_stock ?? 0,
      quantity_in_transit: w.warehouse_quantity_in_transit ?? 0,
      is_item_mapped: Boolean(w.is_item_mapped),
      is_primary: Boolean(w.is_primary),
      last_modified_time: item.last_modified_time || null,
      synced_at: now,
    }));
    const { error } = await supabase
      .from("zoho_item_warehouse_stock")
      .upsert(rows, { onConflict: "item_id,warehouse_id" });
    if (error) throw new Error(`zoho_item_warehouse_stock upsert failed: ${error.message}`);
    return rows.length;
  },

  // Batched multi-item variant for backfill throughput. Same logic,
  // pre-exploded and chunked.
  async saveMany(items: ZohoItemDetail[]): Promise<number> {
    if (items.length === 0) return 0;
    const now = new Date().toISOString();
    const rows = items.flatMap((item) =>
      (item.warehouses ?? []).map((w) => ({
        item_id: item.item_id,
        sku: (item.sku ?? "").trim(),
        warehouse_id: w.warehouse_id,
        tenant_id: TENANT,
        stock_on_hand: w.warehouse_stock_on_hand ?? 0,
        available_stock: w.warehouse_available_stock ?? 0,
        available_for_sale_stock: w.warehouse_available_for_sale_stock ?? 0,
        committed_stock: w.warehouse_committed_stock ?? 0,
        actual_available_stock: w.warehouse_actual_available_stock ?? 0,
        actual_committed_stock: w.warehouse_actual_committed_stock ?? 0,
        actual_available_for_sale_stock: w.warehouse_actual_available_for_sale_stock ?? 0,
        quantity_in_transit: w.warehouse_quantity_in_transit ?? 0,
        is_item_mapped: Boolean(w.is_item_mapped),
        is_primary: Boolean(w.is_primary),
        last_modified_time: item.last_modified_time || null,
        synced_at: now,
      })),
    );

    for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
      const chunk = rows.slice(i, i + UPSERT_BATCH);
      const { error } = await supabase
        .from("zoho_item_warehouse_stock")
        .upsert(chunk, { onConflict: "item_id,warehouse_id" });
      if (error) throw new Error(`zoho_item_warehouse_stock upsert failed: ${error.message}`);
    }
    return rows.length;
  },

  // The delta-sync cursor. Returns the max last_modified_time we've ever
  // saved — the ongoing sync uses this as its "since" filter so it only
  // detail-fetches items Zoho reports as changed after this point.
  async getMaxLastModifiedTime(): Promise<string | null> {
    const { data, error } = await supabase
      .from("zoho_item_warehouse_stock")
      .select("last_modified_time")
      .not("last_modified_time", "is", null)
      .order("last_modified_time", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`zoho_item_warehouse_stock cursor read failed: ${error.message}`);
    return data?.last_modified_time ?? null;
  },
};