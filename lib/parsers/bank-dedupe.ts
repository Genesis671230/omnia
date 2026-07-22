// Pure identity function for a parsed bank line — kept separate from
// bank.repository.ts (which pulls in the Supabase client) so it can be unit
// tested without a live DB connection, and reused by one-off scripts that
// need to reason about row identity without touching the database.

import type { ParsedBankLine } from "@/lib/parsers/bank";

// Cross-format fingerprint: the PDF and CSV renderings of one transaction
// differ in description tails (merged reference tokens, \HCP suffixes),
// never in the head — so fingerprint the reference-scrubbed prefix.
//
// A genuine bank wire/transfer id (extractReference() returns the FT/DSZ/
// INSTQ code, never the "INV..." invoice fallback) identifies exactly one
// CREDIT — the bank assigns it once per inbound payment (verified: zero
// collisions across live statements) — so for credits it's safe to drop
// amount from the key entirely. That's what lets a corrected re-parse
// (regex fix, healed narration) land on the same row and heal it via
// update, instead of the old amount-inclusive key producing a second,
// permanently-stale row next to the fixed one.
//
// DEBITS are different: one wire transfer legitimately produces several
// sibling debit rows under the SAME reference — the outward transfer
// itself, its "Account Transfer Charges" fee, and the tax on that fee, e.g.
// FT26195SG8YG appearing as AED 50000 / AED 1 / AED 0.05 on the same date.
// Dropping amount there would collapse three distinct real transactions
// into one row, so debits always keep amount (+ narration prefix) in the
// key, same as transactions with no wire id at all (COD/invoice
// narrations, where amount + narration prefix is the only signal available
// to avoid conflating two distinct same-day transactions).
// True for a credit whose reference is the bank's own wire/transfer id
// (rather than the empty string or the "INV..." invoice-number fallback) —
// the case where date+direction+reference alone is a trustworthy, amount-
// independent identity. Exported so BankRepository can look an existing row
// up by these same columns directly: rows inserted before this identity
// rule existed still have an OLD-FORMAT (amount-inclusive) string sitting in
// their dedupe_key column, so a plain string-equality match against a
// freshly computed key would never find them.
export function hasStableWireIdentity(l: Pick<ParsedBankLine, "reference" | "direction">): boolean {
  return l.reference !== "" && !l.reference.startsWith("INV") && l.direction === "credit";
}

export function dedupeKey(l: ParsedBankLine): string {
  if (hasStableWireIdentity(l)) return [l.date, l.direction, l.reference].join("|");

  let scrubbed = l.narration.replace(/\\HCP\b/g, "");
  if (l.reference) scrubbed = scrubbed.split(l.reference).join(" ");
  const descPrefix = scrubbed.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40);
  return [l.date, l.direction, l.amount.toFixed(2), l.reference, descPrefix].join("|");
}
