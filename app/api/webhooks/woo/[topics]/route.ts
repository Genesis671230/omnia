// app/api/webhooks/woo/[topic]/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { normalizeSku } from "@/lib/sku";
import { logStockEvent } from "@/lib/stock-events";
import { reconcile } from "@/lib/reconciler";
import { supabase } from "@/lib/supabase";
import { markHeartbeat, alreadyProcessed } from "@/lib/webhook-plumbing";
import { ingestWooOrderWebhook } from "@/lib/sync/order-webhook-ingest";

export const maxDuration = 30;
function verifyWooSignature(raw: string, header: string | null): boolean {
  if (!header) return false;

  console.log(header)
  const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET!;
  const digest = crypto.createHmac("sha256", secret).update(raw,"utf-8").digest("base64");
  // Length differences would throw in timingSafeEqual — normalize first.
  const a = Buffer.from(header);
  const b = Buffer.from(digest);
  console.log(a,b,a.length === b.length)
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request, { params }: { params: { topics: string } }) {

  const { topics } = await params;
  const raw = await req.text();
  console.log(raw,"we have this data")
   const sig = req.headers.get("x-wc-webhook-signature");
    const webhookId = req.headers.get("x-wc-webhook-id") ?? "";
    const deliveryId = req.headers.get("x-wc-webhook-delivery-id") ?? "";
  console.log(webhookId,deliveryId,"we got the data here to play with")
    // Woo pings with an empty body when saving the webhook — accept those quietly.
    if (raw.length === 0) return NextResponse.json({ ok: true });
    if (!verifyWooSignature(raw, sig)) {
        return NextResponse.json({ error: "bad signature" }, { status: 401 });
      }
      
      console.log(raw.length,"we got thelength",topics,"deliveryId",deliveryId)
      // Dedup on delivery ID. Same event replayed = no-op.
      if (deliveryId && await alreadyProcessed("woo", deliveryId)) {
        return NextResponse.json({ ok: true, dedup: true });
      }
      
      await markHeartbeat("woo", topics, deliveryId);
      
    const payload = JSON.parse(raw);
  console.log(payload,"here is payload")
  
    try {
      if (topics === "product-updated" || topics === "product-restored") {
  console.log("we are updating the products")
  await handleWooProductUpdate(payload);
      } else if (topics === "product-deleted") {
        await handleWooProductDelete(payload);
      } else if (topics === "order-created") {
        await handleWooOrderCreated(payload);
      } else if (topics === "order-updated") {
        // Fires on status changes — process refunds/cancels here.
        await handleWooOrderUpdated(payload);
      }
    } catch (e) {
      // Log but return 200. Woo doesn't retry; we'll catch missed changes on
      // the next scanner pass.
    }  
  return NextResponse.json({ ok: true });
}

async function handleWooProductUpdate(payload: any) {
  // Woo product update can carry a parent + variations. Handle both flat and
  // variable-product shapes.
  const items: { sku: string; qty: number | null; status: string; product_id: number; variation_id?: number }[] = [];

  if (payload.type === "variable" && Array.isArray(payload.variations)) {
    // The variations array is IDs, not embedded. For accuracy, treat this
    // as a signal to bulk-refresh variations, don't trust the parent's stock.
    items.push({ sku: normalizeSku(payload.sku), qty: null, status: payload.status, product_id: payload.id });
  } else {
    items.push({
      sku: normalizeSku(payload.sku),
      qty: payload.manage_stock ? payload.stock_quantity : null,
      status: payload.status,
      product_id: payload.id,
      variation_id: payload.parent_id ? payload.id : undefined,
    });
  }

  for (const it of items) {
    if (!it.sku) continue;
    await supabase.from("woo_product_map").upsert({
      sku: it.sku, product_id: it.product_id, variation_id: it.variation_id ?? null,
      product_status: it.status, synced_at: new Date().toISOString(),
    }, { onConflict: "sku" });

    if (it.qty != null) {
      await supabase.from("store_inventory").upsert({
        id: `WOO|${it.sku}`, tenant_id: process.env.DEFAULT_TENANT_ID || "omnia",
        store_id: "WOO", sku: it.sku, quantity: it.qty,
        product_title: payload.name ?? "", product_status: it.status,
        synced_at: new Date().toISOString(),
      }, { onConflict: "id" });

      await logStockEvent({
        sku: it.sku, source: "woo", event_type: "snapshot", new_qty: it.qty,
        raw: { product_id: it.product_id }, occurred_at: new Date(),
      });

      await reconcile(it.sku, { trigger: "webhook:woo:product-updated" });
    }
  }
}

