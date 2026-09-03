// Shopify Admin GraphQL client — one client, three stores (WA / UAE / KSA).
// Only this file talks to Shopify. Tokens come from env, never hardcoded.

import { supabase } from "../supabase";

export type ShopifyStoreCode = "WA" | "UAE" | "KSA";

export type ShopifyStoreConfig = {
  code: ShopifyStoreCode;
  url: string; // https://xxx.myshopify.com
  token: string;
};

export function getShopifyStores(): ShopifyStoreConfig[] {
  const defs: { code: ShopifyStoreCode; url?: string; token?: string }[] = [
    {
      code: "WA",
      url: process.env.SHOPIFY_WA_URL,
      token: process.env.SHOPIFY_WA_TOKEN,
    },
    {
      code: "UAE",
      url: process.env.SHOPIFY_UAE_URL,
      token: process.env.SHOPIFY_UAE_TOKEN,
    },
    {
      code: "KSA",
      url: process.env.SHOPIFY_KSA_URL,
      token: process.env.SHOPIFY_KSA_TOKEN,
    },
  ];
  return defs
    .filter((d): d is ShopifyStoreConfig => Boolean(d.url && d.token))
    .map((d) => ({ ...d, url: d.url.replace(/\/+$/, "") }));
}

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-04";

// Shopify's Admin API is cost-throttled (HTTP 429, or a 200 with a
// GraphQL-level `THROTTLED` error). A 2-year backfill across 3 stores is
// enough volume to trip it — without this, one throttle response aborts
// the whole store's sync, losing every page already fetched in that run.
const MAX_RETRY_ATTEMPTS = 5;

async function shopifyFetchWithRetry(
  endpoint: string,
  init: RequestInit,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(endpoint, init);
    if (res.status !== 429 || attempt >= MAX_RETRY_ATTEMPTS) return res;
    const retryAfter =
      Number(res.headers.get("Retry-After")) || Math.min(2 ** attempt, 30);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
  }
}

// GraphQL-level throttling returns HTTP 200 with errors[].extensions.code
// === "THROTTLED" — distinct from the HTTP 429 case above, handled at each
// call site since it requires re-issuing the same POST body.
function isThrottledGraphQLError(json: any): boolean {
  return (
    Array.isArray(json?.errors) &&
    json.errors.some((e: any) => e?.extensions?.code === "THROTTLED")
  );
}

function throttleDelayMs(json: any, attempt: number): number {
  const restoreRate =
    json?.errors?.[0]?.extensions?.cost?.throttleStatus?.restoreRate;
  if (typeof restoreRate === "number" && restoreRate > 0)
    return Math.ceil(1000 / restoreRate) + 250;
  return Math.min(2 ** attempt, 30) * 1000;
}

// Everything the finance OS needs from an order, in one page-sized query.
const ORDERS_QUERY = /* GraphQL */ `
  query FinanceOrders($first: Int!, $after: String, $query: String) {
    orders(
      first: $first
      after: $after
      query: $query
      sortKey: CREATED_AT
      reverse: true
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        createdAt
        email
        displayFinancialStatus
        displayFulfillmentStatus
        paymentGatewayNames
        customer {
          displayName
          phone
          defaultAddress {
            phone
          }
        }
        shippingAddress {
          firstName
          lastName
          company
          address1
          address2
          city
          province
          zip
          countryCodeV2
          phone
        }

        billingAddress {
          firstName
          lastName
          company
          address1
          address2
          city
          province
          zip
          countryCodeV2
          phone
        }
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        currentSubtotalPriceSet {
          shopMoney {
            amount
          }
        }
        totalShippingPriceSet {
          shopMoney {
            amount
          }
        }
        currentTotalTaxSet {
          shopMoney {
            amount
          }
        }
        currentTotalDiscountsSet {
          shopMoney {
            amount
          }
        }
        fulfillments {
          trackingInfo {
            company
            number
            url
          }
        }
        lineItems(first: 25) {
          nodes {
            title
            sku
            quantity
            discountedTotalSet {
              shopMoney {
                amount
              }
            }
            product {
              id
            }
            image {
              url
            }
            variant {
              inventoryQuantity
            }
          }
        }
      }
    }
  }
`;

