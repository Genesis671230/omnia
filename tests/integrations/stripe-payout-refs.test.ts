import { test } from "node:test";
import assert from "node:assert/strict";
import { payoutOrderRefs } from "@/lib/integrations/stripe";
import { buildTransactionRows } from "@/lib/repositories/payouts.repository";

// Shape of po_1UBOwz (2026-09-25): the list carries the payout's own row,
// a charge with a blank description, and a sale + refund of WA55548.
const ROWS = [
  { id: "txn_p", type: "payout", amount: -1_088_257, fee: 0, net: -1_088_257, description: "STRIPE PAYOUT", source: "po_1" },
  { id: "txn_r", type: "refund", amount: -6_548, fee: 0, net: -6_548, description: "REFUND FOR CHARGE (WA55548)", source: "re_1" },
  { id: "txn_b", type: "charge", amount: 13_096, fee: 742, net: 12_354, description: "", source: "ch_3U9u3B" },
  { id: "txn_s", type: "charge", amount: 92_071, fee: 4_612, net: 87_459, description: "WA55548", source: "ch_2" },
];

test("payoutOrderRefs ignores the payout row and keeps unreferenced charges", async (t) => {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ data: ROWS, has_more: false }), { status: 200 }));
  const p = await payoutOrderRefs("po_1");
  const sum = +p.transactions.reduce((s, x) => s + x.netShare, 0).toFixed(2);
  assert.equal(p.net, 932.65, "net = sum of non-payout rows, not 0");
  assert.equal(sum, p.net, "rows foot to the payout");
  assert.ok(p.refs.includes("ch_3U9u3B"), "blank-description charge kept under its charge id");
  assert.deepEqual(p.transactions.filter((x) => x.ref === "WA55548").map((x) => x.isRefund).sort(), [false, true]);
});

test("buildTransactionRows keeps a sale and a refund of one order as two rows", () => {
  const rows = buildTransactionRows("P", ["WA55548", "WA1"], [
    { ref: "WA55548", isRefund: false, quality: "clean", netShare: 874.59, grossShare: 920.71, feeShare: 46.12 },
    { ref: "WA55548", isRefund: true, quality: "refund", netShare: -65.48, grossShare: -65.48, feeShare: 0 },
    { ref: "WA1", isRefund: false, quality: "clean", netShare: 10, grossShare: 10, feeShare: 0 },
    { ref: "WA1", isRefund: false, quality: "clean", netShare: 5, grossShare: 5, feeShare: 0 }, // retry → summed
  ]);
  const wa = rows.filter((r) => r.order_ref === "WA55548");
  assert.equal(wa.length, 2);
  assert.deepEqual(wa.map((r) => [r.is_refund, r.net_aed]), [[false, 874.59], [true, -65.48]]);
  const one = rows.filter((r) => r.order_ref === "WA1");
  assert.equal(one.length, 1);
  assert.equal(one[0].net_aed, 15);
});

test("buildTransactionRows keeps a placeholder row for refs with no breakdown", () => {
  const rows = buildTransactionRows("P", ["X9"], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].net_aed, 0);
});
