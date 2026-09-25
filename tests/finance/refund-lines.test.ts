import { test } from "node:test";
import assert from "node:assert/strict";
import { refundLinesOf } from "@/lib/finance/publish-refunds";
import type { ReconLine } from "@/lib/reconciliation/engine";

// Tamara SAR credit DSZ26248B0CBBDCG: shares are already at the bank's quoted
// rate, and the bank kept a wire charge (bank credit < payout net). The refund
// must stay at its share — the wire charge books once, on its own journal.
const line = (fxSource: "bank" | "estimate") => ({
  bankAmount: 10941.30,
  payout: { id: "TAMARA-X", net: 10989.24, source: null, currency: "SAR", fxRate: 0.9577, fxSource },
  transactions: [
    { ref: "SA3781", orderNumber: "SA3781", isRefund: true, grossShare: -685.59, netShare: -685.59, feeShare: 0, quality: null, netOriginal: null, grossOriginal: null, feeOriginal: null },
  ],
}) as unknown as ReconLine;

test("refund on a bank-rate SAR payout is not rescaled by the wire charge", () => {
  const [r] = refundLinesOf(line("bank"));
  assert.equal(r.amount, 685.59);
  assert.equal(r.charge, 0);
});

test("refund on an estimate-rate SAR payout is rescaled to what the bank paid", () => {
  const [r] = refundLinesOf(line("estimate"));
  assert.equal(r.amount, +(685.59 * 10941.30 / 10989.24).toFixed(2));
});
