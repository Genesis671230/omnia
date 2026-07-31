// lib/lookup-sku.ts
import { supabase } from "@/lib/supabase";
import { getShopifyStores, type ShopifyStoreCode } from "@/lib/integrations/shopify";
import { normalizeSku } from "@/lib/sku";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-04";

// In-memory LRU for hot lookups. Webhook receivers run on serverless, so
// this only helps within a warm invocation — the DB cache is what matters
// across invocations. Kept small on purpose.
const hot = new Map<string, string>();
const HOT_MAX = 500;
function hotSet(k: string, v: string) {
  if (hot.size >= HOT_MAX) hot.delete(hot.keys().next().value);
  hot.set(k, v);
}

/**
 * Resolve a Shopify inventory_item_id (numeric or gid) to a canonical SKU.
 * Returns null if the item genuinely has no SKU — some Shopify products
 * are stored with empty SKU (gift cards, drafts). Callers must handle null,
 * NOT throw.
 */
export async function lookupSkuByInventoryItemId(
  store: ShopifyStoreCode,
  inventoryItemId: string | number,
): Promise<string | null> {
  const gid = toGid(inventoryItemId);
  const key = `${store}:${gid}`;

  // 1. Warm-invocation cache.
  const cached = hot.get(key);
  if (cached !== undefined) return cached || null;

  // 2. DB cache — the map that bulk sync populates.
  const { data, error } = await supabase
    .from("shopify_variant_map")
    .select("sku")
    .eq("store_id", store)
    .eq("inventory_item_id", gid)
    .limit(1)
    .maybeSingle();

  if (!error && data?.sku) {
    hotSet(key, data.sku);
    return data.sku;
  }

  // 3. Cold path — hit Shopify. This should be rare (new variant created
  // after last bulk sync). Log so we can watch the cold-hit rate.
  console.warn(`[lookup-sku] cold path ${store} inventory_item_id=${gid}`);
  const fresh = await fetchFromShopify(store, gid);
  if (!fresh) {
    hotSet(key, "");
    return null;
  }

  // 4. Write back into the map so we're not cold next time. Best-effort —
  // if the upsert races with a bulk sync, either wins fine.
  await supabase.from("shopify_variant_map").upsert({
    store_id: store,
    variant_id: fresh.variantId,
    sku: fresh.sku,
    inventory_item_id: gid,
    location_id: fresh.locationId,
    location_name: fresh.locationName,
    is_readonly: fresh.isReadonly,
    fulfillment_service: fresh.fulfillmentService,
    product_status: fresh.productStatus,
    synced_at: new Date().toISOString(),
  }, { onConflict: "store_id,variant_id,location_id" });

  hotSet(key, fresh.sku);
  return fresh.sku;
}

// Inverse lookup — orders/create webhook occasionally hands us just a
// variant_id (line item .variant_id) without .sku. Same shape.
export async function lookupSkuByVariantId(
  store: ShopifyStoreCode,
  variantId: string | number,
): Promise<string | null> {
  const gid = toVariantGid(variantId);
  const { data } = await supabase
    .from("shopify_variant_map")
    .select("sku")
    .eq("store_id", store)
    .eq("variant_id", gid)
    .limit(1)
    .maybeSingle();
  if (data?.sku) return data.sku;

  // Cold path — one-off variant query.
  const fresh = await fetchVariantFromShopify(store, gid);
  return fresh?.sku ?? null;
}

// ------- helpers -------

function toGid(id: string | number): string {
  const s = String(id);
  return s.startsWith("gid://") ? s : `gid://shopify/InventoryItem/${s}`;
}
function toVariantGid(id: string | number): string {
  const s = String(id);
  return s.startsWith("gid://") ? s : `gid://shopify/ProductVariant/${s}`;
}

const INVENTORY_ITEM_QUERY = /* GraphQL */ `
  query InvItem($id: ID!) {
    inventoryItem(id: $id) {
      id
      variant {
        id
        sku
        product { status }
      }
      inventoryLevels(first: 5) {
        nodes {
          location {
            id name isActive
            fulfillmentService { serviceName type }
          }
        }
      }
    }
  }
`;

const VARIANT_QUERY = /* GraphQL */ `
  query Variant($id: ID!) {
    productVariant(id: $id) {
      id sku
      product { status }
      inventoryItem { id }
    }
  }
`;

async function fetchFromShopify(store: ShopifyStoreCode, gid: string) {
  const cfg = getShopifyStores().find((s) => s.code === store);
  if (!cfg) return null;

  const res = await fetch(`${cfg.url}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": cfg.token },
    body: JSON.stringify({ query: INVENTORY_ITEM_QUERY, variables: { id: gid } }),
    cache: "no-store",
  });
  if (!res.ok) {
    console.error(`[lookup-sku] shopify HTTP ${res.status}`);
    return null;
  }
  const json = await res.json();
  const item = json?.data?.inventoryItem;
  if (!item?.variant?.sku) return null;

  // Pick the first writable location; readonly-only variants still get cached
  // with the readonly flag so the adapter refuses correctly downstream.
  const levels = item.inventoryLevels?.nodes ?? [];
  const writable = levels.find(
    (l: any) => l.location.isActive
      && (!l.location.fulfillmentService || l.location.fulfillmentService.serviceName === "manual"),
  );
  const chosen = writable ?? levels[0];
  if (!chosen) return null;

  const svc = chosen.location.fulfillmentService?.serviceName ?? null;

  return {
    sku: normalizeSku(item.variant.sku),
    variantId: item.variant.id,
    locationId: chosen.location.id,
    locationName: chosen.location.name,
    isReadonly: Boolean(svc) && svc !== "manual",
    fulfillmentService: svc,
    productStatus: item.variant.product.status,
  };
}

async function fetchVariantFromShopify(store: ShopifyStoreCode, gid: string) {
  const cfg = getShopifyStores().find((s) => s.code === store);
  if (!cfg) return null;
  const res = await fetch(`${cfg.url}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": cfg.token },
    body: JSON.stringify({ query: VARIANT_QUERY, variables: { id: gid } }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const v = (await res.json())?.data?.productVariant;
  if (!v?.sku) return null;
  return { sku: normalizeSku(v.sku) };
}