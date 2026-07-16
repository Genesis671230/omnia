import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCheckoutCsv } from "@/lib/parsers/payouts";

const HEADER = [
  "Client Entity ID", "Client Entity Name", "Sub Entity ID", "Sub Entity Name",
  "Processing Channel ID", "Merchant Category Code", "Currency Account ID",
  "Currency Account Name", "Currency Account Custom ID", "Action Type", "Action ID",
  "Payment ID", "Requested On", "Processed On", "Processing Currency",
  "FX Rate Applied", "Holding Currency", "FX Trade ID", "Payout ID", "Reference",
  "Payment Method", "Card Type", "Card Category", "Issuer Country", "Entity Country",
  "Region", "MID", "Response Code", "Response Description", "Breakdown Type",
  "Processing Currency Amount", "Holding Currency Amount", "Entity Country Tax Currency",
  "Tax Fx Rate", "Tax Currency Amount", "Fee Detail",
].join(",");

function row(fields: Record<string, string>): string {
  return HEADER.split(",").map((h) => `"${(fields[h] ?? "").replace(/"/g, '""')}"`).join(",");
}

test("parseCheckoutCsv: nets fee rows against a charge row exactly, groups by account+date when Payout ID is blank", () => {
  const rows = [
    row({
      "Currency Account ID": "ca_kmocqoe55bmubetiumsz6lgxau", "Action Type": "Network Token Update",
      "Payment ID": "nt_flt5z2o4qffyvhrk72wwtsxs6m", "Processed On": "2026-07-07 16:52:20",
      "Holding Currency": "AED", "Holding Currency Amount": "-0.35",
    }),
    row({
      "Currency Account ID": "ca_kmocqoe55bmubetiumsz6lgxau", "Action Type": "Network Token Update",
      "Payment ID": "nt_flt5z2o4qffyvhrk72wwtsxs6m", "Processed On": "2026-07-07 16:52:20",
      "Holding Currency": "AED", "Holding Currency Amount": "-0.0175",
    }),
    row({
      "Currency Account ID": "ca_kmocqoe55bmubetiumsz6lgxau", "Action Type": "Authorization",
      "Payment ID": "pay_yfhvnmqbrjtijdowmje5xwmumy", "Processed On": "2026-07-07 16:52:20",
      "Holding Currency": "AED", "Holding Currency Amount": "500.00", "Reference": "#5204",
    }),
    row({
      "Currency Account ID": "ca_kmocqoe55bmubetiumsz6lgxau", "Action Type": "Authorization",
      "Payment ID": "pay_yfhvnmqbrjtijdowmje5xwmumy", "Processed On": "2026-07-07 16:52:20",
      "Holding Currency": "AED", "Holding Currency Amount": "-0.65", "Reference": "#5204",
    }),
  ];
  const csv = [HEADER, ...rows].join("\n");

  const [payout] = parseCheckoutCsv(csv, "checkout.csv");

  // hand-computed: -0.35 + -0.0175 + 500.00 + -0.65 = 498.9825 → 498.98
  assert.equal(payout.net, 498.98);
  assert.equal(payout.id, "CKO-ca_kmocqoe55bmubetiumsz6lgxau_2026-07-07");
  assert.equal(payout.provider, "Checkout");
  assert.deepEqual(payout.orderRefs, ["5204"]);
  assert.equal(payout.originalCurrency, undefined);
  assert.equal(payout.netOriginal, undefined);

  const tx = payout.transactions!.find((t) => t.ref === "5204")!;
  assert.equal(tx.netShare, 499.35); // 500.00 + -0.65
  assert.equal(tx.grossShare, 500.00);
  assert.equal(tx.feeShare, 0.65);
  assert.equal(tx.isRefund, false);
  assert.equal(tx.quality, "clean");
});

test("parseCheckoutCsv: prefers a populated Payout ID over the date+account fallback", () => {
  const rows = [
    row({
      "Currency Account ID": "ca_1", "Payout ID": "po_123", "Action Type": "Authorization",
      "Payment ID": "pay_a", "Processed On": "2026-07-07 10:00:00",
      "Holding Currency": "AED", "Holding Currency Amount": "100.00", "Reference": "#7001",
    }),
  ];
  const csv = [HEADER, ...rows].join("\n");

  const [payout] = parseCheckoutCsv(csv, "checkout.csv");
  assert.equal(payout.id, "CKO-po_123");
});

test("parseCheckoutCsv: flags multi quality when two References land under one Payment ID", () => {
  const rows = [
    row({
      "Currency Account ID": "ca_1", "Action Type": "Authorization", "Payment ID": "pay_b",
      "Processed On": "2026-07-08 10:00:00", "Holding Currency": "AED",
      "Holding Currency Amount": "50.00", "Reference": "#7002",
    }),
    row({
      "Currency Account ID": "ca_1", "Action Type": "Authorization", "Payment ID": "pay_b",
      "Processed On": "2026-07-08 10:00:00", "Holding Currency": "AED",
      "Holding Currency Amount": "30.00", "Reference": "#7003",
    }),
  ];
  const csv = [HEADER, ...rows].join("\n");

  const [payout] = parseCheckoutCsv(csv, "checkout.csv");
  const tx7002 = payout.transactions!.find((t) => t.ref === "7002")!;
  const tx7003 = payout.transactions!.find((t) => t.ref === "7003")!;
  assert.equal(tx7002.quality, "multi");
  assert.equal(tx7003.quality, "multi");
  assert.equal(tx7002.netShare, 40.00);
  assert.equal(tx7003.netShare, 40.00);
  assert.deepEqual(payout.orderRefs.slice().sort(), ["7002", "7003"]);
});

test("parseCheckoutCsv: throws on a mixed holding currency within one payout group instead of averaging", () => {
  const rows = [
    row({
      "Currency Account ID": "ca_1", "Action Type": "Authorization", "Payment ID": "pay_c",
      "Processed On": "2026-07-09 10:00:00", "Holding Currency": "AED",
      "Holding Currency Amount": "50.00", "Reference": "#7004",
    }),
    row({
      "Currency Account ID": "ca_1", "Action Type": "Authorization", "Payment ID": "pay_d",
      "Processed On": "2026-07-09 10:00:00", "Holding Currency": "SAR",
      "Holding Currency Amount": "30.00", "Reference": "#7005",
    }),
  ];
  const csv = [HEADER, ...rows].join("\n");

  assert.throws(() => parseCheckoutCsv(csv, "checkout.csv"), /mixes holding currencies/);
});
