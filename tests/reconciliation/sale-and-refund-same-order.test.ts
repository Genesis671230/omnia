import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReconLines } from "@/lib/reconciliation/engine";

// Live case: Tabby20260907SAR carried WA55588 twice — its sale and its
// refund. The parser summed them into one "refund" row and the engine's
// ref→tx map kept one, so the sale (and its invoice) disappeared.

test("an order with a sale and a refund on one payout is both resolved and refunded", () => {
  const [line] = computeReconLines({
    credits: [{ id: "C", statement_date: "2026-09-09", description: "TABBY", reference: "C", amount: 100, gateway_guess: "Tabby", confidence: "keyword" }],
    payouts: [{
      id: "TABBY-1", gateway: "Tabby", net_amount: 100, gross_amount: 180, fee_amount: 10,
      source: "tabby.xlsx", status: "uploaded", order_refs: ["WA55588", "WA1"],
      original_currency: null, net_original: null,
      transactions: [
        { order_ref: "WA55588", net_aed: 70, gross_aed: 80, fee_aed: 10, is_refund: false, quality: "clean" },
        { order_ref: "WA55588", net_aed: -60, gross_aed: -60, fee_aed: 0, is_refund: true, quality: "refund" },
        { order_ref: "WA1", net_aed: 90, gross_aed: 100, fee_aed: 10, is_refund: false, quality: "clean" },
      ],
    }],
    orders: [{ order_number: "WA55588" }, { order_number: "WA1" }],
    confirmations: new Map(),
  });
  assert.deepEqual(line.resolvedOrders.sort(), ["WA1", "WA55588"]);
  assert.deepEqual(line.refundedOrders, ["WA55588"]);
  const rows = line.transactions.filter((t) => t.ref === "WA55588");
  assert.equal(rows.length, 2, "both rows reach the proof table");
  assert.deepEqual(rows.map((t) => t.isRefund).sort(), [false, true]);
});

test("duplicate refs (sale row + refund row) resolve the order once", () => {
  const [line] = computeReconLines({
    credits: [{ id: "C", statement_date: "2026-09-09", description: "STRIPE-X", reference: "C", amount: 809.11, gateway_guess: "Stripe", confidence: "keyword" }],
    payouts: [{
      id: "STRIPE-po_1", gateway: "Stripe", net_amount: 809.11, gross_amount: 855.23, fee_amount: 46.12,
      source: "stripe-api", status: "uploaded", order_refs: ["WA55548", "WA55548"],
      original_currency: null, net_original: null,
      transactions: [
        { order_ref: "WA55548", net_aed: 874.59, gross_aed: 920.71, fee_aed: 46.12, is_refund: false, quality: "clean" },
        { order_ref: "WA55548", net_aed: -65.48, gross_aed: -65.48, fee_aed: 0, is_refund: true, quality: "refund" },
      ],
    }],
    orders: [{ order_number: "WA55548" }],
    confirmations: new Map(),
  });
  assert.deepEqual(line.resolvedOrders, ["WA55548"]);
  assert.deepEqual(line.refundedOrders, ["WA55548"]);
});
