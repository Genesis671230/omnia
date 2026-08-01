// app/api/inventory/sku/[sku]/push/route.ts
//
// Guard: only push to a channel where listed && tracking && quantity !== zohoStock.
// Never push to an unlisted channel — that would create the listing as a side effect.
//
// Shopify (UAE/KSA/WA): real write via pushShopifyInventoryQuantity (GraphQL
// inventorySetQuantities), each store isolated — one failing store must not
// block the others.
// WooCommerce: write access not yet provisioned. Never attempted, never faked —
// reports the exact target qty so whoever covers it manually knows what to type.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { normalizeSku } from "@/lib/sku";
import { pushShopifyInventoryQuantity } from "@/lib/integrations/shopify";
import type { ShopifyStoreCode } from "@/lib/integrations/shopify";
import { logStockEvent } from "@/lib/stock-events";
import type { StockEventSource } from "@/lib/stock-events";
import { StoreInventoryRepository } from "@/lib/repositories/store-inventory.repository";

export const dynamic = "force-dynamic";

const SHOPIFY_CHANNELS: ShopifyStoreCode[] = ["UAE", "KSA", "WA"];

// off: compute + log intended pushes, touch nothing.
// shadow: same as off, but audit-logged with mode='shadow'.
// live: actually call Shopify.
const WRITE_MODE = (process.env.STOCK_WRITE_MODE ?? "off") as "off" | "shadow" | "live";

type StoreRow = {
  store_id: string;
  quantity: number | null;
  product_status: string | null;
  product_title: string | null;
};

type TargetResult = {
  store: string;
  currentQty: number | null;
  targetQty: number;
  action: "pushed" | "skipped" | "failed" | "dry_run";
  reason?: string;
  location?: string;
};

export async function POST(_req: Request, { params }: { params: { sku: string } }) {
  const p = await params;
  const skuRaw = decodeURIComponent(p.sku);
  const sku = normalizeSku(skuRaw);
  if (!sku) {
    return NextResponse.json({ error: "invalid_sku", sku: skuRaw }, { status: 400 });
  }

  // 1) Current state — Zoho + every store row for this one SKU. Single-row
  //    scope, same semantics as inventory-compare.ts (listed = row exists,
  //    tracking = qty !== null) — not a fork of the catalog-wide classifier.
  const [zohoRes, storesRes] = await Promise.all([
    supabase.from("zoho_items").select("available_stock").eq("sku", sku).maybeSingle(),
    supabase
      .from("store_inventory")
      .select("store_id, quantity, product_status, product_title")
      .eq("sku", sku),
  ]);

  if (zohoRes.error) return NextResponse.json({ error: zohoRes.error.message }, { status: 500 });
  if (storesRes.error) return NextResponse.json({ error: storesRes.error.message }, { status: 500 });
  if (!zohoRes.data) return NextResponse.json({ error: "sku_not_in_zoho", sku }, { status: 404 });

  const zohoStock = zohoRes.data.available_stock;
  const byStore = new Map<string, StoreRow>((storesRes.data ?? []).map((r) => [r.store_id, r]));

  const results: TargetResult[] = [];

  // 2) Shopify stores — real targets, real writes (subject to WRITE_MODE).
  for (const channel of SHOPIFY_CHANNELS) {
    const row = byStore.get(channel);
    const listed = !!row;
    const tracking = listed && row!.quantity !== null;
    const currentQty = row?.quantity ?? null;

    if (!listed) {
      results.push({ store: channel, currentQty, targetQty: zohoStock, action: "skipped", reason: "not_listed" });
      continue;
    }
    if (!tracking) {
      results.push({ store: channel, currentQty, targetQty: zohoStock, action: "skipped", reason: "untracked" });
      continue;
    }
    if (currentQty === zohoStock) {
      results.push({ store: channel, currentQty, targetQty: zohoStock, action: "skipped", reason: "already_in_sync" });
      continue;
    }

    if (WRITE_MODE === "off" || WRITE_MODE === "shadow") {
      results.push({ store: channel, currentQty, targetQty: zohoStock, action: "dry_run", reason: `write_mode=${WRITE_MODE}` });
      continue;
    }

    const pushResult = await pushShopifyInventoryQuantity(channel, sku, zohoStock, currentQty);

    if (pushResult.ok) {
      results.push({ store: channel, currentQty, targetQty: zohoStock, action: "pushed", location: pushResult.location });

      // Optimistic local update — preserve existing title/status, only change qty,
      // so we don't blank out fields StoreInventoryRepository.upsertMany requires.
      await StoreInventoryRepository.upsertMany([{
        storeId: channel,
        sku,
        quantity: zohoStock,
        productTitle: row?.product_title ?? "",
        productStatus: row?.product_status ?? "",
      }]).catch(() => {});

      // Feeds the live ticker directly — LiveEventsTicker's eventText() already
      // has a case for "reconcile_push" ("pushed to {new_qty}").
      await logStockEvent({
        sku,
        source: `shopify_${channel.toLowerCase()}` as StockEventSource,
        event_type: "reconcile_push",
        new_qty: zohoStock,
        raw: { trigger: "manual_push", fromQty: currentQty, location: pushResult.location },
        occurred_at: new Date(),
      });
    } else {
      results.push({ store: channel, currentQty, targetQty: zohoStock, action: "failed", reason: pushResult.reason });
    }
  }

  // 3) WooCommerce — always reported honestly, never attempted.
  const wooRow = byStore.get("WOO");
  if (wooRow) {
    const tracking = wooRow.quantity !== null;
    results.push({
      store: "WOO",
      currentQty: wooRow.quantity,
      targetQty: zohoStock,
      action: "skipped",
      reason: !tracking
        ? "untracked"
        : wooRow.quantity === zohoStock
          ? "already_in_sync"
          : "woo_write_not_provisioned — update manually in WooCommerce admin until write access lands",
    });
  }

  // 4) Audit log — every attempt, regardless of outcome. Non-fatal if the
  //    table doesn't exist yet or the insert fails.
  const auditRows = results.map((r) => ({
    sku,
    store_id: r.store,
    from_qty: r.currentQty,
    to_qty: r.targetQty,
    write_mode: WRITE_MODE,
    action: r.action,
    reason: r.reason ?? null,
    actor: "manual_push",
    created_at: new Date().toISOString(),
  }));
  await supabase.from("stock_write_intents").insert(auditRows).then(undefined,() => {});

  const pushedCount = results.filter((r) => r.action === "pushed").length;
  const failedCount = results.filter((r) => r.action === "failed").length;

  return NextResponse.json({
    sku,
    zohoStock,
    writeMode: WRITE_MODE,
    results,
    summary: { pushed: pushedCount, failed: failedCount, skipped: results.length - pushedCount - failedCount },
  });
}