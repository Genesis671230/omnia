import { test } from "node:test";
import assert from "node:assert/strict";
import { toParsedShopifyPayout, type ShopifyBalanceTxNode, type ShopifyPayoutNode } from "@/lib/integrations/shopify-payments";

const m = (amount: string) => ({ amount });
const payout = (over: Partial<ShopifyPayoutNode> = {}): ShopifyPayoutNode => ({
  id: "gid://shopify/ShopifyPaymentsPayout/111",
  legacyResourceId: "111",
  issuedAt: "2026-09-18T02:00:00Z",
  status: "PAID",
  transactionType: "DEPOSIT",
  externalTraceId: "AEL2609180006542",
  net: { amount: "1147.26", currencyCode: "AED" },
  summary: {
    chargesGross: m("1200.00"), chargesFee: m("-52.74"),
    refundsFeeGross: m("0"), refundsFee: m("0"),
    adjustmentsGross: m("0"), adjustmentsFee: m("0"),
  },
  ...over,
});
const tx = (name: string | null, amount: string, fee: string, net: string, type = "CHARGE", test = false): ShopifyBalanceTxNode => ({
  id: `gid://shopify/ShopifyPaymentsBalanceTransaction/${name}${type}`,
  type, test,
  transactionDate: "2026-09-16T10:00:00Z",
  amount: { amount, currencyCode: "AED" },
  fee: m(fee), net: m(net),
  associatedOrder: name ? { id: "gid://shopify/Order/1", name } : null,
  associatedPayout: { id: "gid://shopify/ShopifyPaymentsPayout/111", status: "PAID" },
});

test("each order in the payout carries its real gross, fee and net", () => {
  const p = toParsedShopifyPayout("UAE", payout(), [
    tx("#3347", "700.00", "30.00", "670.00"),
    tx("#3348", "500.00", "22.74", "477.26"),
  ]);
  assert.equal(p.id, "SHOPIFY-UAE-111");
  assert.equal(p.provider, "Shopify Payments");
  assert.equal(p.net, 1147.26);
  assert.deepEqual(p.orderRefs, ["3347", "3348"]);
  assert.deepEqual(
    p.transactions!.map((t) => [t.ref, t.grossShare, t.feeShare, t.netShare, t.isRefund]),
    [["3347", 700, 30, 670, false], ["3348", 500, 22.74, 477.26, false]],
  );
  assert.match(p.notes, /bank trace AEL2609180006542/);
  assert.equal(p.originalCurrency, undefined);
});

test("refunds are flagged, adjustments and test charges belong to no order", () => {
  const p = toParsedShopifyPayout("UAE", payout(), [
    tx("#3347", "700.00", "30.00", "670.00"),
    tx("#3340", "-100.00", "0", "-100.00", "REFUND"),
    tx(null, "-5.00", "0", "-5.00", "ADJUSTMENT"),
    tx("#9999", "50.00", "2", "48", "CHARGE", true),
  ]);
  assert.deepEqual(p.orderRefs, ["3347", "3340"]);
  assert.equal(p.transactions!.find((t) => t.ref === "3340")!.isRefund, true);
});

test("a SAR (KSA) payout keeps its original currency for the bank's wire rate", () => {
  const p = toParsedShopifyPayout("KSA", payout({ net: { amount: "1000.00", currencyCode: "SAR" } }), [
    tx("#SA3761", "1040.00", "40.00", "1000.00"),
  ]);
  assert.equal(p.originalCurrency, "SAR");
  assert.equal(p.netOriginal, 1000);
  assert.equal(p.net, 980); // lib/fx.ts estimate; the reconciler prefers the bank's quoted rate
  assert.equal(p.transactions![0].ref, "SA3761");
  assert.equal(p.transactions![0].netOriginal, 1000);
});

test("pending charges keep only unpaid-out, non-test CHARGE rows with an order", async () => {
  const { toPendingChargeRows } = await import("@/lib/integrations/shopify-payments");
  const base = {
    type: "CHARGE", test: false, transactionDate: "2026-09-22T05:15:09Z",
    amount: { amount: "891.0", currencyCode: "AED" }, fee: m("24.44"), net: m("866.56"),
    associatedOrder: { id: "gid://shopify/Order/1", name: "#OS3777" },
    associatedPayout: { id: null, status: "PENDING" },
  };
  const rows = toPendingChargeRows("MAIN", [
    { id: "a", ...base },
    { id: "b", ...base, associatedPayout: { id: "gid://shopify/ShopifyPaymentsPayout/9", status: "PAID" } },
    { id: "c", ...base, test: true },
    { id: "d", ...base, type: "REFUND" },
    { id: "e", ...base, associatedOrder: null },
  ] as ShopifyBalanceTxNode[]);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { ref: rows[0].order_ref, g: rows[0].gross_aed, f: rows[0].fee_aed, n: rows[0].net_aed, s: rows[0].store },
    { ref: "OS3777", g: 891, f: 24.44, n: 866.56, s: "MAIN" },
  );
});
