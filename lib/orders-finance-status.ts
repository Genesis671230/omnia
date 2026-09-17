import type { OrderRow } from "@/lib/types/orders";

// Shared between /api/orders and /api/customers — both need to stamp each
// order with its finance chain (payout file seen? bank settled?) from the
// same set of uploaded payout files, so this lives in one place to avoid the
// two routes silently drifting on what "missing payout" means.

/** What the order's settlement record says, when it has one. Keyed by order uid
 *  by the caller, because a settlement record belongs to exactly one order. */
export type OrderSettlementInfo = {
  settlement_id: string;
  /** How the settlement was evidenced: "stripe_api" (the gateway itself
   *  confirms the payout covered this order) or "document" (a human attached
   *  proof). Null until something evidences it. */
  evidence_type: string | null;
  evidence_confirmed: boolean;
  /** The Zoho Customer Payment this order was booked as. While a publish is
   *  mid-flight the column holds a "CLAIMED:<attempt>" lease marker rather
   *  than a real id — see settlement_records.zoho_payment_id. */
  zoho_payment_id: string | null;
  zoho_published_at: string | null;
};

/** A publish lease, not a booked payment. The column is reused for both, so
 *  anything wearing the marker must read as "not published" — treating it as
 *  an id would show a fake payment on screen and hide the row from the
 *  publish queue forever if the attempt died. */
const isPublishLease = (v: string | null): boolean => !!v && v.startsWith("CLAIMED:");

export type FinanceStamped<T> = T & {
  in_payout_file: boolean;
  finance_status: OrderRow["finance_status"];
  /** The settlement record backing this order, when one exists. */
  settlement_id: string | null;
  /** The real Zoho Customer Payment id — never a mid-flight lease marker. */
  zoho_payment_id: string | null;
  /** Evidenced, not yet booked, and not mid-publish: safe to send to Zoho. */
  zoho_ready: boolean;
};

export function computeFinanceStatuses<
  T extends { uid?: string; order_number: string; gateway: string; payout_status: string },
>(
  orders: T[],
  payouts: { order_refs: string[] }[],
  settlements: Map<string, OrderSettlementInfo> = new Map(),
): FinanceStamped<T>[] {
  // which order numbers appear in ANY uploaded payout file
  const refsSeen = new Set<string>();
  for (const p of payouts) {
    for (const ref of p.order_refs) {
      refsSeen.add(ref);
      refsSeen.add(ref.replace(/^(WA|UAE|KSA|WOO)/i, ""));
    }
  }

  return orders.map((o) => {
    const settlement = o.uid ? settlements.get(o.uid) : undefined;
    const settled = o.payout_status === "settled";
    const inPayoutFile = settled || refsSeen.has(o.order_number);

    // Only CONFIRMED evidence counts. An unconfirmed record is a row the
    // reconciler wrote in advance, not a claim that anyone verified.
    const evidenced = Boolean(settlement?.evidence_confirmed);
    // STRIPE_SETTLED is specifically "the gateway's API vouches for this".
    // A confirmed document settlement is real evidence too, but it is not that
    // claim, so it falls through to the payout-file chain rather than
    // borrowing a label that would misdescribe where the proof came from.
    const gatewayEvidenced = evidenced && settlement?.evidence_type === "stripe_api";

    const published = !isPublishLease(settlement?.zoho_payment_id ?? null)
      ? settlement?.zoho_payment_id ?? null
      : null;

    const financeStatus: OrderRow["finance_status"] =
      o.gateway === "COD"
        ? "COD_PENDING"
        : // The bank is the only source of truth: a credit that actually landed
          // outranks the gateway's own word that it sent one.
          settled
          ? "SETTLED"
          : gatewayEvidenced
            ? "STRIPE_SETTLED"
            : inPayoutFile
              ? "AWAITING_BANK"
              : "MISSING_PAYOUT";

    return {
      ...o,
      in_payout_file: inPayoutFile,
      finance_status: financeStatus,
      settlement_id: settlement?.settlement_id ?? null,
      zoho_payment_id: published,
      // Ready means: something vouched for it, nothing has booked it, and no
      // publish is currently in flight.
      zoho_ready: evidenced && !published && !isPublishLease(settlement?.zoho_payment_id ?? null),
    };
  });
}
