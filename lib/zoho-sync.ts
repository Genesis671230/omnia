// Shared Zoho + live-store-inventory sync logic — pulls Zoho's authoritative
// items/sales orders plus live Shopify (per store) and WooCommerce stock,
// and upserts them for the inventory comparison view. Used by both the
// on-demand API route (POST /api/integrations/zoho) and the persistent
// in-app scheduler. Mirrors lib/ad-sync.ts.
//
// Each source is fetched and saved independently — one store's API being
// down (e.g. a stale Shopify store handle) must not block the others.

import { zohoConfigured, fetchZohoItems, fetchZohoSalesOrders } from "@/lib/integrations/zoho";
import { getShopifyStores, fetchShopifyInventory } from "@/lib/integrations/shopify";
import { wooConfigured, fetchWooProducts } from "@/lib/integrations/woo";
import { ZohoRepository } from "@/lib/repositories/zoho.repository";
import { StoreInventoryRepository, type StoreInventoryRow } from "@/lib/repositories/store-inventory.repository";
import type { ZohoSourceResult } from "@/lib/repositories/zoho-sync-runs.repository";

export async function syncZohoAndInventory(): Promise<ZohoSourceResult[]> {
  const results: ZohoSourceResult[] = [];

  if (zohoConfigured()) {
    try {
      const items = await fetchZohoItems();
      const saved = await ZohoRepository.upsertItems(items);
      results.push({ source: "zoho-items", fetched: items.length, saved });
    } catch (e) {
      results.push({ source: "zoho-items", fetched: 0, saved: 0, error: (e as Error).message });
    }

    try {
      const orders = await fetchZohoSalesOrders();
      const saved = await ZohoRepository.upsertOrders(orders);
      results.push({ source: "zoho-orders", fetched: orders.length, saved });
    } catch (e) {
      results.push({ source: "zoho-orders", fetched: 0, saved: 0, error: (e as Error).message });
    }
  }

  console.log(getShopifyStores(),":stores");
  for (const store of getShopifyStores()) {
    try {
      const inventory = await fetchShopifyInventory(store);
      const rows: StoreInventoryRow[] = inventory.map((r) => ({
        storeId: store.code,
        sku: r.sku ?? "",
        quantity: r.inventoryQuantity,
        productTitle: r.product?.title ?? "",
        productStatus: r.product?.status ?? "",
      }));

      const saved = await StoreInventoryRepository.upsertMany(rows);
      results.push({ source: `shopify-${store.code}`, fetched: inventory.length, saved });
    } catch (e) {
      results.push({ source: `shopify-${store.code}`, fetched: 0, saved: 0, error: (e as Error).message });
    }
  }

  if (wooConfigured()) {
    try {
      const products = await fetchWooProducts();
      const rows: StoreInventoryRow[] = products.map((p) => ({
        storeId: "WOO",
        sku: p.sku ?? "",
        quantity: p.manage_stock ? p.stock_quantity : null,
        productTitle: p.name ?? "",
        productStatus: p.status ?? "",
      }));
      const saved = await StoreInventoryRepository.upsertMany(rows);
      results.push({ source: "woo", fetched: products.length, saved });
    } catch (e) {
      results.push({ source: "woo", fetched: 0, saved: 0, error: (e as Error).message });
    }
  }

  return results;
}
