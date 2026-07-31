// app/api/webhooks/woo/[topic]/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { normalizeSku } from "@/lib/sku";
import { logStockEvent } from "@/lib/stock-events";
import { reconcile } from "@/lib/reconciler";
import { supabase } from "@/lib/supabase";
import { markHeartbeat, alreadyProcessed } from "@/lib/webhook-plumbing";

export const maxDuration = 30;

function verifyWooSignature(raw: string, header: string | null): boolean {
  if (!header) return false;
  const secret = process.env.WOO_CONSUMER_SECRET!;
  const digest = crypto.createHmac("sha256", secret).update(raw).digest("base64");
  // Length differences would throw in timingSafeEqual — normalize first.
  const a = Buffer.from(header);
  const b = Buffer.from(digest);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request, { params }: { params: { topic: string } }) {
  const raw = await req.text();
  const sig = req.headers.get("x-wc-webhook-signature");
  const webhookId = req.headers.get("x-wc-webhook-id") ?? "";
  const deliveryId = req.headers.get("x-wc-webhook-delivery-id") ?? "";

  // Woo pings with an empty body when saving the webhook — accept those quietly.
  if (raw.length === 0) return NextResponse.json({ ok: true });

  if (!verifyWooSignature(raw, sig)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  // Dedup on delivery ID. Same event replayed = no-op.
  if (deliveryId && await alreadyProcessed("woo", deliveryId)) {
    return NextResponse.json({ ok: true, dedup: true });
  }

  await markHeartbeat("woo", params.topic, deliveryId);

  const payload = JSON.parse(raw);

  try {
    if (params.topic === "product-updated" || params.topic === "product-restored") {
      await handleWooProductUpdate(payload);
    } else if (params.topic === "product-deleted") {
      await handleWooProductDelete(payload);
    } else if (params.topic === "order-created") {
      await handleWooOrderCreated(payload);
    } else if (params.topic === "order-updated") {
      // Fires on status changes — process refunds/cancels here.
      await handleWooOrderUpdated(payload);
    }
  } catch (e) {
    // Log but return 200. Woo doesn't retry; we'll catch missed changes on
    // the next scanner pass.
    console.error(`woo webhook ${params.topic} failed:`, (e as Error).message);
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
      occurred_at: new Date(payload.date_created ?? Date.now()),
      raw: { order_id: payload.id },
    });

    await reconcile(sku, { trigger: "webhook:woo:order-created" });
  }
}

async function handleWooOrderUpdated(payload: any) {
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