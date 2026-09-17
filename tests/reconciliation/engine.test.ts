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

test("computeReconLines: an estimate-sourced FX payout reaches SETTLED (not stuck at PAYOUT_VARIANCE) when its variance is within the same window candidate-selection already used", () => {
  // Regression: a Tabby/Tamara SAR payout whose bank narration does NOT
  // quote a rate falls back to the static FX estimate (lib/fx.ts), which
  // will not exactly match the bank's real wire rate for the day. This
  // credit is 50 AED short of the estimate's 9,550 AED net — well past the
  // flat 1 AED tolerance that used to gate state classification
  // unconditionally, but inside the 2% candidate window (2% of 9500 = 190)
  // that already accepted this payout as the credit's best match.
  const [line] = computeReconLines({
    credits: [{
      id: "C910", statement_date: "2026-07-11",
      description: "INWARD TELEX TABBY SETTLEMENT (no rate quoted)",
      reference: "FT910", amount: 9500, gateway_guess: "Tabby", confidence: "keyword",
    }],
    payouts: [{
      id: "TABBY-EST", gateway: "Tabby", net_amount: 9550, gross_amount: 9750, fee_amount: 200,
      source: "tabby.xlsx", status: "uploaded", order_refs: ["SA100"],
      original_currency: "SAR", net_original: 9948,
      transactions: [
        { order_ref: "SA100", net_aed: 9550, gross_aed: 9750, fee_aed: 200, is_refund: false, quality: "clean" },
      ],
    }],
    orders: [{ order_number: "SA100" }],
    confirmations: new Map(),
  });

  assert.equal(line.payout!.fxSource, "estimate", "narration has no quoted rate, so this must be the estimate path");
  assert.equal(line.variance, -50, "50 AED variance from the estimate, same as before the fix");
  assert.equal(line.state, "SETTLED", "estimate-sourced variance within the 2% candidate window must not block confirmation");
});

test("computeReconLines: a non-FX payout with a genuine >1 AED variance still lands in PAYOUT_VARIANCE — the looser window is estimate-only", () => {
  // Same shape and same 50 AED variance as the estimate case above, but no
  // currency conversion at all (original_currency: null) — a real,
  // unexplained AED mismatch on a domestic payout is exactly what
  // PAYOUT_VARIANCE exists to catch, and the fix must not have loosened
  // the bar for this case.
  const [line] = computeReconLines({
    credits: [{
      id: "C911", statement_date: "2026-07-11", description: "TEST NARRATION",
      reference: "INV911", amount: 9500, gateway_guess: "COD", confidence: "keyword",
    }],
    payouts: [{
      id: "COD-911", gateway: "COD", net_amount: 9550, gross_amount: 9550, fee_amount: 0,
      source: "test.csv", status: "uploaded", order_refs: ["5911"],
      original_currency: null, net_original: null, transactions: [],
    }],
    orders: [{ order_number: "5911" }],
    confirmations: new Map(),
  });

  assert.equal(line.payout!.fxSource, null, "no currency conversion on this line");
  assert.equal(line.variance, -50);
  assert.equal(line.state, "PAYOUT_VARIANCE", "a genuine AED-native mismatch must still be flagged, not silently settled");
});

test("computeReconLines: rescale never dumps the whole payout onto one row when every parsed share is zero (stale pre-fix data)", () => {
  // Real-world trigger: payout_transactions rows persisted before the parser
  // tracked per-order shares (quality: null, every share 0) — the "give the
  // rounding remainder to the largest share" logic must not treat the
  // entire payout net as a single row's rounding remainder.
  const [line] = computeReconLines({
    credits: [{
      id: "C901", statement_date: "2026-07-11", description: "TABBY SETTLEMENT",
      reference: "FT901", amount: 100, gateway_guess: "Tabby", confidence: "keyword",
    }],
    payouts: [{
      id: "TABBY-STALE", gateway: "Tabby", net_amount: 100, gross_amount: 107, fee_amount: 7,
      source: "tabby.xlsx", status: "uploaded", order_refs: ["SA7", "SA8", "SA9", "SA10"],
      original_currency: null, net_original: null,
      transactions: [
        { order_ref: "SA7", net_aed: 0, gross_aed: 0, fee_aed: 0, is_refund: false, quality: null },
        { order_ref: "SA8", net_aed: 0, gross_aed: 0, fee_aed: 0, is_refund: false, quality: null },
        { order_ref: "SA9", net_aed: 0, gross_aed: 0, fee_aed: 0, is_refund: false, quality: null },
        { order_ref: "SA10", net_aed: 0, gross_aed: 0, fee_aed: 0, is_refund: false, quality: null },
      ],
    }],
    orders: [{ order_number: "SA7" }, { order_number: "SA8" }, { order_number: "SA9" }, { order_number: "SA10" }],
    confirmations: new Map(),
  });

  const sum = +line.transactions.reduce((s, t) => s + t.netShare, 0).toFixed(2);
  assert.equal(sum, line.payout!.net, "total must still foot exactly");

  const maxShare = Math.max(...line.transactions.map((t) => Math.abs(t.netShare)));
  assert.ok(
    maxShare < line.payout!.net,
    "no single row may silently absorb the entire payout total when the underlying data has no real per-order split",
  );
});

