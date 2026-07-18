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
        shippingAddress { city countryCodeV2 phone }
        billingAddress { phone }
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
  shippingAddress: { city: string | null; countryCodeV2: string | null; phone: string | null } | null;
  billingAddress: { phone: string | null } | null;
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
    const res: Response = await fetch(endpoint, {
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
    const json = await res.json();
    if (json.errors) {
      throw new Error(`Shopify ${store.code} GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`);
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
): Promise<ShopifyRawOrder[]> {
  const endpoint = `${store.url}/admin/api/${API_VERSION}/graphql.json`;
  const orders: ShopifyRawOrder[] = [];
  let after: string | null = null;

  do {
    const res: Response = await fetch(endpoint, {
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
    const json = await res.json();
    if (json.errors) {
      throw new Error(`Shopify ${store.code} GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`);
    }

    const page = json.data.orders;
    orders.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  return orders;
}
