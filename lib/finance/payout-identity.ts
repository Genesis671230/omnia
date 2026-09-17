// Payout identity — deciding which primary key an incoming settlement report
// should claim.
//
// Tabby numbers a statement by date and currency only ("Tabby20260914AED") but
// issues one report per store, and `payouts.id` IS that statement number. So
// every same-date same-currency report overwrote its predecessor. Measured
// against the real settlement files: 13 distinct payouts collapsed onto 5 keys,
// including AED 41,080.84 and the SAR statement behind the AED 12,188.81 credit,
// both of which were lost that way.
//
// Identity is resolved by trying progressively more specific candidates and
// taking the first that is either free or already holds THIS payout:
//
//   <statement #>
//   <statement #>-<merchant slug>
//   <statement #>-<merchant slug>-<content hash>
//
// Every segment is derived from the file's own contents (the Merchant Name /
// Merchant Code columns), never from a filename — those arrive decorated with
// "(1)" and "36". The hash is deterministic over the sorted order refs, so
// re-uploading an identical file resolves to the identical id and the upsert
// stays idempotent rather than creating a duplicate.

import { createHash } from "node:crypto";

export type ExistingPayoutIdentity = {
  id: string;
  statementNo: string | null;
  merchantCode: string | null;
  store: string | null;
  /** Order refs already recorded for this payout; used to recognise a re-upload. */
  orderRefs: string[];
};

export type ResolvePayoutIdInput = {
  statementNo: string;
  merchantCode?: string | null;
  merchantName?: string | null;
  orderRefs: string[];
  /** Payouts already stored that share this statement number. */
  existing: ExistingPayoutIdentity[];
};

/** An id-safe, comparable form of a merchant code or name. */
export function merchantSlug(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Short, order-insensitive fingerprint of the orders a payout covers. */
export function refsFingerprint(orderRefs: string[]): string {
  const canonical = [...new Set(orderRefs.map((r) => String(r).trim()).filter(Boolean))]
    .sort()
    .join(",");
  return createHash("sha1").update(canonical).digest("hex").slice(0, 6);
}

/** Same set of orders ⇒ the same payout arriving again, not a new one. */
function sameOrders(a: string[], b: string[]): boolean {
  const left = new Set(a.map((r) => String(r).trim()).filter(Boolean));
  const right = new Set(b.map((r) => String(r).trim()).filter(Boolean));
  if (left.size !== right.size) return false;
  for (const ref of left) if (!right.has(ref)) return false;
  return true;
}

export function resolvePayoutId(input: ResolvePayoutIdInput): string {
  const { statementNo, merchantCode, merchantName, orderRefs, existing } = input;

  // Merchant code is the tighter discriminator ("OSUAEPL", "ORPL", "AE"); the
  // display name is the fallback when a report omits the code.
  const slug = merchantSlug(merchantCode) || merchantSlug(merchantName);

  const candidates = [
    statementNo,
    slug ? `${statementNo}-${slug}` : "",
    `${statementNo}-${slug ? `${slug}-` : ""}${refsFingerprint(orderRefs)}`,
  ].filter(Boolean);

  const byId = new Map(existing.map((e) => [e.id, e]));

  for (const candidate of candidates) {
    const holder = byId.get(candidate);
    if (!holder) return candidate; // free
    if (sameOrders(holder.orderRefs, orderRefs)) return candidate; // this same payout again
  }

  // Every candidate is taken by a different payout. The fully-qualified form is
  // the last candidate; fall back to it rather than clobbering anything.
  return candidates[candidates.length - 1];
}
