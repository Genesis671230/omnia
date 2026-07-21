// Contribution margin per store: revenue − ad spend − gateway fees.
//
// The honesty problem this solves: only SOME payouts carry per-transaction
// fee_aed (Stripe + live-API/CSV parsers). Telr/Tamara/Tabby/generic parsers
// total the whole file, so their per-order fee is a placeholder 0, NOT a real
// zero (see PayoutsRepository comment). Naively summing fee_aed would inflate
// margin for exactly the BNPL/local gateways that dominate Gulf checkout.
//
// So fees are two-tier and the split is always reported:
//   - measured: a real fee_aed exists on that order's payout transaction
//   - estimated: no measured fee → apply a labeled per-gateway rate below
// Margin is never presented without the measured-vs-estimated fraction, so a
// founder sees both the number and how much of it is inferred. Same rule as
// pixel-vs-settled ROAS: never blend an estimate into something that looks
// measured.

export const CANCELLED = new Set(["voided", "refunded", "cancelled"]);

// Estimated gateway fee rates — used ONLY when no measured fee exists.
// Published/standard Gulf rates as of 2026 (midpoints of observed ranges),
// NOT negotiated rates. Override per-gateway with your real merchant-agreement
// numbers here — this is the single place the estimates live.
//   pct = fraction of gross; fixed = flat AED per order.
// Sources (labeled estimates, verify against your agreements):
//   Tabby/Tamara BNPL ~2.99–3.99% + AED 1–2  → 3.49% + 1.50
//   Telr Pro          2.49% + AED 0.50
//   Checkout/Stripe   ~2.9% + AED 1.00
//   COD               ~3.0% cash-handling/courier-collection cost (roughest)
export type FeeRate = { pct: number; fixed: number; label: string };

export const ESTIMATED_FEE_RATES: Record<string, FeeRate> = {
  tabby:    { pct: 0.0349, fixed: 1.5, label: "BNPL est. 3.49% + AED 1.50" },
  tamara:   { pct: 0.0349, fixed: 1.5, label: "BNPL est. 3.49% + AED 1.50" },
  telr:     { pct: 0.0249, fixed: 0.5, label: "Telr est. 2.49% + AED 0.50" },
  checkout: { pct: 0.029,  fixed: 1.0, label: "Card est. 2.90% + AED 1.00" },
  stripe:   { pct: 0.029,  fixed: 1.0, label: "Card est. 2.90% + AED 1.00" },
  cod:      { pct: 0.03,   fixed: 0.0, label: "COD est. 3.00% handling" },
};
// Fallback for an unrecognized gateway — conservative card-like rate, labeled.
const DEFAULT_FEE_RATE: FeeRate = { pct: 0.029, fixed: 1.0, label: "Est. 2.90% + AED 1.00 (default)" };

function normalizeGateway(g: string): string {
  return (g || "").toLowerCase().trim();
}
export function estimatedFeeFor(gateway: string, grossAed: number): { fee: number; rate: FeeRate } {
  const rate = ESTIMATED_FEE_RATES[normalizeGateway(gateway)] ?? DEFAULT_FEE_RATE;
  const fee = grossAed > 0 ? +(grossAed * rate.pct + rate.fixed).toFixed(2) : 0;
  return { fee, rate };
}

/* ── inputs (mirror the repositories) ───────────────────────────────────── */
export type MarginOrder = {
  uid: string; store_id: string; order_number: string; order_date: string | null;
  gross_aed: number; gateway: string; financial_status: string;
};
// Measured fees keyed by order_number, summed from payout_transactions.fee_aed
// where the parser produced a real per-transaction share. Only orders present
// in this map have a MEASURED fee; everything else is estimated.
export type MeasuredFeeByOrder = Map<string, number>;

export type StoreMargin = {
  store: string;
  revenue: number;          // sum gross_aed of valid (non-cancelled) orders
  orderCount: number;
  adSpend: number;          // from ad insights, passed in
  feesMeasured: number;     // real fee_aed
  feesEstimated: number;    // rate-applied where no measured fee
  feesTotal: number;
  measuredOrderShare: number;   // 0..1 — fraction of orders whose fee is measured
  contributionMargin: number;   // revenue − adSpend − feesTotal
  marginPct: number | null;     // contributionMargin / revenue
  feeConfidence: "measured" | "mostly_measured" | "mostly_estimated";
};

// adSpendByStore: from AdInsightsRepository aggregation (store → spend). Passed
// in rather than recomputed so this lib stays pure and testable, same as the
// CAC pass in the customers route.
export function computeStoreMargins(
  orders: MarginOrder[],
  measuredFees: MeasuredFeeByOrder,
  adSpendByStore: Map<string, number>,
  storesToShow: string[],
): StoreMargin[] {
  return storesToShow.map((store) => {
    const storeOrders = orders.filter(
      (o) => o.store_id === store && !CANCELLED.has(o.financial_status) && o.order_date,
    );
    const revenue = +storeOrders.reduce((s, o) => s + Number(o.gross_aed || 0), 0).toFixed(2);

    let feesMeasured = 0, feesEstimated = 0, measuredCount = 0;
    for (const o of storeOrders) {
      const measured = measuredFees.get(o.order_number);
      if (measured != null && measured > 0) {
        feesMeasured += measured;
        measuredCount++;
      } else {
        feesEstimated += estimatedFeeFor(o.gateway, Number(o.gross_aed || 0)).fee;
      }
    }
    feesMeasured = +feesMeasured.toFixed(2);
    feesEstimated = +feesEstimated.toFixed(2);
    const feesTotal = +(feesMeasured + feesEstimated).toFixed(2);
    const adSpend = +(adSpendByStore.get(store) ?? 0).toFixed(2);
    const contributionMargin = +(revenue - adSpend - feesTotal).toFixed(2);
    const measuredOrderShare = storeOrders.length ? measuredCount / storeOrders.length : 0;

    return {
      store, revenue, orderCount: storeOrders.length, adSpend,
      feesMeasured, feesEstimated, feesTotal, measuredOrderShare,
      contributionMargin,
      marginPct: revenue > 0 ? +(contributionMargin / revenue).toFixed(4) : null,
      feeConfidence:
        measuredOrderShare >= 0.95 ? "measured" :
        measuredOrderShare >= 0.5 ? "mostly_measured" : "mostly_estimated",
    };
  });
}

// Build the measured-fee map from payout listWithRefs() output. A payout only
// contributes measured fees for refs whose transaction share was actually
// computed (net/gross/fee > 0 or a non-null quality); the rest fall through to
// estimation. This mirrors the "0/false/null are honest placeholders" contract
// in PayoutsRepository so we never treat a placeholder 0 as a real fee.
export function buildMeasuredFeeMap(
  payouts: { transactions: { order_ref: string; net_aed: number }[] }[],
  feeByRef?: Map<string, number>,
): MeasuredFeeByOrder {
  // If the caller already has per-ref fee_aed (preferred — select it in the
  // repo), pass it as feeByRef. Otherwise we can't invent one, so return empty
  // and let everything estimate. Kept explicit so the fallback is visible.
  return feeByRef ?? new Map<string, number>();
}