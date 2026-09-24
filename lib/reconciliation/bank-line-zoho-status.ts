// One Zoho status per bank line, merged from two sources:
//   - bank_line_zoho_status  — what the Zoho LEDGER holds (written by Refresh)
//   - zoho_bank_txn_postings — what THIS APP posted
// Pure and client-safe (type-only imports), so the tab, the post dialog and
// the post route all agree on what "already in Zoho" means.

import type { BankLineZohoStatusRow, ZohoBankTxnPostingRow } from "@/lib/repositories/zoho-bank-txn.repository";

export type LineZohoStatus =
  | "verified"        // booked in Zoho (on its own, or combined with sibling lines)
  | "uncategorized"   // in Zoho's bank feed, not booked yet
  | "amount_differs"  // the ref is in Zoho but no amount lines up
  | "posted"          // this app posted it after the last Refresh
  | "missing_in_zoho" // this app posted it, but the ledger no longer has it
  | "failed"          // this app's post attempt failed
  | "not_in_zoho";    // checked, not there

export type LineZohoDetail = {
  reference: string | null;
  amount: number | null;
  type: string | null;
  account: string | null;
  date: string | null;
  matchKind: string | null;
  transactionIds: string[];
};

export type LineZohoState = {
  status: LineZohoStatus;
  zohoTransactionId: string | null;
  zohoStatus: string | null;
  error: string;
  postedAt: string;
  checkedAt: string | null;
  zoho: LineZohoDetail | null;
};

/** Statuses meaning "do not post this again". */
export function isInZoho(status: string | undefined | null): boolean {
  return status === "verified" || status === "posted";
}

export function mergeLineZohoStatus(
  ledger: BankLineZohoStatusRow | undefined,
  posting: ZohoBankTxnPostingRow | undefined,
): LineZohoState | null {
  if (!ledger && !posting) return null;

  const base = {
    zohoTransactionId: posting?.zoho_transaction_id ?? null,
    zohoStatus: posting?.zoho_status ?? null,
    error: posting?.error ?? "",
    postedAt: posting?.posted_at ?? "",
    checkedAt: ledger?.checked_at ?? null,
    zoho: null as LineZohoDetail | null,
  };

  // Never refreshed: all we know is what this app did.
  if (!ledger) {
    const s = posting!.status;
    return { ...base, status: s === "verified" || s === "missing_in_zoho" || s === "failed" ? s : "posted" };
  }

  const zoho: LineZohoDetail = {
    reference: ledger.zoho_reference,
    amount: ledger.zoho_amount == null ? null : Number(ledger.zoho_amount),
    type: ledger.zoho_type,
    account: ledger.zoho_account,
    date: ledger.zoho_date,
    matchKind: ledger.match_kind,
    transactionIds: ledger.zoho_transaction_ids ?? [],
  };
  const withZoho = { ...base, zoho, zohoTransactionId: zoho.transactionIds[0] ?? base.zohoTransactionId, zohoStatus: ledger.zoho_status };

  if (ledger.state === "in_zoho") return { ...withZoho, status: "verified" };

  // Posted by this app after the last Refresh — the ledger snapshot predates it.
  if (posting && posting.status !== "failed" && Date.parse(posting.posted_at) > Date.parse(ledger.checked_at)) {
    return { ...base, status: "posted" };
  }
  if (ledger.state === "uncategorized") return { ...withZoho, status: "uncategorized" };
  if (ledger.state === "amount_differs") return { ...withZoho, status: "amount_differs" };
  if (posting?.status === "failed") return { ...base, status: "failed" };
  if (posting) return { ...base, status: "missing_in_zoho" };
  return { ...base, status: "not_in_zoho" };
}
