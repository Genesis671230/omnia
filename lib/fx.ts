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
  SAR: 0.9588,
  USD: 3.6725,
  KWD: 11.7296,
};

export function toAed(amount: number, currency: string): number {
  const rate = FX_TO_AED[currency.toUpperCase()] ?? 1;
  return +(amount * rate).toFixed(2);
}
