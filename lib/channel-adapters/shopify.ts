// lib/channel-adapters/shopify.ts — replace resolveShopifyTargets

import { ShopifyStoreCode, getShopifyStores } from "../integrations/shopify";
import { supabase } from "../supabase";

import { logStockEvent } from "@/lib/stock-events";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-04";

// inventorySetQuantities is the correct mutation for reconciliation:
// absolute target value, not a delta. compareQuantity gives us optimistic
// concurrency — if Shopify's current available differs from what we saw
// last, the mutation fails and we re-read + retry. That's how we avoid
// two racing reconciles clobbering each other.
const SET_QUANTITIES = /* GraphQL */ `
  mutation SetQty($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup { id createdAt reason }
      userErrors { field message code }
    }
  }
`;

type Channel = "shopify_uae" | "shopify_ksa" | "shopify_wa";

function storeCodeFor(channel: Channel): ShopifyStoreCode {
  return channel.replace("shopify_", "").toUpperCase() as ShopifyStoreCode;
}

async function resolveShopifyTargets(store: ShopifyStoreCode, sku: string) {
    const { data, error } = await supabase.from("shopify_variant_map")
      .select("variant_id, inventory_item_id, location_id, location_name, is_readonly, fulfillment_service, product_status")
      .eq("store_id", store).eq("sku", sku);
    if (error) throw new Error(`shopify_variant_map read: ${error.message}`);
    if (!data || data.length === 0) throw new Error(`shopify:${store}: no variant for SKU ${sku}`);
  
    const variants = new Set(data.map((d) => d.variant_id));
    if (variants.size > 1) {
      // Alert already exists from bulk sync; adapter just refuses.
      throw new Error(`shopify:${store}: SKU ${sku} spans ${variants.size} variants, refusing`);
    }
  
    const active = data.filter((d) => (d.product_status ?? "ACTIVE") === "ACTIVE");
    if (active.length === 0) throw new Error(`shopify:${store}: SKU ${sku} product not active`);
  
    // Prefer a writable manual location. If all locations are readonly (SMSA-style
    // fulfillment service), we can't push — raise a specific error the reconciler
    // treats as "alert, don't retry".
    const writable = active.filter((d) => !d.is_readonly);
    if (writable.length === 0) {
      await supabase.from("stock_alerts").upsert({
        sku, kind: "readonly_location",
        detail: { store, locations: active.map((a) => ({ name: a.location_name, service: a.fulfillment_service })) },
      }, { onConflict: "sku,kind" });
      throw new Error(`READONLY_LOCATION shopify:${store} SKU ${sku}`);
    }
  
    // If multiple writable locations exist, prefer the one matching a hint we
    // store per store (e.g. UAE store's primary location). For now, first one.
    return writable[0];
  }





export async function pushShopify(
  channel: Channel,
  sku: string,
  targetQuantity: number,
  compareQuantity?: number, // last-seen value from cache; enforced optimistically
): Promise<void> {
  const storeCode = storeCodeFor(channel);
  const store = getShopifyStores().find((s) => s.code === storeCode);
  if (!store) throw new Error(`shopify:${channel}: store not configured`);

  const target = await resolveShopifyTargets(storeCode, sku);
  const endpoint = `${store.url}/admin/api/${API_VERSION}/graphql.json`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": store.token,
    },
    body: JSON.stringify({
      query: SET_QUANTITIES,
      variables: {
        input: {
          reason: "correction",
          name: "available",
          ignoreCompareQuantity: compareQuantity == null,
          referenceDocumentUri: `logistics://reconciler/${sku}/${Date.now()}`,
          quantities: [{
            inventoryItemId: target.inventory_item_id,
            locationId: target.location_id,
            quantity: targetQuantity,
            ...(compareQuantity != null ? { compareQuantity } : {}),
          }],
        },
      },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`shopify:${channel} HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const errs = json?.data?.inventorySetQuantities?.userErrors ?? [];
  if (errs.length > 0) {
    // NON_CONVERGENT means compareQuantity mismatched — someone else moved it.
    // Bubble up; reconciler's retry path will re-read cache and try again.
    throw new Error(`shopify:${channel} userErrors: ${JSON.stringify(errs).slice(0, 300)}`);
  }
  if (json.errors) {
    throw new Error(`shopify:${channel} graphql: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }

  await logStockEvent({
    sku, source: channel, event_type: "reconcile_push",
    new_qty: targetQuantity, correlation: json.data.inventorySetQuantities.inventoryAdjustmentGroup?.id,
    occurred_at: new Date(),
    raw: { compareQuantity, targetQuantity },
  });
}