export type ShopifyRawOrder = {
  id: string; // gid://shopify/Order/6818557984926
  name: string; // #3347
  createdAt: string;
  email: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  paymentGatewayNames: string[];
  customer: {
    displayName: string;
    phone: string | null;
    defaultAddress: { phone: string | null } | null;
  } | null;
  shippingAddress: {
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    zip: string | null;
    countryCodeV2: string | null;
    phone: string | null;
  } | null;

  billingAddress: {
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    zip: string | null;
    countryCodeV2: string | null;
    phone: string | null;
  } | null;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  currentSubtotalPriceSet: { shopMoney: { amount: string } } | null;
  totalShippingPriceSet: { shopMoney: { amount: string } } | null;
  currentTotalTaxSet: { shopMoney: { amount: string } } | null;
  currentTotalDiscountsSet: { shopMoney: { amount: string } } | null;
  fulfillments:
    | {
        trackingInfo: {
          company: string | null;
          number: string | null;
          url: string | null;
        }[];
      }[]
    | null;
  lineItems: {
    nodes: {
      title: string;
      sku: string | null;
      quantity: number;
      discountedTotalSet: { shopMoney: { amount: string } } | null;
      product: { id: string } | null;
      image: { url: string } | null;
      variant: { inventoryQuantity: number | null } | null;
    }[];
  };
};

// Live stock per SKU, independent of orders — a SKU that hasn't sold
// recently still shows its real current count, unlike the stale
// last-order-line-item stock snapshot used elsewhere.
const INVENTORY_QUERY = /* GraphQL */ `
  query FinanceInventory($first: Int!, $after: String) {
    productVariants(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        sku
        inventoryQuantity
        product {
          title
          status
        }
      }
    }
  }
`;

export type ShopifyInventoryRow = {
  sku: string | null;
  inventoryQuantity: number | null;
  product: { title: string; status: string } | null;
};

export async function fetchShopifyInventory(
  store: ShopifyStoreConfig,
): Promise<ShopifyInventoryRow[]> {
  const endpoint = `${store.url}/admin/api/${API_VERSION}/graphql.json`;
  const rows: ShopifyInventoryRow[] = [];
  let after: string | null = null;

  do {
    let json: any;
    for (let attempt = 1; ; attempt++) {
      const res = await shopifyFetchWithRetry(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": store.token,
        },
        body: JSON.stringify({
          query: INVENTORY_QUERY,
          variables: { first: 250, after },
        }),
        cache: "no-store",
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `Shopify ${store.code} HTTP ${res.status}: ${body.slice(0, 300)}`,
        );
      }
      json = await res.json();
      if (isThrottledGraphQLError(json) && attempt < MAX_RETRY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, throttleDelayMs(json, attempt)));
        continue;
      }
      if (json.errors) {
        throw new Error(
          `Shopify ${store.code} GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`,
        );
      }
      break;
    }

    const page = json.data.productVariants;
    rows.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  return rows;
}

export async function fetchShopifyOrders(
  store: ShopifyStoreConfig,
  sinceIso: string,
  onPage?: (orders: ShopifyRawOrder[]) => Promise<void>,
): Promise<ShopifyRawOrder[]> {
  const endpoint = `${store.url}/admin/api/${API_VERSION}/graphql.json`;
  const orders: ShopifyRawOrder[] = [];
  let after: string | null = null;

  do {
    let json: any;
    for (let attempt = 1; ; attempt++) {
      const res = await shopifyFetchWithRetry(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": store.token,
        },
        body: JSON.stringify({
          query: ORDERS_QUERY,
          variables: { first: 100, after, query: `created_at:>='${sinceIso}'` },
        }),
        cache: "no-store",
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `Shopify ${store.code} HTTP ${res.status}: ${body.slice(0, 300)}`,
        );
      }
      json = await res.json();
      if (isThrottledGraphQLError(json) && attempt < MAX_RETRY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, throttleDelayMs(json, attempt)));
        continue;
      }
      if (json.errors) {
        throw new Error(
          `Shopify ${store.code} GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`,
        );
      }
      break;
    }

    const page = json.data.orders;
    orders.push(...page.nodes);
    if (onPage && page.nodes.length > 0) await onPage(page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  return orders;
}

// lib/integrations/shopify.ts — extended

