// Orchestrates: fetch from each store → normalize → upsert into Supabase.
// Pages read Supabase only; live store APIs are hit only here.

import { fetchShopifyOrders, getShopifyStores } from "@/lib/integrations/shopify";
import { fetchWooOrders, wooConfigured } from "@/lib/integrations/woo";
import { normalizeShopifyOrder, normalizeWooOrder } from "@/lib/normalize/order";
import { OrdersRepository } from "@/lib/repositories/orders.repository";

const DEFAULT_WINDOW_DAYS = 60;

export type StoreSyncResult = {
  store: string;
  fetched: number;
  upserted: number;
  error?: string;
};

export async function syncAllStores(windowDays = DEFAULT_WINDOW_DAYS): Promise<StoreSyncResult[]> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const jobs: Promise<StoreSyncResult>[] = [];

  for (const store of getShopifyStores()) {
    jobs.push(
      (async () => {
        try {
          const raw = await fetchShopifyOrders(store, since);
          const rows = raw.map((o) => normalizeShopifyOrder(o, store.code));
          const upserted = await OrdersRepository.upsertMany(rows);
          return { store: store.code, fetched: raw.length, upserted };
        } catch (e) {
          return { store: store.code, fetched: 0, upserted: 0, error: (e as Error).message };
        }
      })(),
    );
  }

  if (wooConfigured()) {
    jobs.push(
      (async () => {
        try {
          const raw = await fetchWooOrders(`${since}T00:00:00`);
          const rows = raw.map(normalizeWooOrder);
          const upserted = await OrdersRepository.upsertMany(rows);
          return { store: "WOO", fetched: raw.length, upserted };
        } catch (e) {
          return { store: "WOO", fetched: 0, upserted: 0, error: (e as Error).message };
        }
      })(),
    );
  }

  return Promise.all(jobs);
}
