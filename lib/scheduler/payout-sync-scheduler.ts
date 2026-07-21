// Persistent payout verification — runs inside the Node process so founders
// never have to remember to click "sync payouts". Every N minutes: pull
// payouts from configured gateway APIs, re-run the bank reconciler, and
// record the outcome in sync_runs so it survives restarts and is visible to
// the dashboard/chat. Started once from instrumentation.ts on server boot.

import { syncGatewayPayouts } from "@/lib/payout-sync";
import { runReconciliation, summarizeReconLines } from "@/lib/reconciliation/engine";
import { SyncRunsRepository } from "@/lib/repositories/sync-runs.repository";

const DEFAULT_INTERVAL_MINUTES = 130;
const INITIAL_DELAY_MS = 10_000; // let the server finish booting before the first cycle

// Next.js hot-reloads server modules in dev; stash the timer on globalThis so
// a re-import doesn't spin up a second interval.
const g = globalThis as unknown as { __payoutSyncTimer?: NodeJS.Timeout };

async function runSyncCycle(trigger: "scheduler" | "manual") {
  try {
    const gatewayResults = await syncGatewayPayouts(7);
    const lines = await runReconciliation();
    const reconSummary = summarizeReconLines(lines);
    await SyncRunsRepository.record({ trigger, gatewayResults, reconSummary });
  } catch (e) {
    await SyncRunsRepository.record({ trigger, gatewayResults: [], error: (e as Error).message }).catch(() => {
      // if even recording the failure fails, there's nothing more to do — next cycle will retry
    });
  }
}

export function startPayoutSyncScheduler() {
  if (g.__payoutSyncTimer) return; // already running

  const minutes = Math.max(parseInt(process.env.PAYOUT_SYNC_INTERVAL_MINUTES || "", 130) || DEFAULT_INTERVAL_MINUTES, 130);
  const intervalMs = minutes * 60 * 1000;

  const tick = () => { void runSyncCycle("scheduler"); };
  setTimeout(tick, INITIAL_DELAY_MS);
  g.__payoutSyncTimer = setInterval(tick, intervalMs);

  console.log(`[payout-sync] persistent verification scheduler started — every ${minutes}m`);
}
