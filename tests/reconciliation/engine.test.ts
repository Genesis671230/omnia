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

/* ── FX rescale: per-order shares must foot to the bank-confirmed net ────────
 * Parsers convert cross-currency payouts (Tabby SAR/KWD, non-UAE Tamara) to
 * AED at UPLOAD time using the static estimate in lib/fx.ts. The engine then
 * recomputes the authoritative net at MATCH time from the bank's own quoted
 * wire rate in the narration. Those are two different rates, so the parser's
 * per-order shares do NOT sum to the confirmed net whenever the bank's rate
 * differs — which is exactly the cross-border case. Rescaling here keeps the
 * proof table's rows and its header total in agreement to the cent.
 */

// 1000 SAR net at the parser's static estimate, then the bank's narration
// quotes SAR/AED 1.00 — so the authoritative AED net is 1000.00, not 980.00.
const SAR_CREDIT = {
  id: "C900", statement_date: "2026-07-11",
  description: "INWARD TELEX SAR/AED 1.00 TABBY SETTLEMENT",
  reference: "FT900", amount: 1000, gateway_guess: "Tabby", confidence: "keyword" as const,
};

test("computeReconLines: bank-quoted FX rescales per-order shares to foot exactly to the confirmed net", () => {
  const [line] = computeReconLines({
    credits: [SAR_CREDIT],
    payouts: [{
      id: "TABBY-1", gateway: "Tabby", net_amount: 980, gross_amount: 1000, fee_amount: 20,
      source: "tabby.xlsx", status: "uploaded", order_refs: ["SA1", "SA2"],
      original_currency: "SAR", net_original: 1000,
      transactions: [
        { order_ref: "SA1", net_aed: 588, gross_aed: 600, fee_aed: 12, is_refund: false, quality: "clean" },
        { order_ref: "SA2", net_aed: 392, gross_aed: 400, fee_aed: 8, is_refund: false, quality: "clean" },
      ],
    }],
    orders: [{ order_number: "SA1" }, { order_number: "SA2" }],
    confirmations: new Map(),
  });

  assert.equal(line.state, "SETTLED");
  assert.equal(line.payout!.fxSource, "bank");
  assert.equal(line.payout!.net, 1000);

  const sum = +line.transactions.reduce((s, t) => s + t.netShare, 0).toFixed(2);
  assert.equal(sum, line.payout!.net, "per-order shares must sum to the bank-confirmed net");
  // 588 and 392 scaled by 1000/980
  assert.equal(line.transactions.find((t) => t.ref === "SA1")!.netShare, 600);
  assert.equal(line.transactions.find((t) => t.ref === "SA2")!.netShare, 400);
});

test("computeReconLines: rescale is a no-op when the rate came from our static estimate", () => {
  const [line] = computeReconLines({
    credits: [{ ...SAR_CREDIT, description: "INWARD TELEX TABBY SETTLEMENT (no rate quoted)" }],
    payouts: [{
      id: "TABBY-2", gateway: "Tabby", net_amount: 1000, gross_amount: 1020, fee_amount: 20,
      source: "tabby.xlsx", status: "uploaded", order_refs: ["SA3"],
      original_currency: "SAR", net_original: 1042,
      transactions: [
        { order_ref: "SA3", net_aed: 1000, gross_aed: 1020, fee_aed: 20, is_refund: false, quality: "clean" },
      ],
    }],
    orders: [{ order_number: "SA3" }],
    confirmations: new Map(),
  });

  assert.equal(line.payout!.fxSource, "estimate");
  assert.equal(line.transactions[0].netShare, 1000, "estimate path must leave parser shares untouched");
});

test("computeReconLines: rescale rounding remainder lands on the largest share, never dropped", () => {
  const [line] = computeReconLines({
    credits: [{ ...SAR_CREDIT, amount: 100 }],
    payouts: [{
      id: "TABBY-3", gateway: "Tabby", net_amount: 99, gross_amount: 99, fee_amount: 0,
      source: "tabby.xlsx", status: "uploaded", order_refs: ["SA4", "SA5", "SA6"],
      original_currency: "SAR", net_original: 100,
      transactions: [
        { order_ref: "SA4", net_aed: 33, gross_aed: 33, fee_aed: 0, is_refund: false, quality: "clean" },
        { order_ref: "SA5", net_aed: 33, gross_aed: 33, fee_aed: 0, is_refund: false, quality: "clean" },
        { order_ref: "SA6", net_aed: 33, gross_aed: 33, fee_aed: 0, is_refund: false, quality: "clean" },
      ],
    }],
    orders: [{ order_number: "SA4" }, { order_number: "SA5" }, { order_number: "SA6" }],
    confirmations: new Map(),
  });

  const sum = +line.transactions.reduce((s, t) => s + t.netShare, 0).toFixed(2);
  assert.equal(sum, line.payout!.net, "no cent may be lost to rounding");
});
