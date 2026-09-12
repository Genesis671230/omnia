// Pure logic, no Supabase import — kept separate from orders.repository.ts
// so it's testable without a live DB (matches this repo's convention: no
// Supabase mocks exist anywhere, DB-touching glue gets manual verification,
// pure decisions get unit tests).
//
// WHY THIS PRESERVES VALUES INSTEAD OF DROPPING KEYS
//
// The obvious way to protect a column from a re-sync is to leave it out of the
// upsert payload for that row. That does not work here. Supabase sends the
// whole batch as one PostgREST request, and PostgREST takes the union of keys
// across the array — a key present on other rows but missing from this one is
// sent as NULL for this row, not left alone. So "omit the field" actually means
// "write NULL over it". On financial_status (NOT NULL) that fails the entire
// store's upsert with a constraint violation, taking every order in the batch
// down with it; on the nullable courier/tracking columns it silently erases the
// very data the guard exists to protect.
//
// So every row keeps an identical key set, and the fields under guard are
// rewritten with the value already in the database instead of the store's.
import type { OrderRow } from "@/lib/normalize/order";

type SyncRow = Omit<OrderRow, "payout_status">;

/** What the database already holds for an order the sync is about to rewrite. */
export type ExistingOrderState = {
  /** Non-empty once this app's own SMSA flow has shipped the order. */
  awb_number?: string | null;
  financial_status?: string | null;
  courier?: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
};

// Store-reported statuses that mean "this order has not been paid yet" — the
// store simply does not know any better. The WhatsApp storefront reports every
// one of its orders as `pending` forever, because staff take payment through a
// Stripe / Tabby / Tamara link outside Shopify and nothing ever flips the
// status back. When this app's own gateway confirmers
// (lib/sync/payment-confirm-core.ts) have verified the money landed, that local
// `paid` is strictly better information than any of these.
const NOT_YET_PAID = new Set(["", "pending", "unpaid", "authorized", "partially_paid", "expired"]);

/**
 * Would writing `incoming` over a locally confirmed `paid` lose information?
 *
 * True only for the store's not-yet-paid claims. A refund, partial refund,
 * void or cancellation is a real reversal that the store IS authoritative on,
 * so those must always reach the database — freezing financial_status outright
 * would leave refunded money counted as revenue forever.
 */
export function isPaymentDowngrade(incoming: string | null | undefined): boolean {
  return NOT_YET_PAID.has((incoming || "").trim().toLowerCase());
}

/** True once this app has confirmed the money actually arrived. */
export function isLocallyConfirmedPaid(existing: ExistingOrderState | undefined): boolean {
  return (existing?.financial_status || "").trim().toLowerCase() === "paid";
}

/** True once this app's own SMSA flow owns fulfillment for the order. */
export function isShippedByUs(existing: ExistingOrderState | undefined): boolean {
  return Boolean((existing?.awb_number || "").trim());
}

/**
 * Strip the fields a re-sync must never own, and restore the ones it must not
 * overwrite.
 *
 * - `payout_status` is dropped from every row. It belongs to the reconciler,
 *   and a re-sync must never un-settle an order. Dropping it uniformly across
 *   the whole batch is safe — the key set stays identical for every row.
 * - `courier` / `tracking_number` / `tracking_url` revert to what the database
 *   holds once the order has an awb_number, because this app shipped it and the
 *   store's raw payload knows nothing about that.
 * - `financial_status` reverts to `paid` when this app has confirmed the
 *   payment and the store is still only claiming pending.
 */
export function dropClobberRiskFields(
  row: OrderRow,
  existingByUid: Map<string, ExistingOrderState> = new Map(),
): SyncRow {
  const { payout_status: _p, ...rest } = row;
  const existing = existingByUid.get(row.uid);
  if (!existing) return rest;

  const guarded: SyncRow = { ...rest };

  if (isShippedByUs(existing)) {
    guarded.courier = existing.courier ?? "";
    guarded.tracking_number = existing.tracking_number ?? "";
    guarded.tracking_url = existing.tracking_url ?? "";
  }

  if (isLocallyConfirmedPaid(existing) && isPaymentDowngrade(row.financial_status)) {
    guarded.financial_status = "paid";
  }

  return guarded;
}