const VARIANT_INVENTORY_QUERY = /* GraphQL */ `
  query VariantInventory($first: Int!, $after: String) {
    productVariants(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        sku
        inventoryQuantity
        image {
          url
        }
        product {
          id
          title
          status
          featuredImage {
            url
          }
        }
        inventoryItem {
          id
          tracked
          inventoryLevels(first: 20) {
            nodes {
              id
              quantities(names: ["available"]) {
                name
                quantity
              }
              location {
                id
                name
                isActive
                fulfillsOnlineOrders
                # Detects 3PL/fulfillment-service locations we can't write to.
                # If any of these is true we mark the row read-only.
                fulfillmentService {
                  serviceName
                  type
                }
              }
            }
          }
        }
      }
    }
  }
`;

export type ShopifyVariantMapRow = {
  store_id: ShopifyStoreCode;
  variant_id: string; // gid://shopify/ProductVariant/...
  sku: string;
  inventory_item_id: string; // gid://shopify/InventoryItem/...
  location_id: string; // gid://shopify/Location/...
  location_name: string;
  is_readonly: boolean; // true for fulfillment service locations
  fulfillment_service: string | null;
  product_status: string;
  tracked: boolean;
  inventoryQuantity: number | null;
  available: number;
  product: {
    id: string;
    title: string;
    status: string;
    featuredImage?: {
      url: string;
    } | null;
  } | null;

  image_url: string | null;
};

export async function fetchShopifyVariantBySku(
  store: ShopifyStoreConfig,
  sku: string,
): Promise<ShopifyVariantMapRow[]> {
  const skuNorm = sku.trim().toUpperCase();

  let json: any;

  try {
    json = await graphqlRequest(store, VARIANT_BY_SKU_QUERY, {
      query: `sku:${skuNorm}`,
    });
  } catch (error) {
    console.error(`[Shopify] Lookup failed ${store.code}/${skuNorm}`, error);

    return [];
  }

  const nodes = json.data?.productVariants?.nodes ?? [];

  console.log(
    `[Shopify] ${store.code}/${skuNorm} nodes:`,
    JSON.stringify(nodes, null, 2),
  );

  const node = nodes.find((v: any) => v.sku?.trim().toUpperCase() === skuNorm);

  if (!node) {
    console.log(`[Shopify] SKU not found: ${skuNorm}`);

    return [];
  }

  if (!node.inventoryItem?.tracked) {
    console.log(`[Shopify] SKU not tracked: ${skuNorm}`);

    return [];
  }

  const imageUrl = node.image?.url ?? node.product?.featuredImage?.url ?? null;

  const levels = node.inventoryItem?.inventoryLevels?.nodes ?? [];

  return levels
    .filter((level: any) => level.location?.isActive)
    .map((level: any) => {
      const location = level.location;

      const serviceName = location.fulfillmentService?.serviceName ?? null;

      const isReadonly = Boolean(serviceName) && serviceName !== "manual";

      const available =
        level.quantities?.find((q: any) => q.name === "available")?.quantity ??
        0;

      return {
        store_id: store.code,

        variant_id: node.id,

        sku: skuNorm,

        inventory_item_id: node.inventoryItem.id,

        location_id: location.id,

        location_name: location.name,

        is_readonly: isReadonly,

        fulfillment_service: serviceName,

        product_status: node.product?.status ?? "",

        tracked: node.inventoryItem.tracked,

        inventoryQuantity: null,

        product: node.product
          ? {
              id: node.product.id,
              title: node.product.title,
              status: node.product.status,
              featuredImage: node.product.featuredImage
                ? {
                    url: node.product.featuredImage.url,
                  }
                : null,
            }
          : null,

        available,

        image_url: imageUrl,
      };
    });
}
export async function fetchShopifyVariantMap(
  store: ShopifyStoreConfig,
): Promise<ShopifyVariantMapRow[]> {
  const endpoint = `${store.url}/admin/api/${API_VERSION}/graphql.json`;
  const rows: ShopifyVariantMapRow[] = [];
  let after: string | null = null;

  do {
    let json: any;
    for (let attempt = 1; ; attempt++) {
      const res = await shopifyFetchWithRetry(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": store.token,
        },
        body: JSON.stringify({
          query: VARIANT_INVENTORY_QUERY,
          variables: { first: 100, after },
        }),
        cache: "no-store",
      });
      if (!res.ok)
        throw new Error(
          `Shopify ${store.code} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`,
        );
      json = await res.json();
      if (isThrottledGraphQLError(json) && attempt < MAX_RETRY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, throttleDelayMs(json, attempt)));
        continue;
      }
      if (json.errors)
        throw new Error(
          `Shopify ${store.code} GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`,
        );
      break;
    }

    for (const v of json.data.productVariants.nodes) {
      const sku = v.sku ? v.sku.trim().toUpperCase() : "";
      if (!sku || !v.inventoryItem?.tracked) continue;
      for (const level of v.inventoryItem.inventoryLevels.nodes) {
        if (!level.location.isActive) continue;
        const svc = level.location.fulfillmentService?.serviceName ?? null;
        // Manual location is Shopify's default; anything else is a service integration
        // and typically read-only from Admin API's perspective.
        const isReadonly = Boolean(svc) && svc !== "manual";
        rows.push({
          store_id: store.code,
          variant_id: v.id,
          sku,
          inventory_item_id: v.inventoryItem.id,
          location_id: level.location.id,
          location_name: level.location.name,
          is_readonly: isReadonly,
          fulfillment_service: svc,
          product_status: v.product.status,
          tracked: v.inventoryItem.tracked,
          available: level.quantities?.[0]?.quantity ?? 0,
          inventoryQuantity: v.inventoryQuantity,
          product: v.product,
          image_url: v.image?.url ?? v.product?.featuredImage?.url ?? null,
        });
      }
    }

    after = json.data.productVariants.pageInfo.hasNextPage
      ? json.data.productVariants.pageInfo.endCursor
      : null;
  } while (after);

  return rows;
}