// ── attached payouts, manual links, partial confirmation ────────────────────

const tx = (order_ref: string, net: number, is_refund = false) => ({
  order_ref, is_refund, quality: null, net_aed: net, gross_aed: net, fee_aed: 0,
  net_original: null, gross_original: null, fee_original: null,
});

test("computeReconLines: a payout attached to a credit shows there even when its total is off", () => {
  const lines = computeReconLines({
    credits: [
      { id: "C1", statement_date: "2026-09-08", description: "TAMARA", reference: "FT1", amount: 17783.66, gateway_guess: "Tamara", confidence: "keyword" },
      { id: "C2", statement_date: "2026-09-08", description: "TAMARA", reference: "FT2", amount: 18376.08, gateway_guess: "Tamara", confidence: "keyword" },
    ],
    payouts: [{
      id: "TAMARA-X", gateway: "Tamara", net_amount: 18376.08, gross_amount: 18376.08, fee_amount: 0,
      source: "x.xlsx", status: "uploaded", order_refs: ["804517"], original_currency: null, net_original: null,
      transactions: [tx("804517", 18376.08)], bank_line_id: "C1",
    }],
    orders: [{ order_number: "804517" }],
    confirmations: new Map(),
  });
  const c1 = lines.find((l) => l.id === "C1")!;
  const c2 = lines.find((l) => l.id === "C2")!;
  assert.equal(c1.payout?.id, "TAMARA-X", "attached payout stays on its credit");
  assert.equal(c1.state, "PAYOUT_VARIANCE");
  assert.equal(c2.payout, null, "an attached payout never auto-matches another credit, even an exact one");
});

test("computeReconLines: a manual link resolves a phone-number line to its order", () => {
  const base = {
    credits: [{ id: "C1", statement_date: "2026-09-08", description: "TAMARA", reference: "FT1", amount: 1100, gateway_guess: "Tamara", confidence: "keyword" }],
    payouts: [{
      id: "TAMARA-X", gateway: "Tamara", net_amount: 1100, gross_amount: 1100, fee_amount: 0, source: "x", status: "uploaded",
      order_refs: ["804517", "0655572535"], original_currency: null, net_original: null,
      transactions: [tx("804517", 800), tx("0655572535", 300)],
    }],
    orders: [{ order_number: "804517" }, { order_number: "WA55600" }],
    confirmations: new Map(),
  };
  const [unlinked] = computeReconLines(base);
  assert.equal(unlinked.state, "ORDERS_UNRESOLVED");
  assert.deepEqual(unlinked.unresolvedRefs, ["0655572535"]);
  assert.equal(unlinked.transactions.find((t) => t.ref === "0655572535")?.orderNumber, null);

  const [linked] = computeReconLines({ ...base, links: new Map([["TAMARA-X|0655572535", "WA55600"]]) });
  assert.equal(linked.state, "SETTLED");
  assert.deepEqual(linked.resolvedOrders.sort(), ["804517", "WA55600"]);
  assert.equal(linked.transactions.find((t) => t.ref === "0655572535")?.orderNumber, "WA55600");
});

test("isConfirmablePartial: payout foots and some orders matched, others not", async () => {
  const { isConfirmablePartial } = await import("@/lib/reconciliation/engine");
  const payout = { id: "P", net: 1, source: null, currency: null, fxRate: null, fxSource: null } as const;
  assert.equal(isConfirmablePartial({ state: "ORDERS_UNRESOLVED", payout, resolvedOrders: ["1"] }), true);
  assert.equal(isConfirmablePartial({ state: "ORDERS_UNRESOLVED", payout, resolvedOrders: [] }), false);
  assert.equal(isConfirmablePartial({ state: "PAYOUT_VARIANCE", payout, resolvedOrders: ["1"] }), false);
});

/* ── The bank's own cut on a cross-border wire ───────────────────────────────
 * Real credit DSZ26252CHJHFHHK (Tabby SAR, 2026-09-09). The narration quotes
 * SAR/AED 0.958918, which values the payout's 12,761.00 SAR at AED 12,236.75.
 * The bank credited AED 12,188.81 — it kept AED 47.94 on the way in. Every
 * order on the file is matched and the payout itself is not in dispute, so
 * this must stay confirmable and bookable: the AED 47.94 is an exchange
 * difference, not evidence that the payout is wrong.
 */
