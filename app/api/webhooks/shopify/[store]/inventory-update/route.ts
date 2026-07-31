// app/api/webhooks/shopify/[store]/inventory-update/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { normalizeSku } from "@/lib/sku";
import { logStockEvent } from "@/lib/stock-events";
import { reconcile } from "@/lib/reconciler";
import { StoreInventoryRepository } from "@/lib/repositories/store-inventory.repository";
import { lookupSkuByInventoryItemId } from "@/lib/lookup-sku";
import { ShopifyStoreCode } from "@/lib/integrations/shopify";

export const maxDuration = 30;

const STORE_SECRETS: Record<string, string | undefined> = {
  UAE: process.env.SHOPIFY_UAE_SECRET,
  KSA: process.env.SHOPIFY_KSA_SECRET,
  WA:  process.env.SHOPIFY_WA_SECRET,
};

export async function POST(req: Request, { params }: { params: { store: string } }) {
  const storeParam =await params
  const store = storeParam.store.toUpperCase();
  console.log(store,"we have events")
  const secret = STORE_SECRETS[store];
  if (!secret) return NextResponse.json({ error: "unknown store" }, { status: 404 });
  // HMAC first — reject before touching DB.
  const raw = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256") || "";
  const digest = crypto.createHmac("sha256", secret).update(raw).digest("base64");
  if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(digest))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const payload = JSON.parse(raw);
  // Shopify inventory_levels/update gives inventory_item_id, not SKU directly.
  // Resolve via the shopify_variant_map you already have (or a fresh
  // productVariants query if it isn't cached). Assume `lookupSkuByInventoryItemId`
  // exists — 200-line helper, cache hit rate should be >99%.
  const sku = await lookupSkuByInventoryItemId(store as ShopifyStoreCode, payload.inventory_item_id);
if (!sku) {
  // Real case — Shopify product has no SKU. Log and drop, don't reconcile.
  await logStockEvent({
    sku: "__UNKNOWN__", source: `shopify_${store.toLowerCase()}` as any,
    event_type: "webhook_reject",
    raw: { reason: "no_sku_for_inventory_item", inventory_item_id: payload.inventory_item_id },
    occurred_at: new Date(),
  });
  return NextResponse.json({ ok: true, skipped: "no_sku" });
}

  // Write the fact FIRST — the reconcile might fail, but the event log is truth.
  await logStockEvent({
    sku, source: `shopify_${store.toLowerCase()}`,
    event_type: "snapshot", new_qty: payload.available, raw: payload,
    occurred_at: new Date(payload.updated_at ?? Date.now()),
  });

  // Update our cached snapshot for this channel — reconciler reads from cache,
  // never from Shopify's API during a reconcile.
  await StoreInventoryRepository.upsertMany([{
    storeId: store as any, sku, quantity: payload.available,
    productTitle: "", productStatus: "ACTIVE",
  }]);

  // Fast path: reconcile inline. Returns quickly if nothing drifted.
  // On failure, reconcile() enqueues a task instead of throwing.
  await reconcile(sku, { trigger: `webhook:shopify_${store.toLowerCase()}` });

  return NextResponse.json({ ok: true });
}