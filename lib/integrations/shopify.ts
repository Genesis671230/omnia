// Shopify Admin GraphQL client — one client, three stores (WA / UAE / KSA).
// Only this file talks to Shopify. Tokens come from env, never hardcoded.

export type ShopifyStoreCode = "WA" | "UAE" | "KSA";

export type ShopifyStoreConfig = {
  code: ShopifyStoreCode;
  url: string; // https://xxx.myshopify.com
  token: string;
};

export function getShopifyStores(): ShopifyStoreConfig[] {
  const defs: { code: ShopifyStoreCode; url?: string; token?: string }[] = [
    { code: "WA", url: process.env.SHOPIFY_WA_URL, token: process.env.SHOPIFY_WA_TOKEN },
    { code: "UAE", url: process.env.SHOPIFY_UAE_URL, token: process.env.SHOPIFY_UAE_TOKEN },
    { code: "KSA", url: process.env.SHOPIFY_KSA_URL, token: process.env.SHOPIFY_KSA_TOKEN },
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

async function shopifyFetchWithRetry(endpoint: string, init: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(endpoint, init);
    if (res.status !== 429 || attempt >= MAX_RETRY_ATTEMPTS) return res;
    const retryAfter = Number(res.headers.get("Retry-After")) || Math.min(2 ** attempt, 30);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
  }
}

// GraphQL-level throttling returns HTTP 200 with errors[].extensions.code
// === "THROTTLED" — distinct from the HTTP 429 case above, handled at each
// call site since it requires re-issuing the same POST body.
function isThrottledGraphQLError(json: any): boolean {
  return Array.isArray(json?.errors) && json.errors.some((e: any) => e?.extensions?.code === "THROTTLED");
}

function throttleDelayMs(json: any, attempt: number): number {
  const restoreRate = json?.errors?.[0]?.extensions?.cost?.throttleStatus?.restoreRate;
  if (typeof restoreRate === "number" && restoreRate > 0) return Math.ceil(1000 / restoreRate) + 250;
  return Math.min(2 ** attempt, 30) * 1000;
}

// Everything the finance OS needs from an order, in one page-sized query.
const ORDERS_QUERY = /* GraphQL */ `
  query FinanceOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        createdAt
        email
        displayFinancialStatus
        displayFulfillmentStatus
        paymentGatewayNames
        customer { displayName phone defaultAddress { phone } }
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
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        currentSubtotalPriceSet { shopMoney { amount } }
        totalShippingPriceSet { shopMoney { amount } }
        currentTotalTaxSet { shopMoney { amount } }
        currentTotalDiscountsSet { shopMoney { amount } }
        fulfillments { trackingInfo { company number url } }
        lineItems(first: 25) {
          nodes {
            title
            sku
            quantity
            discountedTotalSet { shopMoney { amount } }
            product { id }
            image { url }
            variant { inventoryQuantity }
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
  customer: { displayName: string; phone: string | null; defaultAddress: { phone: string | null } | null } | null;
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
  fulfillments: { trackingInfo: { company: string | null; number: string | null; url: string | null }[] }[] | null;
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
      pageInfo { hasNextPage endCursor }
      nodes {
        sku
        inventoryQuantity
        product { title status }
      }
    }
  }
`;

export type ShopifyInventoryRow = {
  sku: string | null;
  inventoryQuantity: number | null;
  product: { title: string; status: string } | null;
};

export async function fetchShopifyInventory(store: ShopifyStoreConfig): Promise<ShopifyInventoryRow[]> {
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
        body: JSON.stringify({ query: INVENTORY_QUERY, variables: { first: 250, after } }),
        cache: "no-store",
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Shopify ${store.code} HTTP ${res.status}: ${body.slice(0, 300)}`);
      }
      json = await res.json();
      if (isThrottledGraphQLError(json) && attempt < MAX_RETRY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, throttleDelayMs(json, attempt)));
        continue;
      }
      if (json.errors) {
        throw new Error(`Shopify ${store.code} GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`);
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
        throw new Error(`Shopify ${store.code} HTTP ${res.status}: ${body.slice(0, 300)}`);
      }
      json = await res.json();
      if (isThrottledGraphQLError(json) && attempt < MAX_RETRY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, throttleDelayMs(json, attempt)));
        continue;
      }
      if (json.errors) {
        throw new Error(`Shopify ${store.code} GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`);
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
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        sku
        inventoryQuantity
        product { id title status }
        inventoryItem {
          id
          tracked
          inventoryLevels(first: 20) {
            nodes {
              id
              quantities(names: ["available"]) { name quantity }
              location {
                id
                name
                isActive
                fulfillsOnlineOrders
                # Detects 3PL/fulfillment-service locations we can't write to.
                # If any of these is true we mark the row read-only.
                fulfillmentService { serviceName type }
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
  variant_id: string;                      // gid://shopify/ProductVariant/...
  sku: string;
  inventory_item_id: string;               // gid://shopify/InventoryItem/...
  location_id: string;                     // gid://shopify/Location/...
  location_name: string;
  is_readonly: boolean;                    // true for fulfillment service locations
  fulfillment_service: string | null;
  product_status: string;
  tracked: boolean;
  inventoryQuantity: number | null;
  product: { title: string; status: string } | null;
  available: number;
};

export async function fetchShopifyVariantMap(store: ShopifyStoreConfig): Promise<ShopifyVariantMapRow[]> {
  const endpoint = `${store.url}/admin/api/${API_VERSION}/graphql.json`;
  const rows: ShopifyVariantMapRow[] = [];
  let after: string | null = null;

  do {
    let json: any;
    for (let attempt = 1; ; attempt++) {
      const res = await shopifyFetchWithRetry(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": store.token },
        body: JSON.stringify({ query: VARIANT_INVENTORY_QUERY, variables: { first: 100, after } }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Shopify ${store.code} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      json = await res.json();
      if (isThrottledGraphQLError(json) && attempt < MAX_RETRY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, throttleDelayMs(json, attempt)));
        continue;
      }
      if (json.errors) throw new Error(`Shopify ${store.code} GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`);
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
          product: v.product
        });
      }
    }

    after = json.data.productVariants.pageInfo.hasNextPage
      ? json.data.productVariants.pageInfo.endCursor : null;
  } while (after);

  return rows;
}