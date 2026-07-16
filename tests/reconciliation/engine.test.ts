import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReconLines } from "@/lib/reconciliation/engine";

test("computeReconLines: exact-amount match settles the order", () => {
  const lines = computeReconLines({
    credits: [{
      id: "C001", statement_date: "2026-07-11", description: "TEST NARRATION",
      reference: "INV1001", amount: 100, gateway_guess: "COD", confidence: "keyword",
    }],
    payouts: [{
      id: "COD-1001", gateway: "COD", net_amount: 100, gross_amount: 100, fee_amount: 0,
      source: "test.csv", status: "uploaded", order_refs: ["5001"],
      original_currency: null, net_original: null, transactions: [],
    }],
    orders: [{ order_number: "5001" }],
    confirmations: new Map(),
  });

  assert.equal(lines.length, 1);
  assert.equal(lines[0].state, "SETTLED");
  assert.equal(lines[0].variance, 0);
  assert.deepEqual(lines[0].resolvedOrders, ["5001"]);
});

test("computeReconLines: amount mismatch beyond tolerance is PAYOUT_VARIANCE, not silently accepted", () => {
  // Note: the candidate-selection step only considers a payout a match for a
  // credit when |net - amount| <= max(TOLERANCE_AED, amount * 0.02) — for a
  // 100 AED credit that's a 2 AED window. A gap larger than that (e.g. 10 AED,
  // as originally drafted) means no payout is ever found at all, landing in
  // AWAITING_PAYOUT instead. To exercise PAYOUT_VARIANCE the gap must sit
  // inside that window but still exceed TOLERANCE_AED (1 AED) — 1.5 AED does
  // both. This is unchanged, pre-existing engine behavior (verified against
  // the pre-refactor code), not something introduced by this extraction.
  const lines = computeReconLines({
    credits: [{
      id: "C002", statement_date: "2026-07-11", description: "TEST NARRATION",
      reference: "INV1002", amount: 100, gateway_guess: "COD", confidence: "keyword",
    }],
    payouts: [{
      id: "COD-1002", gateway: "COD", net_amount: 98.5, gross_amount: 98.5, fee_amount: 0,
      source: "test.csv", status: "uploaded", order_refs: ["5002"],
      original_currency: null, net_original: null, transactions: [],
    }],
    orders: [{ order_number: "5002" }],
    confirmations: new Map(),
  });

  assert.equal(lines.length, 1);
  assert.equal(lines[0].state, "PAYOUT_VARIANCE");
  assert.equal(lines[0].variance, 1.5);
});

test("computeReconLines: no matching payout leaves the credit AWAITING_PAYOUT", () => {
  const lines = computeReconLines({
    credits: [{
      id: "C003", statement_date: "2026-07-11", description: "TEST NARRATION",
      reference: "INV1003", amount: 100, gateway_guess: "COD", confidence: "keyword",
    }],
    payouts: [],
    orders: [],
    confirmations: new Map(),
  });

  assert.equal(lines[0].state, "AWAITING_PAYOUT");
  assert.equal(lines[0].payout, null);
});
