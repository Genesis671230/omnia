// app/api/webhooks/shopify/[store]/orders-paid/route.ts
// Same instant path as orders-create — fires on the payment-confirmed
// transition, so financial_status flips to "paid" in the orders table (and
// the dispatch sheet catches up if it hadn't already) without waiting for
// the next poll cycle.
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

  if (webhookId && (await alreadyProcessed(`shopify-orders-paid-${store}`, webhookId))) {
    return NextResponse.json({ ok: true, dedup: true });
  }

  try {
    await ingestShopifyOrderWebhook(store as ShopifyStoreCode);
  } catch (e) {
    console.error(`[wh:shopify:${store}] orders-paid ingest failed:`, (e as Error).message);
  }
  return NextResponse.json({ ok: true });
}