export const VARIANT_BY_SKU_QUERY = /* GraphQL */ `
  query VariantBySku($query: String!) {
    productVariants(first: 5, query: $query) {
      nodes {
        id
        sku
        image {
          url
        }

        product {
          id
          title
          status

          featuredImage {
            url
          }
        }
        inventoryItem {
          id
          tracked
          inventoryLevels(first: 20) {
            nodes {
              quantities(names: ["available"]) {
                name
                quantity
              }
              location {
                id
                name
                isActive
                fulfillmentService {
                  serviceName
                  type
                }
              }
            }
          }
        }
      }
    }
  }
`;

const INVENTORY_SET_MUTATION = /* GraphQL */ `
  mutation InventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup {
        createdAt
        changes {
          name
          delta
          quantityAfterChange
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

type ResolvedTarget = {
  variantId: string;
  inventoryItemId: string;
  locationId: string;
  locationName: string;
};

// Cache-first (shopify_variant_map) then live GraphQL fallback. Only
// returns a WRITABLE (is_readonly = false) location — a readonly hit
// is treated as "no writable target," never silently written anyway.
async function resolveWritableTarget(
  store: ShopifyStoreConfig,
  sku: string,
): Promise<
  { ok: true; target: ResolvedTarget } | { ok: false; reason: string }
> {
  const skuNorm = sku.trim().toUpperCase();

  const { data: cached } = await supabase
    .from("shopify_variant_map")
    .select(
      "variant_id, inventory_item_id, location_id, location_name, is_readonly",
    )
    .eq("store_id", store.code)
    .eq("sku", skuNorm)
    .order("synced_at", { ascending: false });

  const writableCached = (cached ?? []).find((r) => !r.is_readonly);
  if (writableCached) {
    return {
      ok: true,
      target: {
        variantId: writableCached.variant_id,
        inventoryItemId: writableCached.inventory_item_id,
        locationId: writableCached.location_id,
        locationName: writableCached.location_name ?? "",
      },
    };
  }

  const onlyReadonlyCached =
    (cached ?? []).length > 0 && (cached ?? []).every((r) => r.is_readonly);
  if (onlyReadonlyCached) {
    const names = (cached ?? []).map((r) => r.location_name).join(", ");
    return {
      ok: false,
      reason: `readonly_location: only fulfillment-service locations found (${names})`,
    };
  }

  // Cold cache — live lookup.
  let json: any;
  try {
    json = await graphqlRequest(store, VARIANT_BY_SKU_QUERY, {
      query: `sku:${skuNorm}`,
    });
  } catch (e) {
    return { ok: false, reason: `lookup_failed: ${(e as Error).message}` };
  }

  const node = json.data.productVariants.nodes.find(
    (v: any) => v.sku?.trim().toUpperCase() === skuNorm,
  );
  if (!node) return { ok: false, reason: "sku_not_found_on_store" };
  if (!node.inventoryItem?.tracked)
    return { ok: false, reason: "untracked_on_shopify" };

  const levels = node.inventoryItem.inventoryLevels.nodes.filter(
    (l: any) => l.location.isActive,
  );
  const writable = levels.find((l: any) => {
    const svc = l.location.fulfillmentService?.serviceName ?? null;
    return !svc || svc === "manual";
  });
  if (!writable) {
    const names = levels.map((l: any) => l.location.name).join(", ");
    return {
      ok: false,
      reason: `readonly_location: only fulfillment-service locations found (${names})`,
    };
  }

  const target: ResolvedTarget = {
    variantId: node.id,
    inventoryItemId: node.inventoryItem.id,
    locationId: writable.location.id,
    locationName: writable.location.name,
  };

  await supabase
    .from("shopify_variant_map")
    .upsert(
      {
        store_id: store.code,
        variant_id: target.variantId,
        sku: skuNorm,
        inventory_item_id: target.inventoryItemId,
        location_id: target.locationId,
        location_name: target.locationName,
        is_readonly: false,
        fulfillment_service: null,
        product_status: node.product?.status ?? null,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "store_id,variant_id,location_id" },
    )
    .then(undefined, () => {});

  return { ok: true, target };
}
export async function graphqlRequest(
  store: ShopifyStoreConfig,
  query: string,
  variables: Record<string, unknown>,
) {
  const endpoint = `${store.url}/admin/api/${API_VERSION}/graphql.json`;
  let json: any;
  for (let attempt = 1; ; attempt++) {
    const res = await shopifyFetchWithRetry(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": store.token,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
    if (!res.ok)
      throw new Error(
        `Shopify ${store.code} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    json = await res.json();
    if (isThrottledGraphQLError(json) && attempt < MAX_RETRY_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, throttleDelayMs(json, attempt)));
      continue;
    }
    if (json.errors)
      throw new Error(
        `Shopify ${store.code} GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`,
      );
    return json;
  }
}

