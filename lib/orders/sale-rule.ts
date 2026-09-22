// Which orders count as a sale — the one rule behind Gross Sales, the daily
// sales ledger and its drawer. It mirrors the founder's reference definition
// from the legacy Laravel reporting app, restated against our normalised
// columns:
//
//   every store      total > 0, and not refunded / cancelled / voided
//   WooCommerce      anything the store hasn't marked pending or failed
//                    (processing / completed are stored as "paid"; on-hold counts)
//   Shopify UAE/KSA  paid, partially paid or partially refunded, or pending COD
//   Shopify WA       paid or partially paid, or pending on any payment method —
//                    staff take the money on a Stripe / Tabby / Tamara /
//                    Checkout link (or COD) BEFORE creating the order, so
//                    Shopify's "pending" there never meant unpaid
//                    (lib/orders/store-payment-policy.ts)
//
// COD orders count as sales on the day they are placed, like the reference.
// They are still COD in every view downstream: the ledger shows them as
// "cash on delivery", never as money received from a gateway.
//
// partially_refunded counts: the customer paid and kept the order, part of the
// money went back later. Shopify rewrites a paid order's status when that
// happens, so leaving it out made real sales (e.g. SA3910) vanish from the
// day they were placed. The refund belongs to the day it was issued.

export type SaleRuleOrder = {
  store_id: string;
  financial_status: string | null;
  gateway?: string | null;
  gross_aed: number | null;
};

const REVERSED = new Set(["refunded", "cancelled", "voided"]);
const SHOPIFY_PAID = new Set(["paid", "partially_paid", "partially_refunded"]);
const WOO_COUNTED = new Set(["paid", "on-hold", "processing", "completed", "partially_refunded"]);

const isCod = (g: string | null | undefined) => (g || "").trim().toUpperCase() === "COD";

export function isCountedSale(o: SaleRuleOrder): boolean {
  if (!(Number(o.gross_aed) > 0)) return false;
  const s = (o.financial_status || "").trim().toLowerCase();
  if (REVERSED.has(s)) return false;

  if (o.store_id === "WOO") return WOO_COUNTED.has(s);
  if (SHOPIFY_PAID.has(s)) return true;
  if (s !== "pending") return false;
  // pending: COD on every Shopify store; any method on the prepaid WA store.
  return isCod(o.gateway) || o.store_id === "WA";
}

/** Reversed rather than merely unfinished — reported separately as "cancelled". */
export function isReversedOrder(o: SaleRuleOrder): boolean {
  return REVERSED.has((o.financial_status || "").trim().toLowerCase());
}
