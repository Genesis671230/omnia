// Persistent ad-platform sync — runs inside the Node process so campaign
// spend/conversion data stays fresh without anyone clicking "sync". Every N
// minutes: pull insights from configured platform APIs (Meta/Google/
// TikTok/Snap) and record the outcome in ad_sync_runs. Started once from
// instrumentation.ts on server boot. Mirrors payout-sync-scheduler.ts.

import { syncAdInsights } from "@/lib/ad-sync";
import { AdSyncRunsRepository } from "@/lib/repositories/ad-sync-runs.repository";

const DEFAULT_INTERVAL_MINUTES = 15;
const INITIAL_DELAY_MS = 15_000; // let the server finish booting before the first cycle

// Next.js hot-reloads server modules in dev; stash the timer on globalThis so
// a re-import doesn't spin up a second interval.
const g = globalThis as unknown as { __adSyncTimer?: NodeJS.Timeout };

async function runSyncCycle(trigger: "scheduler" | "manual") {
  try {
    const platformResults = await syncAdInsights();
    await AdSyncRunsRepository.record({ trigger, platformResults });
  } catch (e) {
    await AdSyncRunsRepository.record({ trigger, platformResults: [], error: (e as Error).message }).catch(() => {
      // if even recording the failure fails, there's nothing more to do — next cycle will retry
    });
  }
}

export function startAdSyncScheduler() {
  if (g.__adSyncTimer) return; // already running

  const minutes = Math.max(parseInt(process.env.AD_SYNC_INTERVAL_MINUTES || "", 10) || DEFAULT_INTERVAL_MINUTES, 5);
  const intervalMs = minutes * 60 * 1000;

  const tick = () => { void runSyncCycle("scheduler"); };
  setTimeout(tick, INITIAL_DELAY_MS);
  g.__adSyncTimer = setInterval(tick, intervalMs);

  console.log(`[ad-sync] persistent ad-platform sync scheduler started — every ${minutes}m`);
}