export type ShopifyPushResult =
  | {
      ok: true;
      store: ShopifyStoreCode;
      fromQty: number | null;
      toQty: number;
      location: string;
    }
  | { ok: false; store: ShopifyStoreCode; reason: string };

// The actual write. inventorySetQuantities with ignoreCompareQuantity:true
// sets an absolute on-hand value — no need to know Shopify's current qty
// going in, which sidesteps compareQuantity race-condition rejections.
export async function pushShopifyInventoryQuantity(
  storeCode: ShopifyStoreCode,
  sku: string,
  targetQty: number,
  currentQtyInDb: number | null,
): Promise<ShopifyPushResult> {
  const store = getShopifyStores().find((s) => s.code === storeCode);
  if (!store)
    return { ok: false, store: storeCode, reason: "store_not_configured" };

  const resolved = await resolveWritableTarget(store, sku);
  if (!resolved.ok)
    return { ok: false, store: storeCode, reason: resolved.reason };

  const { inventoryItemId, locationId, locationName } = resolved.target;

  let json: any;
  try {
    json = await graphqlRequest(store, INVENTORY_SET_MUTATION, {
      input: {
        name: "available",
        reason: "correction",
        ignoreCompareQuantity: true,
        quantities: [{ inventoryItemId, locationId, quantity: targetQty }],
      },
    });
  } catch (e) {
    return {
      ok: false,
      store: storeCode,
      reason: `mutation_failed: ${(e as Error).message}`,
    };
  }

  const userErrors = json.data?.inventorySetQuantities?.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      ok: false,
      store: storeCode,
      reason: `shopify_rejected: ${userErrors.map((e: any) => e.message).join("; ")}`,
    };
  }

  return {
    ok: true,
    store: storeCode,
    fromQty: currentQtyInDb,
    toQty: targetQty,
    location: locationName,
  };
}
