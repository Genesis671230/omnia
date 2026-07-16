// WooCommerce REST v3 client. Only this file talks to WooCommerce.

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
  billing: { first_name: string; last_name: string; email: string; city: string; country: string; phone: string };
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

export async function fetchWooOrders(sinceIso: string): Promise<WooRawOrder[]> {
  const base = (process.env.WOO_URL || "").replace(/\/+$/, "");
  const auth = Buffer.from(
    `${process.env.WOO_CONSUMER_KEY}:${process.env.WOO_CONSUMER_SECRET}`,
  ).toString("base64");

  const orders: WooRawOrder[] = [];
  let page = 1;
  // Woo caps per_page at 100; paginate until a short page.
  for (;;) {
    const url = `${base}/wp-json/wc/v3/orders?after=${encodeURIComponent(sinceIso)}&per_page=100&page=${page}&orderby=date&order=desc`;
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Woo HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const batch = (await res.json()) as WooRawOrder[];
    orders.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return orders;
}

export type WooProduct = {
  id: number;
  sku: string;
  name: string;
  stock_quantity: number | null;
  manage_stock: boolean;
  status: string;
};

// Live stock per SKU, independent of orders.
export async function fetchWooProducts(): Promise<WooProduct[]> {
  const base = (process.env.WOO_URL || "").replace(/\/+$/, "");
  const auth = Buffer.from(
    `${process.env.WOO_CONSUMER_KEY}:${process.env.WOO_CONSUMER_SECRET}`,
  ).toString("base64");

  const products: WooProduct[] = [];
  let page = 1;
  for (;;) {
    const url = `${base}/wp-json/wc/v3/products?per_page=100&page=${page}&orderby=id&order=asc`;
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Woo HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const batch = (await res.json()) as WooProduct[];
    products.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return products;
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
