//
// Search and status filtering for the Bank Transactions tab — pure,
// client-side, over whatever page of lines /api/reconcile/bank-lines
// already returned. Mirrors lib/reconciliation/filters.ts's matchesQuery
// (AND across tokens: typing more always narrows).

export type BankTxnFilterLine = {
  id: string;
  date?: string | null;
  description: string;
  zohoDescription?: string | null;
  reference: string;
  amount: number;
  direction?: string;
  gatewayGuess: string | null;
  kind: string | null;
};

/** What the Zoho side contributes to search: the booked ref, account and amount. */
export type BankTxnFilterZoho = {
  status?: string;
  zoho?: { reference: string | null; account: string | null; amount: number | null } | null;
} | undefined;

export function matchesBankTxnQuery(l: BankTxnFilterLine, query: string, zoho?: BankTxnFilterZoho): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const target = [
    l.date ?? "", l.description, l.zohoDescription ?? "", l.reference, String(l.amount), l.amount.toFixed(2),
    l.direction ?? "", l.gatewayGuess ?? "", l.kind ?? "",
    zoho?.zoho?.reference ?? "", zoho?.zoho?.account ?? "", zoho?.zoho?.amount != null ? String(zoho.zoho.amount) : "",
  ]
    .join(" ")
    .toLowerCase();
  return tokens.every((t) => target.includes(t));
}

export type PostStatusFilter = "all" | "in_zoho" | "not_in_zoho" | "needs_review" | "failed" | "not_checked";

/** Buckets the per-line Zoho status into the tab's status filter. */
export function matchesPostStatus(
  id: string,
  postings: Record<string, { status: string } | undefined>,
  filter: PostStatusFilter,
): boolean {
  if (filter === "all") return true;
  const status = postings[id]?.status;
  switch (filter) {
    case "in_zoho": return status === "verified" || status === "posted";
    case "not_in_zoho": return status === "not_in_zoho" || status === "missing_in_zoho";
    case "needs_review": return status === "amount_differs" || status === "uncategorized";
    case "failed": return status === "failed";
    case "not_checked": return !status;
  }
}
