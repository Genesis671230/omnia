// Event-driven order ingestion for the store webhooks — the instant path
// alongside the 2-minute order-sync-scheduler poll (which stays as the
// safety net for anything a webhook misses or that arrives while the app is
// down). Both paths funnel through the same OrdersRepository.upsertMany +
// sendNewOrderAlerts used everywhere else, so dedup/courier-status/sheet
// logic behaves identically regardless of which path caught an order.

import { fetchShopifyOrders, getShopifyStores, type ShopifyStoreCode } from "@/lib/integrations/shopify";
import { normalizeShopifyOrder, normalizeWooOrder } from "@/lib/normalize/order";
import type { WooRawOrder } from "@/lib/integrations/woo";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { sendNewOrderAlerts } from "@/lib/alerts/order-alerts";

// Shopify's REST order-webhook payload is a different shape than the
// GraphQL order the rest of this app normalizes (global IDs, nested
// `nodes`, `currentTotalPriceSet`, etc.) — rather than maintain a second,
// parallel parser that can silently drift from the real one, treat the
// webhook purely as a "something changed for this store" signal and
// re-fetch a short recent window through the same proven GraphQL path
// fetchShopifyOrders/normalizeShopifyOrder already use. One extra API call,
// zero risk of a subtly-wrong second order parser in a financial pipeline.
export async function ingestShopifyOrderWebhook(storeCode: ShopifyStoreCode): Promise<void> {
  const store = getShopifyStores().find((s) => s.code === storeCode);
  if (!store) return;
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const raw = await fetchShopifyOrders(store, since);
  const rows = raw.map((o) => normalizeShopifyOrder(o, storeCode));
  await OrdersRepository.upsertMany(rows);
  await sendNewOrderAlerts(rows);
}

// Woo's webhook payload IS the same order resource shape as its REST API
// (unlike Shopify's REST-vs-GraphQL mismatch above), so this one can
// normalize the payload directly without a re-fetch.
export async function ingestWooOrderWebhook(payload: WooRawOrder): Promise<void> {
  const row = normalizeWooOrder(payload);
  await OrdersRepository.upsertMany([row]);
  await sendNewOrderAlerts([row]);
}
