// Stripe orders don't carry a stored payment reference anywhere (Shopify/Woo
// webhooks never capture the Stripe payment_intent/charge id — see the
// dead-end comment in app/api/orders/[uid]/check-stripe/route.ts), so
// "did this order actually get paid" can't be looked up by id. Instead this
// walks Stripe's own recent-charges list and matches on the same order-ref
// convention the payout CSV/API reconciliation already trusts (see
// stripeOrderRefs in lib/parsers/payouts.ts). The amount-check, dedup,
// financial_status flip, dispatch-sheet mark, and Telegram notify are all
// shared with every other gateway's confirm flow — see
// lib/sync/payment-confirm-core.ts.

import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { stripeConfigured, listRecentChargeRefs, type StripeChargeRef } from "@/lib/integrations/stripe";
import { confirmOrderPayment } from "@/lib/sync/payment-confirm-core";

const LOOKBACK_DAYS = 7;
const STORE_PREFIX_RE = /^(WA|UAE|KSA|WOO)/i;

// Same store-prefix-stripping convention as computeFinanceStatuses in
// lib/orders-finance-status.ts (e.g. a Stripe charge ref "WA1001" must match
// order_number "1001") — exported for unit testing.
export function refKey(orderNumber: string): string {
  return orderNumber.trim().toUpperCase().replace(STORE_PREFIX_RE, "");
}

export type StripeConfirmResult = { checked: number; confirmed: number };

export async function confirmStripePayments(): Promise<StripeConfirmResult> {
  if (!stripeConfigured()) return { checked: 0, confirmed: 0 };

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60_000);
  const orders = await OrdersRepository.listInWindow({ from: since.toISOString() });
  const pending = orders.filter(
    (o) => (o.gateway || "").toLowerCase() === "stripe" && (o.financial_status || "").toLowerCase() !== "paid",
  );
  if (pending.length === 0) return { checked: 0, confirmed: 0 };

  const charges = await listRecentChargeRefs(Math.floor(since.getTime() / 1000));
  const byRef = new Map<string, StripeChargeRef>();
  for (const c of charges) {
    const key = refKey(c.ref);
    if (!byRef.has(key)) byRef.set(key, c); // first (most recent, API returns newest-first) match wins
  }

  let confirmed = 0;
  for (const order of pending) {
    const charge = byRef.get(refKey(order.order_number));
    if (!charge) continue;

    const outcome = await confirmOrderPayment({
      order,
      source: "Stripe",
      dedupProvider: "stripe-payment-confirm",
      amount: charge.amount,
      currency: charge.currency,
      paidAtIso: new Date(charge.created * 1000).toISOString(),
    });

    if (outcome.status === "amount-mismatch") {
      console.error(
        `[stripe-payment-confirm] ref matched for #${order.order_number} but amount mismatch — ` +
          `charge ${charge.amount} ${charge.currency} vs order ${outcome.expected} ${order.currency}, skipping`,
      );
      continue;
    }
    if (outcome.status === "already-processed") continue;
    if (outcome.status === "financial-status-update-failed") {
      console.error(`[stripe-payment-confirm] financial_status update failed for ${order.uid}:`, outcome.error);
      continue;
    }

    confirmed += 1;
  }

  return { checked: pending.length, confirmed };
}
