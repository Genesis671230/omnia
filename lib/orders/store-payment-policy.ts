// When is a store's own `financial_status` trustworthy?
//
// For Shopify UAE, Shopify KSA and WooCommerce it always is: the customer pays
// through the storefront, so the store watches the payment happen and reports
// it honestly.
//
// The WhatsApp storefront works backwards. Staff take the payment first — over
// a Stripe, Tabby, Tamara or Telr link sent in the chat — and only then create
// the order in Shopify as a record of a sale that has already happened. Nothing
// in that flow ever tells Shopify the money arrived, so Shopify reports
// `pending` on every one of those orders, permanently. Across a recent 30-day
// window that was 293 of 296 WA orders.
//
// Anything counting paid orders (Gross Sales, the CFO digest, reconciliation)
// therefore read the WhatsApp store as very close to zero revenue, which is why
// the founder dashboard showed AED 0 for WA on days the store had genuinely
// sold tens of thousands of dirhams.
//
// So for WA the store's "not paid yet" claim carries no information and is
// replaced with the truth: the order exists, therefore it was paid. A reversal
// (refunded / partially refunded / voided / cancelled) is different — that is
// the store reporting something it genuinely does know, and it always wins.

import { isPaymentDowngrade } from "@/lib/orders-clobber-guard";

/** Storefronts where the order is only created after the money is in. */
export const PREPAID_AT_CREATION_STORES = new Set(["WA"]);

/**
 * Cash on Delivery cannot have been collected before the order exists — the
 * cash arrives with the courier. COD orders are left at the store's own status
 * so they are not counted as revenue before anyone has been paid, and flow
 * through the normal confirmation path instead.
 *
 * Set ORDERS_WA_COUNT_COD_AS_PAID=true to override, if WhatsApp COD orders in
 * this business are in fact collected up front.
 */
function codCountsAsPaid(): boolean {
  return (process.env.ORDERS_WA_COUNT_COD_AS_PAID || "").toLowerCase() === "true";
}

export function isCashOnDelivery(gateway: string | null | undefined): boolean {
  return (gateway || "").trim().toUpperCase() === "COD";
}

/**
 * The financial_status to store, given what the store reported.
 *
 * Pure, so the decision is testable without a store or a database.
 */
export function resolveFinancialStatus({
  storeId,
  reportedStatus,
  gateway,
}: {
  storeId: string;
  reportedStatus: string | null | undefined;
  gateway: string | null | undefined;
}): string {
  const reported = (reportedStatus || "").trim().toLowerCase();

  if (!PREPAID_AT_CREATION_STORES.has(storeId)) return reported;
  // A reversal is real information from the store. Never overwrite it.
  if (!isPaymentDowngrade(reported)) return reported;
  if (isCashOnDelivery(gateway) && !codCountsAsPaid()) return reported;

  return "paid";
}
