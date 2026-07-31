import { supabase } from "@/lib/supabase";

export type StockEventSource =
  | "zoho" | "shopify_uae" | "shopify_ksa" | "shopify_wa" | "woo"
  | "master" | "reconciler"|any;

export type StockEventType =
  | "order_decrement" | "manual_adjust" | "restock" | "refund"
  | "snapshot" | "reconcile_push" | "reconcile_correction" | "webhook_reject";

export type StockEventInput = {
  sku: string;
  source: StockEventSource;
  event_type: StockEventType;
  delta?: number | null;
  new_qty?: number | null;
  correlation?: string | null;
  occurred_at: Date;
  raw?: unknown;
};

// Never throws. Event log failure must not break the flow that called us —
// the caller's job (reconcile, webhook) is doing real work; we're
// bookkeeping. If Supabase is down, we log to console and move on.
export async function logStockEvent(evt: StockEventInput): Promise<void> {
  try {
    const { error } = await supabase.from("stock_events").insert({
      sku: evt.sku,
      source: evt.source,
      event_type: evt.event_type,
      delta: evt.delta ?? null,
      new_qty: evt.new_qty ?? null,
      correlation: evt.correlation ?? null,
      occurred_at: evt.occurred_at.toISOString(),
      raw: evt.raw ?? null,
    });
    if (error) console.error("[stock-events] insert failed:", error.message);
  } catch (e) {
    console.error("[stock-events] threw:", (e as Error).message);
  }
}