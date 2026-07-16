// AED is the reporting currency. SAR/AED are both USD-pegged, so a fixed
// rate is fine here; the bank's own quoted rate (see statement narrations)
// hovers at the same value.
export const FX_TO_AED: Record<string, number> = {
  AED: 1,
  SAR: 0.9786,
  USD: 3.6725,
  KWD: 11.9,
};

export function toAed(amount: number, currency: string): number {
  const rate = FX_TO_AED[currency.toUpperCase()] ?? 1;
  return +(amount * rate).toFixed(2);
}
