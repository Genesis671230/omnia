import type { OrderRow } from "@/lib/types/orders";

// Shared between /api/orders and /api/customers — both need to stamp each
// order with its finance chain (payout file seen? bank settled?) from the
// same set of uploaded payout files, so this lives in one place to avoid the
// two routes silently drifting on what "missing payout" means.
export function computeFinanceStatuses<
  T extends { order_number: string; gateway: string; payout_status: string },
>(
  orders: T[],
  payouts: { order_refs: string[] }[],
): (T & { in_payout_file: boolean; finance_status: OrderRow["finance_status"] })[] {
  // which order numbers appear in ANY uploaded payout file
  const refsSeen = new Set<string>();
  for (const p of payouts) {
    for (const ref of p.order_refs) {
      refsSeen.add(ref);
      refsSeen.add(ref.replace(/^(WA|UAE|KSA|WOO)/i, ""));
    }
  }

  return orders.map((o) => {
    const settled = o.payout_status === "settled";
    const inPayoutFile = settled || refsSeen.has(o.order_number);
    const financeStatus: OrderRow["finance_status"] =
      o.gateway === "COD"
        ? "COD_PENDING"
        : settled
          ? "SETTLED"
          : inPayoutFile
            ? "AWAITING_BANK"
            : "MISSING_PAYOUT";
    return { ...o, in_payout_file: inPayoutFile, finance_status: financeStatus };
  });
}
