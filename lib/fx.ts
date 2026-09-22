// AED is the reporting currency. This table is a rough parse-time preview
// ONLY — the bank actually applies its own wire-transfer conversion rate,
// which runs a real spread below the raw currency peg (observed: SAR/AED
// 0.9588, KWD/AED 11.7296, vs. peg-derived ~0.9793 / ~12.16) and moves day to
// day. Values below are the last-observed bank rates, not a peg calculation.
// The reconciliation engine (lib/reconciliation/engine.ts) does NOT rely on
// this table for matching — it reads the bank's actual quoted rate straight
// out of the credit's narration ("<CCY>/AED <rate>") when one is present.
export const FX_TO_AED: Record<string, number> = {
  AED: 1,
  SAR: 0.98,
  USD: 3.6725,
  KWD: 11.99,
  // No bank-observed rate yet for these — WooCommerce took orders in them but
  // no payout has ever settled in them. All three are USD-pegged, so the peg
  // through AED's own USD peg (3.6725) is exact to within the bank's spread.
  // Missing from this table, they converted at 1.0: an OMR 99 order counted
  // as AED 99 instead of ~AED 945.
  OMR: 9.5515, // 1 OMR = 2.6008 USD
  BHD: 9.7676, // 1 BHD = 2.6596 USD
  QAR: 1.0089, // 1 USD = 3.64 QAR
};

const warned = new Set<string>();

export function toAed(amount: number, currency: string): number {
  const code = (currency || "AED").toUpperCase();
  const rate = FX_TO_AED[code];
  if (rate === undefined) {
    // Still returns the unconverted amount (a sync must not fail on one odd
    // order), but loudly: this is exactly how OMR/BHD/QAR went unnoticed.
    if (!warned.has(code)) {
      warned.add(code);
      console.warn(`[fx] no AED rate for ${code} — amounts in ${code} are NOT converted. Add it to FX_TO_AED in lib/fx.ts.`);
    }
    return +amount.toFixed(2);
  }
  return +(amount * rate).toFixed(2);
}
