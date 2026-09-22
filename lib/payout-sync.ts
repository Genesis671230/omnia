// Shared gateway-payout-fetch logic — pulls payouts from whichever gateway
// APIs are configured and upserts them. Used by both the on-demand API route
// (POST /api/integrations/payouts) and the persistent in-app scheduler, so
// there is exactly one place this logic lives.

import { telrConfigured, getPayoutsByAccountIdAndDate, getTransactionsByPayout, normalizeTelrPayouts, normalizeTelrTransactions } from "@/lib/integrations/telr";
import { stripeConfigured, listRecentPayouts, payoutOrderRefs } from "@/lib/integrations/stripe";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { persistStripeApiSettlements, type PaidStripePayout } from "@/lib/reconciliation/stripe-settlements";
import type { ParsedPayout } from "@/lib/parsers/payouts";
import { getShopifyStores } from "@/lib/integrations/shopify";
import { fetchStorePendingCharges, fetchStoreShopifyPayouts } from "@/lib/integrations/shopify-payments";
import { PendingChargesRepository } from "@/lib/repositories/pending-charges.repository";

export type GatewaySyncResult = {
  provider: string; fetched: number; saved: number; settled?: number;
  /** Charges the gateway made that no payout covers yet (Shopify Payments). */
  pending?: number;
  error?: string;
};

export async function syncGatewayPayouts(days = 30): Promise<GatewaySyncResult[]> {
  const toDate = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const results: GatewaySyncResult[] = [];

  if (telrConfigured()) {
    try {
      const raw = await getPayoutsByAccountIdAndDate(fromDate, toDate);
      const payouts = normalizeTelrPayouts(raw);
      const parsed: ParsedPayout[] = [];
      for (const p of payouts) {
        if (!p.id) continue;
        let refs: string[] = [];
        try {
          const tx = await getTransactionsByPayout(p.id);
          refs = normalizeTelrTransactions(tx);
        } catch {
          // transactions endpoint failed — payout still counts, just unresolved refs
        }
        parsed.push({
          id: `TELR-${p.id}`,
          provider: "Telr",
          net: p.net,
          orderRefs: refs,
          source: "telr-api",
          notes: `Fetched live via Telr API${p.date ? ` · ${p.date}` : ""}`,
        });
      }
      const saved = await PayoutsRepository.upsertPayouts(parsed);
      results.push({ provider: "Telr", fetched: parsed.length, saved });
    } catch (e) {
      results.push({ provider: "Telr", fetched: 0, saved: 0, error: (e as Error).message });
    }
  }

  if (stripeConfigured()) {
    try {
      const payouts = await listRecentPayouts(50);
      const cutoff = Date.now() / 1000 - days * 24 * 60 * 60;
      const parsed: ParsedPayout[] = [];
      const paid: PaidStripePayout[] = [];
      for (const p of payouts) {
        if (p.arrival_date < cutoff) continue;
        const { net, refs, transactions } = await payoutOrderRefs(p.id);
        parsed.push({
          id: `STRIPE-${p.id}`,
          provider: "Stripe",
          net: net || p.amount / 100,
          orderRefs: refs,
          source: "stripe-api",
          notes: `Fetched live via Stripe API · ${p.status}`,
          transactions,
        });
        // "paid" is Stripe's terminal state — the transfer has gone out to
        // the bank. That's settlement evidence from the gateway itself, so
        // these orders become publishable to Zoho Books without waiting for
        // the bank statement upload. in_transit/pending payouts don't count.
        if (p.status === "paid") {
          paid.push({
            id: `STRIPE-${p.id}`,
            arrivalDate: p.arrival_date ? new Date(p.arrival_date * 1000).toISOString().slice(0, 10) : null,
            transactions,
          });
        }
      }
      const saved = await PayoutsRepository.upsertPayouts(parsed);
      let settled = 0;
      try {
        settled = await persistStripeApiSettlements(paid);
      } catch (e) {
        // settlement-record creation must never fail the payout sync itself
        console.error("Stripe API settlement records failed:", (e as Error).message);
      }
      results.push({ provider: "Stripe", fetched: parsed.length, saved, settled });
    } catch (e) {
      results.push({ provider: "Stripe", fetched: 0, saved: 0, error: (e as Error).message });
    }
  }

  results.push(...(await syncShopifyPayments(days)));

  return results;
}

/** Charges stay pending for a few days before Shopify issues the payout; look
 *  back far enough that a whole month's pending fees are always present. */
const PENDING_LOOKBACK_DAYS = 45;

/**
 * Shopify Payments, every store: issued payouts (with per-order fee/net) go
 * into `payouts` for the reconciler; charges not yet in a payout go into
 * gateway_pending_charges so the sales ledger shows their real fee at once.
 * One result row per store, so a missing API scope on one store is reported
 * by name without hiding the others. `saved` counts payouts only — that is
 * what tells the caller the reconciler has new work.
 */
export async function syncShopifyPayments(days = 30): Promise<GatewaySyncResult[]> {
  const results: GatewaySyncResult[] = [];
  const payoutSince = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const pendingSince = new Date(Date.now() - Math.max(days, PENDING_LOOKBACK_DAYS) * 24 * 60 * 60 * 1000).toISOString();
  for (const store of getShopifyStores()) {
    const provider = `Shopify Payments ${store.code}`;
    try {
      const r = await fetchStoreShopifyPayouts(store, payoutSince);
      if (r.skipped === "no_account") continue; // store doesn't use Shopify Payments
      const saved = await PayoutsRepository.upsertPayouts(r.payouts);
      // An order a payout now covers is no longer pending.
      await PendingChargesRepository.removeOrderRefs(store.code, r.payouts.flatMap((p) => p.orderRefs));
      const pending = (await fetchStorePendingCharges(store, pendingSince)) ?? [];
      const pendingSaved = await PendingChargesRepository.replaceForStore(store.code, pendingSince, pending);
      results.push({ provider, fetched: r.payouts.length, saved, pending: pendingSaved });
    } catch (e) {
      results.push({ provider, fetched: 0, saved: 0, error: (e as Error).message });
    }
  }
  return results;
}
