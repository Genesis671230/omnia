// Stripe REST client — payouts + the balance transactions that make each one
// up. Only active when STRIPE_SECRET_KEY is set; otherwise the workspace
// relies on the manually uploaded Stripe transfers/reconciliation CSV.

import { stripeOrderRefs, classifyStripeQuality, type PayoutTransactionShare } from "@/lib/parsers/payouts";

const BASE = "https://api.stripe.com/v1";

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

async function stripeGet(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Stripe API HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export type StripePayout = { id: string; amount: number; currency: string; arrival_date: number; status: string };

export async function listRecentPayouts(limit = 20): Promise<StripePayout[]> {
  const json = await stripeGet(`/payouts?limit=${limit}`);
  return (json.data ?? []) as StripePayout[];
}

// balance transactions attributed to a payout — each charge's description
// carries the order reference the same way the CSV export does. Also builds
// a per-transaction breakdown (transactions[]): Stripe's own `type` field
// (e.g. "refund", "payment_refund") is the authoritative refund signal here
// — unlike the CSV upload paths, the live API doesn't need to guess refund
// status from description text. Multi-ref descriptions split their net/
// gross/fee evenly across every ref they name.
export async function payoutOrderRefs(
  payoutId: string,
): Promise<{ net: number; refs: string[]; transactions: PayoutTransactionShare[] }> {
  let net = 0;
  const refs: string[] = [];
  const transactions: PayoutTransactionShare[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const qs = new URLSearchParams({ payout: payoutId, limit: "100" });
    if (startingAfter) qs.set("starting_after", startingAfter);
    const json = await stripeGet(`/balance_transactions?${qs}`);
    const rows = json.data ?? [];
    for (const row of rows) {
      const rowNet = Number(row.net || 0) / 100;
      const rowGross = Number(row.amount || 0) / 100;
      const rowFee = Number(row.fee || 0) / 100;
      net += rowNet;

      const desc = String(row.description || "");
      const isRefund = String(row.type || "").toLowerCase().includes("refund");
      const { refs: rowRefs } = stripeOrderRefs(desc);
      const quality = classifyStripeQuality(desc, rowRefs, isRefund);
      for (const tok of rowRefs) if (!refs.includes(tok)) refs.push(tok);

      const n = rowRefs.length || 1;
      for (const ref of rowRefs) {
        transactions.push({
          ref, isRefund, quality,
          netShare: +(rowNet / n).toFixed(2),
          grossShare: +(rowGross / n).toFixed(2),
          feeShare: +(rowFee / n).toFixed(2),
        });
      }
    }
    if (!json.has_more || rows.length === 0) break;
    startingAfter = rows[rows.length - 1].id;
  }
  return { net: +net.toFixed(2), refs, transactions };
}
