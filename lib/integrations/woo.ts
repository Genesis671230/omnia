// WooCommerce REST v3 client. Only this file talks to WooCommerce.
import Bottleneck from "bottleneck";


const wooLimiter = new Bottleneck({
  reservoir: 20,                  // allow burst of 20 requests
  reservoirRefreshAmount: 20,
  reservoirRefreshInterval: 10_000, // refill every 10s
  maxConcurrent: 2,
});

async function wooFetch(url: string, init?: RequestInit) {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await wooLimiter.schedule(() => fetch(url, init));
      if (response.status !== 429 && response.status < 500) return response;
      if (attempt === maxAttempts) return response;

      const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? "0");
      const delayMs = retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : 250 * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Woo request failed");
}
export type WooRawOrder = {
  id: number;
  number: string;
  status: string; // processing / completed / refunded ...
  currency: string;
  date_created: string;
  total: string;
  shipping_total: string;
  total_tax: string;
  discount_total: string;
  payment_method: string; // e.g. "telr"
  payment_method_title: string; // e.g. "Credit / Debit Card (Telr)"
  billing: {
    first_name: string;
    last_name: string;
    company: string;
    address_1: string;
    address_2: string;
    city: string;
    state: string;
    postcode: string;
    country: string;
    email: string;
    phone: string;
  };
  shipping: {
    first_name: string;
    last_name: string;
    company: string;
    address_1: string;
    address_2: string;
    city: string;
    state: string;
    postcode: string;
    country: string;
  };
  meta_data: { key: string; value: unknown }[];
  line_items: {
    name: string;
    sku: string | null;
    quantity: number;
    total: string;
    product_id: number;
    image?: { id: number | string; src: string } | null;
  }[];
  shipping_lines?: { method_title: string }[];
};

export function wooConfigured(): boolean {
  return Boolean(process.env.WOO_URL && process.env.WOO_CONSUMER_KEY && process.env.WOO_CONSUMER_SECRET);
}

export async function fetchWooOrders(
  sinceIso: string,
  onPage?: (orders: WooRawOrder[]) => Promise<void>,
): Promise<WooRawOrder[]> {
  const base = (process.env.WOO_URL || "").replace(/\/+$/, "");
  const auth = Buffer.from(
    `${process.env.WOO_CONSUMER_KEY}:${process.env.WOO_CONSUMER_SECRET}`,
  ).toString("base64");

  const orders: WooRawOrder[] = [];
  let page = 1;
  // Woo caps per_page at 100; paginate until a short page.
  for (;;) {
    const url = `${base}/wp-json/wc/v3/orders?after=${encodeURIComponent(sinceIso)}&per_page=100&page=${page}&orderby=date&order=desc`;
    const res = await wooFetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Woo HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const batch = (await res.json()) as WooRawOrder[];
    orders.push(...batch);
    if (onPage && batch.length > 0) await onPage(batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return orders;
}

// Live pre-flight check: fires `n` real, cheap GET requests through the
// SAME limiter/wooFetch the real sync/backfill uses, so a PASS here is
// evidence the actual code path tolerates the load — not a re-implemented
// stand-in for it. per_page=1 keeps each request trivial; only timing and
// status matter here, not the data.
export async function testWooRateLimit(n = 50): Promise<{
  n: number;
  ok: number;
  failed: number;
  statuses: number[];
  durationMs: number;
}> {
  const base = (process.env.WOO_URL || "").replace(/\/+$/, "");
  const auth = Buffer.from(
    `${process.env.WOO_CONSUMER_KEY}:${process.env.WOO_CONSUMER_SECRET}`,
  ).toString("base64");
  const url = `${base}/wp-json/wc/v3/orders?per_page=1&page=1`;

  const start = Date.now();
  const statuses: number[] = await Promise.all(
    Array.from({ length: n }, async () => {
      try {
        const res = await wooFetch(url, { headers: { Authorization: `Basic ${auth}` }, cache: "no-store" });
        return res.status;
      } catch {
        return 0; // network-level failure, no HTTP status
      }
    }),
  );
  const durationMs = Date.now() - start;
  const ok = statuses.filter((s) => s >= 200 && s < 300).length;
  return { n, ok, failed: n - ok, statuses, durationMs };
}

export type WooProduct = {
  id: number;
  parent_id?: number;
  variation_id?: number;
  type: string;
  sku: string;
  name: string;
  stock_quantity: number | null;
  manage_stock: boolean;
  status: string;
  purchasable?: boolean;
};

type WooProductResponse = Omit<WooProduct, "variation_id">;

async function fetchWooProductPage(url: string): Promise<WooProductResponse[]> {
  const auth = Buffer.from(
    `${process.env.WOO_CONSUMER_KEY}:${process.env.WOO_CONSUMER_SECRET}`,
  ).toString("base64");
  const response = await wooFetch(url, {
    headers: { Authorization: `Basic ${auth}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Woo HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  return (await response.json()) as WooProductResponse[];
}

async function fetchWooVariations(base: string, productId: number): Promise<WooProduct[]> {
  const variations: WooProduct[] = [];
  for (let page = 1; ; page += 1) {
    const url = `${base}/wp-json/wc/v3/products/${productId}/variations?status=publish&per_page=100&page=${page}&orderby=id&order=asc`;
    const batch = await fetchWooProductPage(url);
    variations.push(...batch
      .filter((variation) => variation.status === "publish")
      .map((variation) => ({
        ...variation,
        type: "variation",
        parent_id: productId,
        variation_id: variation.id,
      })));
    if (batch.length < 100) break;
  }
  return variations;
}

// Live stock per SKU, independent of orders.
export async function fetchWooProducts(): Promise<WooProduct[]> {
  const base = (process.env.WOO_URL || "").replace(/\/+$/, "");
  const parents: WooProductResponse[] = [];
  let page = 1;
  for (;;) {
    const url = `${base}/wp-json/wc/v3/products?status=publish&per_page=100&page=${page}&orderby=id&order=asc`;
    const batch = await fetchWooProductPage(url);
    parents.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  const productGroups = await Promise.all(parents.map(async (parent): Promise<WooProduct[]> => {
    if (parent.type === "variable") {
      return fetchWooVariations(base, parent.id);
    }
    if (parent.type === "external" || parent.type === "grouped") return [];
    if (parent.status !== "publish") return [];
    return [{ ...parent, variation_id: undefined }];
  }));
  return productGroups.flat();
}

// Telr refs live in Woo order meta; key names vary by plugin version.
export function telrRefsFromMeta(meta: WooRawOrder["meta_data"]): { cartId: string; tranref: string } {
  let cartId = "";
  let tranref = "";
  for (const m of meta || []) {
    const k = m.key.toLowerCase();
    const v = typeof m.value === "string" ? m.value : "";
    if (!cartId && (k.includes("cart_id") || k.includes("cartid"))) cartId = v;
    if (!tranref && (k.includes("tranref") || k.includes("tran_ref"))) tranref = v;
  }
  return { cartId, tranref };
}
