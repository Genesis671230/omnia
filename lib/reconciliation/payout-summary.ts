// Payout summary bar totals — Gross/Net/Awaiting/Fees/Refunds, all derived
// from data already on ReconLine so these numbers can never drift from the
// rows a founder is looking at. See payout-summary-bar.tsx for why
// "Exchanges" is NOT computed here (it has no bank-credit/payout data at
// all — it lives in the Google-Sheets pathway).

export type PayoutSummaryLineInput = {
  state: string;
  bankAmount: number;
  payout: { net: number } | null;
  transactions: { grossShare: number; feeShare: number; netShare: number; isRefund: boolean }[];
};

export type PayoutSummaryTotals = {
  grossAed: number;
  netAed: number;
  awaitingAed: number;
  feesAed: number;
  refundsAed: number;
};

export function computePayoutSummary(lines: PayoutSummaryLineInput[]): PayoutSummaryTotals {
  let grossAed = 0, netAed = 0, awaitingAed = 0, feesAed = 0, refundsAed = 0;

  for (const line of lines) {
    if (line.payout) netAed += line.payout.net;
    if (line.state === "AWAITING_PAYOUT") awaitingAed += line.bankAmount;

    for (const t of line.transactions) {
      grossAed += t.grossShare;
      feesAed += t.feeShare;
      if (t.isRefund) refundsAed += Math.abs(t.netShare);
    }
  }

  return {
    grossAed: +grossAed.toFixed(2),
    netAed: +netAed.toFixed(2),
    awaitingAed: +awaitingAed.toFixed(2),
    feesAed: +feesAed.toFixed(2),
    refundsAed: +refundsAed.toFixed(2),
  };
}
