import { supabase } from "@/lib/supabase";
import { logStockEvent } from "@/lib/stock-events";

function wooAuth(): string {
  const key = process.env.WOO_CONSUMER_KEY!;
  const secret = process.env.WOO_CONSUMER_SECRET!;
  return "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
}

async function resolveWooTarget(sku: string) {
  const { data, error } = await supabase
    .from("woo_product_map")
    .select("product_id, variation_id, product_status")
    .eq("sku", sku)
    .maybeSingle();
  if (error) throw new Error(`woo_product_map read: ${error.message}`);
  if (!data) throw new Error(`woo: no product for SKU ${sku}`);
  if (data.product_status && data.product_status !== "publish") {
    throw new Error(`woo: SKU ${sku} on ${data.product_status} product, skipping`);
  }
  return data;
}

export async function pushWoo(sku: string, targetQuantity: number): Promise<void> {
  const base = process.env.WOO_URL!.replace(/\/+$/, "");
  const target = await resolveWooTarget(sku);

  // Variations sit at a different endpoint — /products/{parent}/variations/{id}.
  const url = target.variation_id
    ? `${base}/wp-json/wc/v3/products/${target.product_id}/variations/${target.variation_id}`
    : `${base}/wp-json/wc/v3/products/${target.product_id}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: wooAuth() },
    body: JSON.stringify({ manage_stock: true, stock_quantity: targetQuantity }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`woo push HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  await logStockEvent({
    sku, source: "woo", event_type: "reconcile_push",
    new_qty: targetQuantity, occurred_at: new Date(),
    raw: { url, targetQuantity },
  });
}