async function handleWooOrderCreated(payload: any) {
  // Instant path: normalize + upsert into `orders` + alert, right now,
  // instead of waiting for the next 2-minute order-sync-scheduler poll.
  // Best-effort — a failure here must not block the inventory-decrement
  // logic below, which is this handler's original job.
  try {
    await ingestWooOrderWebhook(payload);
  } catch (e) {
    console.error("[wh:woo] instant order ingest failed:", (e as Error).message);
  }

  // Every line item creates a pending_zoho_sync row + a decrement event.
  for (const li of payload.line_items ?? []) {
    const sku = normalizeSku(li.sku);
    if (!sku) continue;
    await supabase.from("pending_zoho_sync").upsert({
      sku, origin_channel: "woo", expected_delta: -li.quantity,
      order_ref: String(payload.id),
    }, { onConflict: "sku,origin_channel,order_ref" });

    await logStockEvent({
      sku, source: "woo", event_type: "order_decrement",
      delta: -li.quantity, correlation: String(payload.id),
      // date_created is WooCommerce site-local time (Asia/Dubai, UTC+4); use
      // the _gmt variant so this timestamp is true UTC like everywhere else.
      occurred_at: new Date(payload.date_created_gmt ?? Date.now()),
      raw: { order_id: payload.id },
    });

    await reconcile(sku, { trigger: "webhook:woo:order-created" });
  }
}

async function handleWooOrderUpdated(payload: any) {
  // Keep the orders table's financial_status current (e.g. pending -> paid)
  // — sendNewOrderAlerts' own dedup means this never re-sends the original
  // alert, it just refreshes the row (and catches up the dispatch sheet if
  // that hasn't happened yet for this order).
  try {
    await ingestWooOrderWebhook(payload);
  } catch (e) {
    console.error("[wh:woo] instant order update ingest failed:", (e as Error).message);
  }

  // Refunds/cancellations UNDO the decrement. On status change to refunded
  // or cancelled, clear the pending row and issue a compensating event.
  if (payload.status === "cancelled" || payload.status === "refunded") {
    for (const li of payload.line_items ?? []) {
      const sku = normalizeSku(li.sku);
      if (!sku) continue;
      await supabase.from("pending_zoho_sync")
        .update({ cleared_at: new Date().toISOString(), cleared_by: "order_cancelled" })
        .eq("sku", sku).eq("origin_channel", "woo").eq("order_ref", String(payload.id));
      await logStockEvent({
        sku, source: "woo", event_type: "refund",
        delta: +li.quantity, correlation: String(payload.id),
        occurred_at: new Date(), raw: { order_id: payload.id, status: payload.status },
      });
      await reconcile(sku, { trigger: "webhook:woo:order-updated" });
    }
  }
}

async function handleWooProductDelete(payload: any) {
  // Product removed from store — set store_inventory quantity null (unlisted),
  // don't touch Zoho. Alert if this happens outside a maintenance window.
  const sku = normalizeSku(payload.sku ?? "");
  if (!sku) return;
  await supabase.from("store_inventory").update({
    quantity: null, product_status: "DELETED", synced_at: new Date().toISOString(),
  }).eq("id", `WOO|${sku}`);
  await supabase.from("stock_alerts").upsert({
    sku, kind: "missing_from_channel", detail: { channel: "woo", reason: "product_deleted" },
  }, { onConflict: "sku,kind" });
}