// scripts/register-shopify-webhooks.ts
import { getShopifyStores } from "@/lib/integrations/shopify";

const APP_BASE = process.env.APP_BASE_URL!; // e.g. https://finance.omnia.io
const API = process.env.SHOPIFY_API_VERSION || "2024-04";

const TOPICS = [
  "inventory_levels/update",
  "orders/create",
  "orders/paid",
  "orders/cancelled",
  "refunds/create",
  "products/update",
  "products/delete",
];

async function registerOne(storeCode: string, url: string, token: string, topic: string) {
  const address = `${APP_BASE}/api/webhooks/shopify/${storeCode.toLowerCase()}/${topic.replace("/", "-")}`;
  const res = await fetch(`${url}/admin/api/${API}/webhooks.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ webhook: { topic, address, format: "json" } }),
  });
  const body = await res.json();
  console.log(`[${storeCode}] ${topic} → ${res.status}`, body.errors ?? body.webhook?.id);
}

for (const store of getShopifyStores()) {
  for (const topic of TOPICS) {
    await registerOne(store.code, store.url, store.token, topic);
  }
}