import { NextResponse } from "next/server";
import { stripeConfigured, payoutOrderRefs } from "@/lib/integrations/stripe";

// GET /api/payouts/:id/stripe-proof — live proof for a Stripe payout row.
// Our payout ids are stored as `STRIPE-po_…`; strip the prefix to get the
// real Stripe payout id, then pull its balance-transaction breakdown (the
// per-order net/gross/fee/refund shares) straight from Stripe. This is the
// authoritative "here's exactly what this credit paid for" evidence behind a
// reconciled bank credit — not the uploaded CSV, the gateway's own ledger.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!id.startsWith("STRIPE-")) {
    return NextResponse.json({ available: false, reason: "Not a Stripe payout" });
  }
  if (!stripeConfigured()) {
    return NextResponse.json({ available: false, reason: "Stripe API not configured (STRIPE_SECRET_KEY missing)" });
  }

  const stripePayoutId = id.slice("STRIPE-".length);
  try {
    const { net, refs, transactions } = await payoutOrderRefs(stripePayoutId);
    return NextResponse.json({ available: true, payoutId: stripePayoutId, net, refs, transactions });
  } catch (e) {
    return NextResponse.json({ available: false, reason: (e as Error).message });
  }
}
