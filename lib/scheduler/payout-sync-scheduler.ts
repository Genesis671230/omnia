// Persistent payout verification — runs inside the Node process so founders
// never have to remember to click "sync payouts". Every N minutes: pull
// payouts from configured gateway APIs, re-run the bank reconciler, and
// record the outcome in sync_runs so it survives restarts and is visible to
// the dashboard/chat. Started once from instrumentation.ts on server boot.

import { syncGatewayPayouts, syncShopifyPayments } from "@/lib/payout-sync";
import { runReconciliation, summarizeReconLines } from "@/lib/reconciliation/engine";
import { SyncRunsRepository } from "@/lib/repositories/sync-runs.repository";

const DEFAULT_INTERVAL_MINUTES = 130;
const INITIAL_DELAY_MS = 10_000; // let the server finish booting before the first cycle

// Next.js hot-reloads server modules in dev; stash the timer on globalThis so
// a re-import doesn't spin up a second interval.
const g = globalThis as unknown as { __payoutSyncTimer?: NodeJS.Timeout; __shopifyPaymentsTimer?: NodeJS.Timeout };

// Shopify Payments is cheap to poll (GraphQL, ~20 cost points of 20,000), so it
// runs far more often than the full gateway cycle: pending charges refresh the
// ledger's fees, and the moment Shopify issues a payout it is saved and the
// reconciler runs — no waiting for the next 2-hour cycle.
const DEFAULT_SHOPIFY_INTERVAL_MINUTES = 15;

async function runShopifyPaymentsCycle() {
  try {
    const results = await syncShopifyPayments(7);
    const newPayouts = results.reduce((a, r) => a + r.saved, 0);
    const failed = results.some((r) => r.error);
    if (newPayouts === 0 && !failed) return; // pending charges refreshed; nothing for the reconciler
    const lines = newPayouts > 0 ? await runReconciliation() : [];
    await SyncRunsRepository.record({
      trigger: "scheduler",
      gatewayResults: results,
      ...(newPayouts > 0 ? { reconSummary: summarizeReconLines(lines) } : {}),
    });
  } catch (e) {
    console.error("[shopify-payments] sync failed:", (e as Error).message);
  }
}

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

  const minutes = Math.max(parseInt(process.env.PAYOUT_SYNC_INTERVAL_MINUTES || "", 10) || DEFAULT_INTERVAL_MINUTES, 30);
  const intervalMs = minutes * 60 * 1000;

  const tick = () => { void runSyncCycle("scheduler"); };
  setTimeout(tick, INITIAL_DELAY_MS);
  g.__payoutSyncTimer = setInterval(tick, intervalMs);

  console.log(`[payout-sync] persistent verification scheduler started — every ${minutes}m`);

  if (!g.__shopifyPaymentsTimer) {
    const spMinutes = Math.max(parseInt(process.env.SHOPIFY_PAYMENTS_SYNC_MINUTES || "", 10) || DEFAULT_SHOPIFY_INTERVAL_MINUTES, 5);
    g.__shopifyPaymentsTimer = setInterval(() => { void runShopifyPaymentsCycle(); }, spMinutes * 60 * 1000);
    console.log(`[shopify-payments] payout + pending-charge sync every ${spMinutes}m`);
  }
}
