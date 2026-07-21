// Persistent Zoho + live-inventory sync — runs inside the Node process so
// the inventory comparison view stays fresh without anyone clicking
// "sync". Every N minutes: pull Zoho items/orders and live Shopify/Woo
// stock, and record the outcome in zoho_sync_runs. Started once from
// instrumentation.ts on server boot. Mirrors ad-sync-scheduler.ts.

import { syncZohoAndInventory } from "@/lib/zoho-sync";
import { ZohoSyncRunsRepository } from "@/lib/repositories/zoho-sync-runs.repository";

const DEFAULT_INTERVAL_MINUTES = 130;
const INITIAL_DELAY_MS = 20_000; // let the server finish booting before the first cycle

// Next.js hot-reloads server modules in dev; stash the timer on globalThis so
// a re-import doesn't spin up a second interval.
const g = globalThis as unknown as { __zohoSyncTimer?: NodeJS.Timeout };

async function runSyncCycle(trigger: "scheduler" | "manual") {
  try {
    const sourceResults = await syncZohoAndInventory();
    await ZohoSyncRunsRepository.record({ trigger, sourceResults });
  } catch (e) {
    await ZohoSyncRunsRepository.record({ trigger, sourceResults: [], error: (e as Error).message }).catch(() => {
      // if even recording the failure fails, there's nothing more to do — next cycle will retry
    });
  }
}

export function startZohoSyncScheduler() {
  if (g.__zohoSyncTimer) return; // already running

  const minutes = Math.max(parseInt(process.env.ZOHO_SYNC_INTERVAL_MINUTES || "", 120) || DEFAULT_INTERVAL_MINUTES, 135);
  const intervalMs = minutes * 60 * 1000;

  const tick = () => { void runSyncCycle("scheduler"); };
  setTimeout(tick, INITIAL_DELAY_MS);
  g.__zohoSyncTimer = setInterval(tick, intervalMs);

  console.log(`[zoho-sync] persistent Zoho + inventory sync scheduler started — every ${minutes}m`);
}
