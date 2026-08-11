// Persistent order sync — runs inside the Node process so new Shopify/Woo
// orders land in Supabase (and trigger a Telegram alert, see
// lib/alerts/order-alerts.ts) within a couple minutes of being placed,
// without anyone clicking "Sync". Mirrors payout-sync-scheduler.ts.
//
// Short interval + short window on purpose: this cycle only needs to catch
// orders placed since the last tick, not re-walk the full 60-day book that
// the manual "Sync" button (/api/sync) pulls.

import { syncAllStores } from "@/lib/sync/order-sync.service";
import { OrderSyncRunsRepository } from "@/lib/repositories/order-sync-runs.repository";

const DEFAULT_INTERVAL_MINUTES = 2;
const SYNC_WINDOW_DAYS = 3;
const INITIAL_DELAY_MS = 15_000; // let the server finish booting before the first cycle

// Next.js hot-reloads server modules in dev; stash the timer on globalThis so
// a re-import doesn't spin up a second interval.
const g = globalThis as unknown as { __orderSyncTimer?: NodeJS.Timeout };

async function runSyncCycle() {
  try {
    const results = await syncAllStores(SYNC_WINDOW_DAYS);
    const errors = results.filter((r) => r.error);
    if (errors.length > 0) {
      console.error("[order-sync] cycle had errors:", errors);
    }
    await OrderSyncRunsRepository.record({ trigger: "scheduler", storeResults: results });
  } catch (e) {
    console.error("[order-sync] cycle failed:", (e as Error).message);
    await OrderSyncRunsRepository.record({ trigger: "scheduler", storeResults: [], error: (e as Error).message }).catch(() => {
      // if even recording the failure fails, there's nothing more to do — next cycle will retry
    });
  }
}

export function startOrderSyncScheduler() {
  if (g.__orderSyncTimer) return; // already running

  const minutes = Math.max(parseInt(process.env.ORDER_SYNC_INTERVAL_MINUTES || "", 10) || DEFAULT_INTERVAL_MINUTES, 1);
  const intervalMs = minutes * 60 * 1000;

  const tick = () => { void runSyncCycle(); };
  setTimeout(tick, INITIAL_DELAY_MS);
  g.__orderSyncTimer = setInterval(tick, intervalMs);

  console.log(`[order-sync] persistent order sync + Telegram alert scheduler started — every ${minutes}m`);
}
