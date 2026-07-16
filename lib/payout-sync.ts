// Shared gateway-payout-fetch logic — pulls payouts from whichever gateway
// APIs are configured and upserts them. Used by both the on-demand API route
// (POST /api/integrations/payouts) and the persistent in-app scheduler, so
// there is exactly one place this logic lives.

import { telrConfigured, getPayoutsByAccountIdAndDate, getTransactionsByPayout, normalizeTelrPayouts, normalizeTelrTransactions } from "@/lib/integrations/telr";
import { stripeConfigured, listRecentPayouts, payoutOrderRefs } from "@/lib/integrations/stripe";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import type { ParsedPayout } from "@/lib/parsers/payouts";

export type GatewaySyncResult = { provider: string; fetched: number; saved: number; error?: string };

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
      }
      const saved = await PayoutsRepository.upsertPayouts(parsed);
      results.push({ provider: "Stripe", fetched: parsed.length, saved });
    } catch (e) {
      results.push({ provider: "Stripe", fetched: 0, saved: 0, error: (e as Error).message });
    }
  }

  return results;
}
