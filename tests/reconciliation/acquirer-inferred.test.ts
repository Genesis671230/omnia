import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReconLines } from "@/lib/reconciliation/engine";

// Live case 2026-09-24: FT26267TVX45, AED 785.79, narration
// ".../NETWORK INTERNATIONAL LLC/AE9002…/BATCB1muf2v44411/IPPCG1muf4hlma00/…\HCP"
// — no STRIPE-/SHOPIFY- token, so it classifies as Stripe (inferred). It is
// actually Shopify Payments UAE payout 149110423710, and sat as
// "Awaiting payout · No file" because only Stripe payouts were considered.

const NARRATION = "Inward Telex Payment/NETWORK INTERNATIONAL LLC/AE900200000022501498002/BATCB1muf2v44411/IPPCG1muf4hlma00/AEL2609240014562000221/From AE900200000022501498002/FT26267TVX45\\HCP";

const credit = (id: string, amount: number, extra: Partial<{ description: string; confidence: string; gateway_guess: string }> = {}) => ({
  id, statement_date: "2026-09-24", description: NARRATION, reference: id, amount,
  gateway_guess: "Stripe", confidence: "inferred", ...extra,
});
const payout = (id: string, gateway: string, net: number, refs: string[]) => ({
  id, gateway, net_amount: net, gross_amount: net, fee_amount: 0, source: "api", status: "uploaded",
  order_refs: refs, original_currency: null, net_original: null, transactions: [],
});

test("a tokenless Network International credit matches its Shopify Payments payout and takes that gateway", () => {
  const [line] = computeReconLines({
    credits: [credit("FT26267TVX45", 785.79)],
    payouts: [payout("SHOPIFY-UAE-149110423710", "Shopify Payments", 785.79, ["UAE1001"])],
    orders: [{ order_number: "UAE1001" }],
    confirmations: new Map(),
  });
  assert.equal(line.payout?.id, "SHOPIFY-UAE-149110423710");
  assert.equal(line.provider, "Shopify Payments");
  assert.equal(line.state, "SETTLED");
});

test("across rails only an exact amount counts — a near Shopify payout is not borrowed", () => {
  const [line] = computeReconLines({
    credits: [credit("C1", 785.79)],
    payouts: [payout("SHOPIFY-X", "Shopify Payments", 790.0, ["A"])],
    orders: [{ order_number: "A" }],
    confirmations: new Map(),
  });
  assert.equal(line.payout, null);
  assert.equal(line.provider, "Stripe");
});

test("the same tokenless format still matches a Stripe payout (FT26266NX8FH = po_1UIHbd, 24,783.42)", () => {
  const [line] = computeReconLines({
    credits: [credit("FT26266NX8FH", 24783.42)],
    payouts: [payout("STRIPE-po_1UIHbd", "Stripe", 24783.42, ["S1"])],
    orders: [{ order_number: "S1" }],
    confirmations: new Map(),
  });
  assert.equal(line.payout?.id, "STRIPE-po_1UIHbd");
  assert.equal(line.provider, "Stripe");
});

test("a keyword-classified Stripe credit never takes a Shopify payout", () => {
  const [line] = computeReconLines({
    credits: [credit("C2", 785.79, { confidence: "keyword", description: "…ntsub… STRIPE-ABC" })],
    payouts: [payout("SHOPIFY-Y", "Shopify Payments", 785.79, ["B"])],
    orders: [{ order_number: "B" }],
    confirmations: new Map(),
  });
  assert.equal(line.payout, null);
});
