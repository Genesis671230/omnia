import { ShopifyStoreConfig, ShopifyVariantMapRow, VARIANT_BY_SKU_QUERY, graphqlRequest } from "./integrations/shopify";



import {
    getShopifyStores,
    fetchShopifyVariantBySku,
  } from "./integrations/shopify";
  
  import {
    fetchWooProducts,
    fetchWooInventoryBySkus,
    wooConfigured,
  } from "./integrations/woo";

  
  export type InventoryExportRow = {
    platform: "SHOPIFY" | "WOOCOMMERCE";
    store: string;
    sku: string;
    product_name: string;
    image_url: string | null;
    stock_quantity: number | null;
    location: string | null;
    readonly: boolean;
    fulfillment_service: string | null;
  };
  
  export async function findInventoryBySkus(
    skus: string[],
  ): Promise<InventoryExportRow[]> {
    const normalizedSkus = [
      ...new Set(
        skus
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
  
    const rows: InventoryExportRow[] = [];
      console.log(rows,"internals")
    // -------------------------
    // SHOPIFY
    // -------------------------
  
    const shopifyStores = getShopifyStores();
  
    for (const store of shopifyStores) {
      for (const sku of normalizedSkus) {
        const variants = await fetchShopifyVariantBySku(
          store,
          sku,
        );
        console.log(variants,"got into variants")
  
        for (const variant of variants) {
          rows.push({
            platform: "SHOPIFY",
            store: store.code,
            sku: variant.sku,
            product_name:
              variant.product?.title ?? "",
            image_url:
              variant.image_url ?? null,
            stock_quantity:
              variant.available,
            location:
              variant.location_name,
            readonly:
              variant.is_readonly,
            fulfillment_service:
              variant.fulfillment_service,
          });
        }
      }
    }
  
    // -------------------------
    // WOOCOMMERCE
    // -------------------------
    console.log("[Inventory] Checking Woo configuration...");

    const isWooConfigured = wooConfigured();
    
    console.log(
      "[Inventory] Woo configured:",
      isWooConfigured
    );
    
    if (isWooConfigured) {
      console.log(
        "[Inventory] START fetching ALL Woo products..."
      );
    
      const wooRows = await fetchWooInventoryBySkus(normalizedSkus);
    
      for (const p of wooRows) {
        rows.push({
          platform: "WOOCOMMERCE",
          store: "WA",
          sku: p.sku,
          product_name: p.name,
          image_url: p.image_url,
          stock_quantity: p.stock_quantity,
          location: null,
          readonly: false,
          fulfillment_service: null,
        });
      }
    
    
    }
    return rows;
  }