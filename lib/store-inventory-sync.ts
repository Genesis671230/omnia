import { ShopifyVariantMapRow, ShopifyStoreConfig, fetchShopifyVariantMap } from "./integrations/shopify";
import { supabase } from "./supabase";

// lib/store-inventory-sync.ts — extension
export async function syncShopifyVariantMap(store: ShopifyStoreConfig) {
    const rows = await fetchShopifyVariantMap(store);
  
    // Detect multi-variant SKUs on this store — same SKU on 2+ variants means
    // we can't safely auto-push. Flag once as an alert; ops fixes in Shopify.
    const bySku = new Map<string, ShopifyVariantMapRow[]>();
    for (const r of rows) {
      const arr = bySku.get(r.sku) ?? [];
      arr.push(r);
      bySku.set(r.sku, arr);
    }
    for (const [sku, group] of bySku) {
      const variants = new Set(group.map((g) => g.variant_id));
      if (variants.size > 1) {
        await supabase.from("stock_alerts").upsert({
          sku, kind: "multi_variant_sku",
          detail: { store: store.code, variants: [...variants] },
        }, { onConflict: "sku,kind" });
      }
    }
  
    // Upsert the map. One row per (store, variant, location) — a variant can
    // legitimately have levels at multiple locations.
    const dbRows = rows.map((r) => ({
      store_id: r.store_id,
      variant_id: r.variant_id,
      sku: r.sku,
      inventory_item_id: r.inventory_item_id,
      location_id: r.location_id,
      location_name: r.location_name,
      is_readonly: r.is_readonly,
      fulfillment_service: r.fulfillment_service,
      product_status: r.product_status,
      synced_at: new Date().toISOString(),
    }));
  
    for (let i = 0; i < dbRows.length; i += 500) {
      const chunk = dbRows.slice(i, i + 500);
      const { error } = await supabase.from("shopify_variant_map")
        .upsert(chunk, { onConflict: "store_id,variant_id,location_id" });
      if (error) throw new Error(`shopify_variant_map upsert: ${error.message}`);
    }
  }