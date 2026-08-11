// app/api/webhooks/shopify/[store]/orders-create/route.ts
// Instant order ingestion — fires the moment Shopify creates an order,
// instead of waiting for the next 2-minute order-sync-scheduler poll (which
// stays running as the safety net for anything this misses).
import { NextResponse } from "next/server";
import crypto from "crypto";
import { alreadyProcessed } from "@/lib/webhook-plumbing";
import { ingestShopifyOrderWebhook } from "@/lib/sync/order-webhook-ingest";
import type { ShopifyStoreCode } from "@/lib/integrations/shopify";

export const maxDuration = 30;

const STORE_SECRETS: Record<string, string | undefined> = {
  UAE: process.env.SHOPIFY_UAE_WEBHOOK_SECRET,
  KSA: process.env.SHOPIFY_KSA_WEBHOOK_SECRET,
  WA: process.env.SHOPIFY_WA_WEBHOOK_SECRET,
};

export async function POST(req: Request, { params }: { params: { store: string } }) {
  const { store: storeParam } = await params;
  const store = storeParam.toUpperCase();

  const raw = await req.text();
  const headerHmac = req.headers.get("x-shopify-hmac-sha256") ?? "";
  const webhookId = req.headers.get("x-shopify-webhook-id") ?? "";
  const secret = STORE_SECRETS[store];

  const devBypass =
    process.env.NODE_ENV !== "production" &&
    req.headers.get("x-dev-webhook-bypass") === process.env.DEV_WEBHOOK_TOKEN;

  if (!devBypass) {
    if (!secret) return NextResponse.json({ error: "not configured" }, { status: 500 });
    const digest = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("base64");
    const a = Buffer.from(headerHmac, "base64");
    const b = Buffer.from(digest, "base64");
    if (!(a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b))) {
      return NextResponse.json({ error: "bad signature" }, { status: 401 });
    }
  }

  if (webhookId && (await alreadyProcessed(`shopify-orders-create-${store}`, webhookId))) {
    return NextResponse.json({ ok: true, dedup: true });
  }

  try {
    await ingestShopifyOrderWebhook(store as ShopifyStoreCode);
  } catch (e) {
    // Log but return 200 — Shopify retries on non-2xx, and the next poll
    // cycle catches anything a failed ingest missed anyway.
    console.error(`[wh:shopify:${store}] orders-create ingest failed:`, (e as Error).message);
  }
  return NextResponse.json({ ok: true });
}
