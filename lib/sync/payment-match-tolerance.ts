// Shared amount-match policy for automated payment confirmation (Stripe,
// Telr, ...): a ref match on its own isn't enough evidence to auto-mark an
// order paid — the gateway's charged amount has to line up with the order
// total too. A flat AED tolerance turned out too strict in practice: live
// Stripe data showed genuine matches off by 0.2%-2% (FX conversion spread
// on foreign-currency payments), while unrelated ref collisions were off by
// 90%+ — so a percentage band cleanly separates real matches from noise
// without needing per-order judgment. Approved 2026-08-08 after reviewing a
// live run: 16/40 orders auto-confirmed with exact amounts, ~15 near-misses
// all under 2%, a couple of wild mismatches all over 90% off.
const TOLERANCE_RATIO = 0.03; // 3%
const TOLERANCE_FLOOR = 2; // AED (or equivalent) floor so tiny orders aren't over-strict

export function amountWithinTolerance(chargedAmount: number, orderAmount: number): boolean {
  const tolerance = Math.max(TOLERANCE_FLOOR, orderAmount * TOLERANCE_RATIO);
  return Math.abs(chargedAmount - orderAmount) <= tolerance;
}
