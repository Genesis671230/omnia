// app/api/webhooks/zoho/[topic]/route.ts
import { NextResponse } from "next/server";
import { normalizeSku } from "@/lib/sku";
import { logStockEvent } from "@/lib/stock-events";
import { reconcile } from "@/lib/reconciler";
import { supabase } from "@/lib/supabase";
import { markHeartbeat } from "@/lib/webhook-plumbing";

export const maxDuration = 30;

export async function POST(req: Request, { params }: { params: { topic: string } }) {
  // Shared secret in header — set as custom header in Zoho workflow rule.
  const secret = req.headers.get("x-zoho-shared-secret");
  if (secret !== process.env.ZOHO_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = await req.json();
  await markHeartbeat("zoho", params.topic, payload?.item_id ?? payload?.salesorder_id ?? "");

  if (params.topic === "item-updated") {
    const sku = normalizeSku(payload.sku);
    if (!sku) return NextResponse.json({ ok: true });

    // Update our cache immediately; this is the freshest Zoho number.
    await supabase.from("zoho_items").update({
      stock_on_hand: Number(payload.stock_on_hand ?? 0),
      available_stock: Number(payload.available_stock ?? 0),
      synced_at: new Date().toISOString(),
    }).eq("sku", sku);

    await logStockEvent({
      sku, source: "zoho", event_type: "snapshot",
      new_qty: Number(payload.available_stock ?? 0),
      raw: payload, occurred_at: new Date(),
    });

    // Zoho catching up = clear any pending rows whose expected decrement now
    // matches Zoho's move. This is the trigger that releases the lag lock.
    await supabase.from("pending_zoho_sync")
      .update({ cleared_at: new Date().toISOString(), cleared_by: "zoho_webhook" })
      .eq("sku", sku).is("cleared_at", null);

    await reconcile(sku, { trigger: "webhook:zoho:item-updated" });
    return NextResponse.json({ ok: true });
  }

  if (params.topic === "invoice-created" || params.topic === "shipment-created") {
    // These are the moments Zoho actually decrements stock. If the item-updated
    // hook fires reliably we don't strictly need these — kept as defense in depth.
    for (const li of payload.line_items ?? []) {
      const sku = normalizeSku(li.sku);
      if (!sku) continue;
      await reconcile(sku, { trigger: `webhook:zoho:${params.topic}` });
    }
  }

  if (params.topic === "inventoryadjustment-created") {
    // Ops manually adjusted stock — same effect as item-updated, but log
    // event_type=manual_adjust so audit shows human intervention.
    for (const li of payload.line_items ?? []) {
      const sku = normalizeSku(li.sku);
      if (!sku) continue;
      await logStockEvent({
        sku, source: "zoho", event_type: "manual_adjust",
        delta: Number(li.quantity_adjusted),
        correlation: payload.inventory_adjustment_id,
        occurred_at: new Date(payload.date ?? Date.now()),
        raw: payload,
      });
      await reconcile(sku, { trigger: "webhook:zoho:inventoryadjustment-created" });
    }
  }

  return NextResponse.json({ ok: true });
}