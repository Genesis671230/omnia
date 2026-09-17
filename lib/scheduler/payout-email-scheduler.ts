// Persistent Gmail payout-report ingestion — runs inside the Node process so a
// settlement report reaches the reconciler on its own, instead of waiting for
// somebody to notice the email and upload the attachment by hand. Started once
// from instrumentation.ts on server boot, same shape as the other schedulers.

import { ingestPayoutEmails } from "@/lib/finance/payout-email-ingest";
import { gmailConfigured, gmailMailboxes } from "@/lib/integrations/gmail";
import { runReconciliation } from "@/lib/reconciliation/engine";

const DEFAULT_INTERVAL_MINUTES = 15;
const MIN_INTERVAL_MINUTES = 5;
const INITIAL_DELAY_MS = 20_000; // let the server finish booting first

// Next.js hot-reloads server modules in dev; stash the timer on globalThis so a
// re-import doesn't start a second interval.
const g = globalThis as unknown as { __payoutEmailTimer?: NodeJS.Timeout };

async function runCycle() {
  try {
    const summary = await ingestPayoutEmails({ days: 30 });
    if (summary.ingested > 0) {
      console.log(
        `[payout-email] ingested ${summary.ingested} report(s): ` +
          summary.outcomes
            .filter((o) => o.status === "ingested")
            .map((o) => o.payoutId)
            .join(", "),
      );
      // A new payout only matters once the reconciler has had a chance to
      // claim a credit with it.
      await runReconciliation();
    }
    const failures = summary.outcomes.filter((o) => o.status === "failed");
    for (const f of failures) {
      // A message that matched but yielded nothing parseable is the case worth
      // shouting about — it means a report arrived and did NOT get booked.
      console.error(`[payout-email] FAILED ${f.subject || f.messageId}: ${f.error}`);
    }
  } catch (e) {
    console.error("[payout-email] cycle failed:", (e as Error).message);
  }
}

export function startPayoutEmailScheduler() {
  if (g.__payoutEmailTimer) return; // already running

  if (!gmailConfigured() || gmailMailboxes().length === 0) {
    console.log("[payout-email] not configured — set GMAIL_USER + GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN to enable");
    return;
  }

  const minutes = Math.max(
    parseInt(process.env.GMAIL_INGEST_INTERVAL_MINUTES || "", 10) || DEFAULT_INTERVAL_MINUTES,
    MIN_INTERVAL_MINUTES,
  );

  const tick = () => { void runCycle(); };
  setTimeout(tick, INITIAL_DELAY_MS);
  g.__payoutEmailTimer = setInterval(tick, minutes * 60 * 1000);

  console.log(
    `[payout-email] Gmail payout ingest started — every ${minutes}m across ${gmailMailboxes().join(", ")}`,
  );
}
