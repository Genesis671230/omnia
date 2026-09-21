import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSalesLedger, type LedgerOrderInput, type LedgerPayoutInput } from "@/lib/orders/sales-ledger";
import { buildDailySeries } from "@/lib/orders/gross-sales";

const order = (o: Partial<LedgerOrderInput> & { order_number: string }): LedgerOrderInput => ({
  uid: `UAE-${o.order_number}`,
  store_id: "UAE",
  order_date: "2026-09-10T08:00:00Z",
  customer_name: "Test",
  gateway: "Tabby",
  gross_aed: 100,
  financial_status: "paid",
  payout_id: null,
  payout_status: "awaiting",
  ...o,
});

const tx = (ref: string, fee = 0, net = 0) => ({
  order_ref: ref, is_refund: false, quality: null, net_aed: net, gross_aed: 0, fee_aed: fee,
});

test("day totals match the Gross Sales series exactly", () => {
  const orders = [
    order({ order_number: "1" }),
    order({ order_number: "2", store_id: "KSA", gross_aed: 250.55 }),
    order({ order_number: "3", financial_status: "pending" }),
    // 21:30 UTC on the 10th is the 11th in Dubai
    order({ order_number: "4", order_date: "2026-09-10T21:30:00Z", gross_aed: 40 }),
    order({ order_number: "5", order_date: "2026-08-31T10:00:00Z" }),
  ];
  const ledger = computeSalesLedger({ month: "2026-09", orders, payouts: [] });
  const series = buildDailySeries(orders, "2026-09-01", "2026-09-30");
  for (const s of series) {
    const d = ledger.days.find((x) => x.day === s.day)!;
    assert.equal(d.grossAed, s.grossAed, s.day);
    assert.equal(d.orders, s.orders, s.day);
  }
  assert.equal(ledger.days.length, 30);
  assert.equal(ledger.totals.grossAed, 390.55);
  assert.equal(ledger.excludedOrders, 1);
});

test("an order no payout file mentions says the file is not uploaded yet", () => {
  const ledger = computeSalesLedger({ month: "2026-09", orders: [order({ order_number: "1" })], payouts: [] });
  const d = ledger.days.find((x) => x.day === "2026-09-10")!;
  assert.equal(d.orderList[0].status, "no_payout_file");
  assert.equal(d.orderList[0].feeBasis, "estimated");
  assert.equal(d.orderList[0].receivedAed, 0);
  assert.match(d.reason, /Tabby payout file not uploaded yet/);
  assert.equal(ledger.missingPayoutFiles[0].gateway, "Tabby");
  assert.deepEqual(ledger.missingPayoutFiles[0].days, ["2026-09-10"]);
});

test("traces order → payout line → bank credit with the measured fee", () => {
  const payouts: LedgerPayoutInput[] = [{
    id: "P1", gateway: "Stripe", net_amount: 96, gross_amount: 100, fee_amount: 4, source: "stripe.csv",
    transactions: [tx("UAE1", 3.2, 96.8)],
  }];
  const ledger = computeSalesLedger({
    month: "2026-09",
    orders: [order({ order_number: "1", gateway: "Stripe" })],
    payouts,
    recon: [{ payout_id: "P1", bank_line_id: "B1", match_status: "SETTLED", confirmed_by: null, delta: 0 }],
    bank: [{ id: "B1", statement_date: "2026-09-14", amount: 96, reference: "FT123", description: "" }],
  });
  const o = ledger.days.find((x) => x.day === "2026-09-10")!.orderList[0];
  assert.equal(o.status, "received");
  assert.equal(o.feeBasis, "measured");
  assert.equal(o.feeAed, 3.2);
  assert.equal(o.receivedAed, 96.8);
  assert.equal(o.bank?.reference, "FT123");
  assert.equal(o.reason, "Received in bank on 2026-09-14");
});

test("a file-level fee is allocated by gross; no bank credit reads as awaiting bank", () => {
  const payouts: LedgerPayoutInput[] = [{
    id: "P2", gateway: "Tabby", net_amount: 285, gross_amount: 300, fee_amount: 15, source: "tabby.xlsx",
    transactions: [tx("1"), tx("2")],
  }];
  const ledger = computeSalesLedger({
    month: "2026-09",
    orders: [order({ order_number: "1" }), order({ order_number: "2", gross_aed: 200 })],
    payouts,
  });
  const d = ledger.days.find((x) => x.day === "2026-09-10")!;
  const two = d.orderList.find((o) => o.orderNumber === "2")!;
  assert.equal(two.status, "awaiting_bank");
  assert.equal(two.feeBasis, "allocated");
  assert.equal(two.feeAed, 10);
  assert.match(d.reason, /2 in a payout file, bank credit not matched yet/);
});

