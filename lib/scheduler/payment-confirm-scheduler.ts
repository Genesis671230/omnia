// Persistent gateway payment confirmation — every N minutes, checks each
// gateway's own transaction records against pending orders and marks
// confirmed ones paid (Supabase + dispatch sheet + Telegram group). Stripe
// is the only one live right now (Telr's tools API is blocked pending
// account access, see lib/integrations/telr.ts) — confirmTelrPayments() is
// a no-op until then and starts working automatically once access is
// granted, no scheduler change needed. Separate cadence from
// order-sync-scheduler on purpose: this only needs to catch up with each
// gateway's own settlement pace, not with new orders landing.

import { confirmStripePayments } from "@/lib/sync/stripe-payment-confirm";
import { confirmTelrPayments } from "@/lib/sync/telr-payment-confirm";

const DEFAULT_INTERVAL_MINUTES = 10;
const INITIAL_DELAY_MS = 20_000; // let the server finish booting before the first cycle

// Next.js hot-reloads server modules in dev; stash the timer on globalThis so
// a re-import doesn't spin up a second interval.
const g = globalThis as unknown as { __paymentConfirmTimer?: NodeJS.Timeout };

async function runConfirmCycle() {
  try {
    const stripe = await confirmStripePayments();
    if (stripe.confirmed > 0) console.log(`[payment-confirm] Stripe: checked ${stripe.checked}, confirmed ${stripe.confirmed} paid`);
  } catch (e) {
    console.error("[payment-confirm] Stripe cycle failed:", (e as Error).message);
  }

  try {
    const telr = await confirmTelrPayments();
    if (telr.confirmed > 0) console.log(`[payment-confirm] Telr: checked ${telr.checked}, confirmed ${telr.confirmed} paid`);
  } catch (e) {
    console.error("[payment-confirm] Telr cycle failed:", (e as Error).message);
  }
}

export function startPaymentConfirmScheduler() {
  if (g.__paymentConfirmTimer) return; // already running

  const minutes = Math.max(parseInt(process.env.PAYMENT_CONFIRM_INTERVAL_MINUTES || "", 10) || DEFAULT_INTERVAL_MINUTES, 1);
  const intervalMs = minutes * 60 * 1000;

  const tick = () => { void runConfirmCycle(); };
  setTimeout(tick, INITIAL_DELAY_MS);
  g.__paymentConfirmTimer = setInterval(tick, intervalMs);

  console.log(`[payment-confirm] persistent gateway payment-confirmation scheduler started (Stripe + Telr) — every ${minutes}m`);
}
