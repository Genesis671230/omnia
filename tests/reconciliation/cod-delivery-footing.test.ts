import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReconLines } from "@/lib/reconciliation/engine";

// Live case CP17192: 3 COD orders remitted 1,711.50, 19 courier charges of
// 1,165.00 netted out, voucher net 546.50. The engine footed the orders to the
// bare net and pushed −1,165 onto WA55811 (net −272.50 instead of 892.50).

const tx = (order_ref: string, net_aed: number, gross_aed: number, fee_aed: number) => ({
  order_ref, net_aed, gross_aed, fee_aed, is_refund: false, quality: "clean",
  net_original: null, gross_original: null, fee_original: null, vat_aed: null, vat_original: null,
});
const charge = (ref: string, amount: number) => ({ ref, amount, exVat: +(amount / 1.05).toFixed(2), vat: +(amount - amount / 1.05).toFixed(2), isReturn: false, voucherNo: "1", status: "Delivered" });

test("a COD voucher's orders keep their own nets; courier charges stay outside them", () => {
  const [line] = computeReconLines({
    credits: [{ id: "C", statement_date: "2026-09-23", description: "ON TRACK", reference: "C", amount: 546.5, gateway_guess: "COD", confidence: "keyword" }],
    payouts: [{
      id: "CP17192", gateway: "COD", net_amount: 546.5, gross_amount: 1801.5, fee_amount: 1255,
      source: "17192.pdf", status: "uploaded", order_refs: ["OS3746", "WA55811", "OS3728"],
      original_currency: null, net_original: null,
      delivery_charges: [charge("OS3757", 30), charge("WA55835", 490), charge("WA55839", 645)],
      transactions: [
        tx("OS3746", 819, 849, 30),
        tx("WA55811", 892.5, 922.5, 30),
        tx("OS3728", 0, 30, 30),
      ],
    }],
    orders: [{ order_number: "OS3746" }, { order_number: "WA55811" }, { order_number: "OS3728" }],
    confirmations: new Map(),
  });
  assert.deepEqual(line.transactions.map((t) => [t.ref, t.netShare]), [["OS3746", 819], ["WA55811", 892.5], ["OS3728", 0]]);
  const orders = line.transactions.reduce((s, t) => s + t.netShare, 0);
  assert.equal(+(orders - 1165).toFixed(2), line.payout?.net);
});