const TABBY_SAR_CREDIT = {
  id: "C-DSZ", statement_date: "2026-09-09",
  description:
    "Inward Telex Payment/Sender Info:SA SABB 003-777729-001, TABI COMPANY FOR FINANCING " +
    "MUSAHAMA/TT CPMP005AEBBI/Rmt Info:BUSINESS RELATED PAYMENT OMNIASTORES KSA BILL " +
    "07092026GMV/SAR/AED 0.958918/ DSZ26252CHJHFHHK DSZ26252CHJHFHHK",
  reference: "DSZ26252CHJHFHHK", amount: 12188.81,
  gateway_guess: "Tabby", confidence: "keyword" as const,
};

const tabbySarPayout = (netAed: number) => ({
  id: "TABBY-SAR-1", gateway: "Tabby", net_amount: netAed, gross_amount: netAed + 865.05,
  fee_amount: 865.05, source: "tabby-sar.xlsx", status: "uploaded",
  order_refs: ["804734", "805051"],
  original_currency: "SAR", net_original: 12761.0,
  transactions: [
    { order_ref: "804734", net_aed: netAed * 0.6, gross_aed: netAed * 0.64, fee_aed: netAed * 0.04, is_refund: false, quality: "clean" },
    { order_ref: "805051", net_aed: netAed * 0.4, gross_aed: netAed * 0.43, fee_aed: netAed * 0.03, is_refund: false, quality: "clean" },
  ],
});

test("computeReconLines: the bank keeping AED 47.94 on a SAR wire stays confirmable, not a dead-end variance", async () => {
  const { isBankFxVariance, isConfirmable } = await import("@/lib/reconciliation/engine");
  const [line] = computeReconLines({
    credits: [TABBY_SAR_CREDIT],
    payouts: [tabbySarPayout(12000)],
    orders: [{ order_number: "804734" }, { order_number: "805051" }],
    confirmations: new Map(),
  });

  assert.equal(line.payout!.fxSource, "bank");
  assert.equal(line.payout!.fxRate, 0.958918);
  assert.equal(line.payout!.net, 12236.75, "12,761.00 SAR at the bank's own quoted rate");
  assert.equal(line.variance, -47.94);
  assert.equal(line.state, "PAYOUT_VARIANCE", "the gap is real and stays visible");
  assert.equal(isBankFxVariance(line), true, "but it is the bank's cut, so it can be booked");
  assert.equal(isConfirmable(line), true);
});

test("isBankFxVariance: only a small cross-border gap with matched orders qualifies", async () => {
  const { isBankFxVariance } = await import("@/lib/reconciliation/engine");
  const sar = { id: "P", net: 12236.75, source: null, currency: "SAR", fxRate: 0.958918, fxSource: "bank" as const };
  const base = { state: "PAYOUT_VARIANCE" as const, payout: sar, resolvedOrders: ["1"], bankAmount: 12188.81, variance: -47.94 };

  assert.equal(isBankFxVariance(base), true);
  assert.equal(isBankFxVariance({ ...base, resolvedOrders: [] }), false, "nothing matched to book");
  assert.equal(isBankFxVariance({ ...base, state: "SETTLED" }), false, "already settled, not a variance");
  assert.equal(
    isBankFxVariance({ ...base, variance: -900, bankAmount: 11336.75 }),
    false,
    "AED 900 on a 12k wire is not a bank charge — a person looks",
  );
  assert.equal(
    isBankFxVariance({
      ...base,
      payout: { id: "P", net: 100, source: null, currency: null, fxRate: null, fxSource: null },
      bankAmount: 98.5, variance: 1.5,
    }),
    false,
    "an AED-native gap is never an exchange difference",
  );
});

test("computeReconLines: a cross-border gap too big to be the bank's cut stays a dead stop", async () => {
  const { isBankFxVariance } = await import("@/lib/reconciliation/engine");
  // 12,236.75 expected vs 12,000 credited — AED 236.75, inside the 2% window
  // that lets the payout match the credit at all, but far past a wire charge.
  const [line] = computeReconLines({
    credits: [{ ...TABBY_SAR_CREDIT, amount: 12000 }],
    payouts: [tabbySarPayout(12000)],
    orders: [{ order_number: "804734" }, { order_number: "805051" }],
    confirmations: new Map(),
  });

  assert.equal(line.state, "PAYOUT_VARIANCE");
  assert.equal(isBankFxVariance(line), false);
});