test("a manual ref link resolves; refunds and variance lines are handled", () => {
  const payouts: LedgerPayoutInput[] = [{
    id: "P3", gateway: "Tamara", net_amount: 95, gross_amount: 95, fee_amount: 0, source: "t.csv",
    transactions: [tx("0655572535"), { ...tx("9"), is_refund: true }],
  }];
  const ledger = computeSalesLedger({
    month: "2026-09",
    orders: [order({ order_number: "7", gateway: "Tamara" }), order({ order_number: "9", gateway: "Tamara" })],
    payouts,
    links: new Map([["P3|0655572535", "7"]]),
    recon: [{ payout_id: "P3", bank_line_id: "B3", match_status: "PAYOUT_VARIANCE", confirmed_by: null, delta: 5 }],
    bank: [{ id: "B3", statement_date: "2026-09-20", amount: 90, reference: "", description: "" }],
  });
  const list = ledger.days.find((x) => x.day === "2026-09-10")!.orderList;
  assert.equal(list.find((o) => o.orderNumber === "7")!.status, "in_review");
  // a refund line never counts as the payout that paid the sale
  assert.equal(list.find((o) => o.orderNumber === "9")!.status, "no_payout_file");
});

test("COD orders are never reported as a missing payout file", () => {
  const ledger = computeSalesLedger({ month: "2026-09", orders: [order({ order_number: "1", gateway: "COD" })], payouts: [] });
  const d = ledger.days.find((x) => x.day === "2026-09-10")!;
  assert.equal(d.orderList[0].status, "cod");
  assert.equal(ledger.missingPayoutFiles.length, 0);
});

test("a small payout line sharing the order number is a partial, not the payment", () => {
  const payouts: LedgerPayoutInput[] = [{
    id: "STRIPE-1", gateway: "Stripe", net_amount: 66.97, gross_amount: 70, fee_amount: 3.03, source: "stripe-api",
    transactions: [{ order_ref: "801917", is_refund: false, quality: "clean", gross_aed: 70, fee_aed: 3.03, net_aed: 66.97 }],
  }];
  const ledger = computeSalesLedger({
    month: "2026-09",
    orders: [order({ order_number: "801917", gateway: "Tamara", gross_aed: 2382, payout_id: "STRIPE-1", payout_status: "settled" })],
    payouts,
    recon: [{ payout_id: "STRIPE-1", bank_line_id: "B1", match_status: "SETTLED", confirmed_by: null, delta: 0 }],
    bank: [{ id: "B1", statement_date: "2026-09-12T00:00:00", amount: 66.97, reference: "FT1", description: "" }],
  });
  const o = ledger.days.find((x) => x.day === "2026-09-10")!.orderList[0];
  assert.equal(o.status, "no_payout_file");
  assert.equal(o.receivedAed, 0);
  assert.equal(o.partial?.grossAed, 70);
  assert.match(o.reason, /Tamara payout file not uploaded yet \(only AED 70.00 found in a Stripe payout/);
});

test("prefers the payout from the order's own gateway, and trims bank timestamps", () => {
  const payouts: LedgerPayoutInput[] = [
    { id: "X", gateway: "Stripe", net_amount: 97, gross_amount: 100, fee_amount: 3, source: "s", transactions: [{ ...tx("5"), gross_aed: 100, fee_aed: 3, net_aed: 97 }] },
    { id: "Y", gateway: "Tabby", net_amount: 96, gross_amount: 100, fee_amount: 4, source: "t", transactions: [tx("5")] },
  ];
  const ledger = computeSalesLedger({
    month: "2026-09",
    orders: [order({ order_number: "5", gateway: "Tabby" })],
    payouts,
    recon: [{ payout_id: "Y", bank_line_id: "B", match_status: "SETTLED", confirmed_by: "founder", delta: 0 }],
    bank: [{ id: "B", statement_date: "2026-09-15T00:00:00", amount: 96, reference: "R", description: "" }],
  });
  const o = ledger.days.find((x) => x.day === "2026-09-10")!.orderList[0];
  assert.equal(o.payout?.id, "Y");
  assert.equal(o.bank?.date, "2026-09-15");
  assert.equal(o.reason, "Received in bank on 2026-09-15");
});
