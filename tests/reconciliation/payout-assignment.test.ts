import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReconLines } from "@/lib/reconciliation/engine";

// Candidate selection accepts any payout within max(1 AED, 2% of the credit)
// and used to take the FIRST one found. With several same-gateway payouts of
// similar size, an earlier credit grabbed a payout belonging to a later one and
// the later credit inherited the leftover — so BOTH landed in PAYOUT_VARIANCE
// and neither could ever be closed.
//
// Measured on live data: all 18 Stripe credits sitting in PAYOUT_VARIANCE had
// an exactly-matching payout available, swapped in pairs:
//   7455.77  held po_1Tqjen, wanted po_1UCqGq
//   7384.87  held po_1UCqGq, wanted po_1Tqjen

const credit = (id: string, amount: number, date = "2026-09-01") => ({
  id, statement_date: date, description: "STRIPE- TOKEN", reference: id,
  amount, gateway_guess: "Stripe", confidence: "keyword",
});

const payout = (id: string, net: number, refs: string[]) => ({
  id, gateway: "Stripe", net_amount: net, gross_amount: net, fee_amount: 0,
  source: "stripe-api", status: "uploaded", order_refs: refs,
  original_currency: null, net_original: null, transactions: [],
});

test("two credits each take their own exact payout instead of swapping", () => {
  const lines = computeReconLines({
    // C1 is processed first and, under first-fit, would grab P2 (within 2%).
    credits: [credit("C1", 7455.77), credit("C2", 7384.87)],
    payouts: [payout("P2", 7384.87, ["5002"]), payout("P1", 7455.77, ["5001"])],
    orders: [{ order_number: "5001" }, { order_number: "5002" }],
    confirmations: new Map(),
  });

  const c1 = lines.find((l) => l.id === "C1")!;
  const c2 = lines.find((l) => l.id === "C2")!;
  assert.equal(c1.payout?.id, "P1", "C1 must take its exact match, not the first in range");
  assert.equal(c2.payout?.id, "P2");
  assert.equal(c1.variance, 0);
  assert.equal(c2.variance, 0);
  assert.equal(c1.state, "SETTLED");
  assert.equal(c2.state, "SETTLED");
});

test("a three-way near-miss cluster resolves to all exact matches", () => {
  const lines = computeReconLines({
    credits: [credit("C1", 30575.22), credit("C2", 30031.75), credit("C3", 30300.0)],
    payouts: [
      payout("P3", 30300.0, ["5003"]),
      payout("P1", 30575.22, ["5001"]),
      payout("P2", 30031.75, ["5002"]),
    ],
    orders: [{ order_number: "5001" }, { order_number: "5002" }, { order_number: "5003" }],
    confirmations: new Map(),
  });

  for (const [creditId, payoutId] of [["C1", "P1"], ["C2", "P2"], ["C3", "P3"]]) {
    const l = lines.find((x) => x.id === creditId)!;
    assert.equal(l.payout?.id, payoutId, `${creditId} should hold ${payoutId}`);
    assert.equal(l.variance, 0);
  }
});

test("a pinned payout still wins over a closer-matching unpinned one", () => {
  // Pinning is a human decision — uploading a file from a credit's own panel.
  // Amount proximity must never override it.
  const lines = computeReconLines({
    credits: [credit("C1", 1000)],
    payouts: [
      payout("EXACT", 1000, ["5001"]),
      { ...payout("PINNED", 1005, ["5002"]), bank_line_id: "C1" },
    ],
    orders: [{ order_number: "5001" }, { order_number: "5002" }],
    confirmations: new Map(),
  });
  assert.equal(lines[0].payout?.id, "PINNED");
});

test("a payout pinned to another credit is never stolen", () => {
  const lines = computeReconLines({
    credits: [credit("C1", 1000)],
    payouts: [{ ...payout("OTHER", 1000, ["5001"]), bank_line_id: "C-OTHER" }],
    orders: [{ order_number: "5001" }],
    confirmations: new Map(),
  });
  assert.equal(lines[0].payout, null);
  assert.equal(lines[0].state, "AWAITING_PAYOUT");
});

test("one payout is never assigned to two credits", () => {
  const lines = computeReconLines({
    credits: [credit("C1", 1000), credit("C2", 1000)],
    payouts: [payout("ONLY", 1000, ["5001"])],
    orders: [{ order_number: "5001" }],
    confirmations: new Map(),
  });
  const holders = lines.filter((l) => l.payout?.id === "ONLY");
  assert.equal(holders.length, 1, "a payout explains exactly one credit");
  assert.equal(lines.filter((l) => l.payout === null).length, 1);
});

test("assignment does not depend on the order credits arrive in", () => {
  const forward = computeReconLines({
    credits: [credit("C1", 7455.77), credit("C2", 7384.87)],
    payouts: [payout("P1", 7455.77, ["5001"]), payout("P2", 7384.87, ["5002"])],
    orders: [{ order_number: "5001" }, { order_number: "5002" }],
    confirmations: new Map(),
  });
  const reversed = computeReconLines({
    credits: [credit("C2", 7384.87), credit("C1", 7455.77)],
    payouts: [payout("P2", 7384.87, ["5002"]), payout("P1", 7455.77, ["5001"])],
    orders: [{ order_number: "5001" }, { order_number: "5002" }],
    confirmations: new Map(),
  });
  const pick = (ls: typeof forward, id: string) => ls.find((l) => l.id === id)!.payout?.id;
  assert.equal(pick(forward, "C1"), pick(reversed, "C1"));
  assert.equal(pick(forward, "C2"), pick(reversed, "C2"));
});

test("a payout outside the window still matches nothing", () => {
  const lines = computeReconLines({
    credits: [credit("C1", 1000)],
    payouts: [payout("FAR", 5000, ["5001"])],
    orders: [{ order_number: "5001" }],
    confirmations: new Map(),
  });
  assert.equal(lines[0].payout, null);
  assert.equal(lines[0].state, "AWAITING_PAYOUT");
});
