//
// Search and status filtering for the Bank Transactions tab — pure,
// client-side, over whatever page of lines /api/reconcile/bank-lines
// already returned. Mirrors lib/reconciliation/filters.ts's matchesQuery
// (AND across tokens: typing more always narrows).

export type BankTxnFilterLine = {
  id: string;
  description: string;
  reference: string;
  amount: number;
  gatewayGuess: string | null;
  kind: string | null;
};

export function matchesBankTxnQuery(l: BankTxnFilterLine, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const target = [l.description, l.reference, String(l.amount), l.gatewayGuess ?? "", l.kind ?? ""]
    .join(" ")
    .toLowerCase();
  return tokens.every((t) => target.includes(t));
}

export type PostStatusFilter = "all" | "posted" | "not_posted" | "failed";

export function matchesPostStatus(
  id: string,
  postings: Record<string, { status: string } | undefined>,
  filter: PostStatusFilter,
): boolean {
  if (filter === "all") return true;
  const status = postings[id]?.status;
  if (filter === "not_posted") return !status;
  return status === filter;
}
