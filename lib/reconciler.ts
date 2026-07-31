// lib/reconciler.ts
import { supabase } from "@/lib/supabase";
import { normalizeSku } from "@/lib/sku";
import { pushShopify, pushWoo, pushZoho } from "@/lib/channel-adapters";
import { logStockEvent } from "@/lib/stock-events";
import { tryConsumeToken } from "@/lib/rate-limit";

const CHANNELS = ["shopify_uae","shopify_ksa","shopify_wa","woo"] as const;
type Channel = typeof CHANNELS[number];

// Small tolerance absorbs the moment between "Zoho committed the order"
// and "Shopify auto-decremented after order confirmation". Under this,
// don't push — it self-heals in seconds.
const TOLERANCE = 0;                          // set to 1 if you see flapping
const SETTLE_WINDOW_MS = 3_000;               // ignore drift younger than this

export async function reconcile(rawSku: string, opts: { trigger: string }) {
  const sku = normalizeSku(rawSku);
  if (!sku) return;

  const { data: pending } = await supabase.from("pending_zoho_sync")
  .select("origin_channel, expected_delta")
  .eq("sku", sku).is("cleared_at", null);

const inLagWindow = (pending?.length ?? 0) > 0;
const pendingDelta = (pending ?? []).reduce((s, p) => s + p.expected_delta, 0);

// Read everything from cache. NO external API calls during a reconcile.
const { data: zoho } = await supabase.from("zoho_items")
.select("sku, available_stock, stock_on_hand, status")
.eq("sku", sku).maybeSingle();
if (!zoho) {
  // SKU isn't in Zoho — either orphan on channel or new SKU pending catalog entry.
  // Log and let the scanner+alert handle policy, don't decide here.
  await logStockEvent({ sku, source: "reconciler", event_type: "webhook_reject",
    raw: { reason: "not_in_zoho", trigger: opts.trigger }, occurred_at: new Date() });
    return;
  }
  const zohoAvail = zoho.available_stock ?? 0;
  
  const { data: snaps } = await supabase.from("store_inventory")
  .select("store_id, sku, quantity, product_status, synced_at")
  .eq("sku", sku);
  
  const storeMin = Math.min(
    ...(snaps ?? []).filter((s) => (s.product_status ?? "ACTIVE") === "ACTIVE")
      .map((s) => s.quantity ?? 0),
    zohoAvail,
  );
  const truth = inLagWindow ? Math.min(zohoAvail + pendingDelta, storeMin) : zohoAvail;

  const now = Date.now();
  const corrections: { channel: Channel; from: number | null; to: number }[] = [];
  const originChannels = new Set((pending ?? []).map((p) => p.origin_channel));

  for (const channel of CHANNELS) {
    const snap = snaps?.find((s) => s.store_id.toLowerCase() === channel.replace("shopify_","").toLowerCase()
                                 || (channel === "woo" && s.store_id === "WOO"));
    // Not listed on this channel — presence table decides whether that's expected.
    // Skip silently for now; scanner handles missing-from-channel detection.
    
    if (!snap) continue;
    if (snap.product_status && snap.product_status !== "ACTIVE") continue;
    
    // Settle window: if this channel updated within the last 3s, it's probably
    // the source of the event we're reacting to. Don't push right back at it.
    if (snap.synced_at && now - new Date(snap.synced_at).getTime() < SETTLE_WINDOW_MS) continue;
    
    const current = snap.quantity ?? 0;
    if (inLagWindow && originChannels.has(channel) && current < truth) continue;
    if (Math.abs(current - truth) > TOLERANCE) {
      corrections.push({ channel, from: current, to: truth });
    }
  }

  if (corrections.length === 0) return;

  // Push in parallel, per-channel rate-limited. Any failure enqueues a retry
  // task for THAT channel instead of failing the whole reconcile.
  await Promise.all(corrections.map(async (c) => {
    if (!(await tryConsumeToken(c.channel))) {
      await enqueueRetry(sku, `rate_limited:${c.channel}`);
      return;
    }
    try {
      if (c.channel === "woo") await pushWoo(sku, c.to);
      else await pushShopify(c.channel, sku, c.to);
      await logStockEvent({ sku, source: "reconciler", event_type: "reconcile_correction",
        new_qty: c.to, raw: { channel: c.channel, from: c.from, trigger: opts.trigger },
        occurred_at: new Date() });
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.startsWith("READONLY_LOCATION") || msg.includes("refusing")) {
          // Alert already written, don't loop.
          return;
        }
        await enqueueRetry(sku, `push_failed:${c.channel}:${msg.slice(0, 200)}`);
      }
  }));
}

async function enqueueRetry(sku: string, reason: string) {
  // Coalesce: unique index on (sku) where unclaimed means dup insert = no-op.
  await supabase.from("reconcile_tasks")
    .insert({ sku, reason, priority: 3 })
    .then(() => {}, () => {}); // swallow unique-violation, that's the point
}