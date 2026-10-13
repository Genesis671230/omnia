import { test } from "node:test";
import assert from "node:assert/strict";
import { buildManagementReport, type MrStoreOrder } from "../../lib/reports/management-report";
import type { SheetRow } from "../../lib/integrations/dispatch-sheet-read";

const o = (n: string, gross: number, extra: Partial<MrStoreOrder> = {}): MrStoreOrder => ({
  order_number: n, order_date: "2026-09-10T08:00:00", gross_aed: gross, financial_status: "paid", store_id: "MAIN", gateway: "Stripe", ...extra,
});
const row = (order: string, extra: Partial<SheetRow>): SheetRow => ({
  tab: "SMSA", source: "September 2026", row: 10, order, day: "2026-09-10", time: null, kind: "sale", amountAed: 0, grossAed: 0,
  cancelledRefundedAed: null, amountOriginal: 0, currency: "AED", exchangeRate: null, party: "", gateway: "", saleType: "", voucher: "",
  comments: "", paymentAuthorised: "", paymentStatus: "", receivedOn: "", feeDeducted: null, balanceReceived: null, feePct: "", refundDate: "",
  deliveryBy: "", shipmentStatus: "", salesPerson: "", otInvoice: "", flaggedDuplicate: false, ...extra,
});

test("waterfall, refunds by source, exchanges, receivables and the dashboard tie-out", () => {
  const r = buildManagementReport({
    month: "2026-09", today: "2026-10-02",
    orders: [
      o("OS3701", 1000),                                                        // received, refunded 200 by the gateway (Oct)
      o("OS3702", 500, { gateway: "COD", financial_status: "pending" }),        // COD with the courier
      o("OS3703", 300, { financial_status: "cancelled" }),                      // cancelled in store
      o("OS3704", 800),                                                         // cancelled only in the sheet
      o("OS3705", 400, { financial_status: "failed" }),                         // failed
      o("OS3706", 700),                                                         // refund only in Zoho; exchange re-invoiced
      o("OS3707", 900, { order_date: "2026-08-20T08:00:00" }),                  // other month — ignored
    ],
    ledger: new Map([
      ["OS3701", { status: "received", feeAed: 30, receivedAed: 970, payoutId: "P1", bankDate: "2026-09-15" }],
      ["OS3702", { status: "cod", feeAed: 0, receivedAed: 0, payoutId: null, bankDate: null }],
      ["OS3704", { status: "awaiting_bank", feeAed: 20, receivedAed: 0, payoutId: "P2", bankDate: null }],
      ["OS3706", { status: "no_payout_file", feeAed: 21, receivedAed: 0, payoutId: null, bankDate: null }],
    ]),
    gatewayRefunds: [{ order: "OS3701", amountAed: 200, date: "2026-10-03", payoutId: "P9", gateway: "Stripe" }],
    creditNotes: new Map([
      ["OS3701", [{ number: "OCN-1", date: "2026-10-03", total: 210, reference: "" }]],
      ["OS3706", [{ number: "OCN-2", date: "2026-09-20", total: 100, reference: "" }, { number: "OCN-3", date: "2026-09-21", total: 0, reference: "" }]],
    ]),
    invoiceCounts: new Map([["OS3706", 2]]),
    sheet: [row("OS3704", { kind: "cancelled", comments: "Canceled Before Dispatch" }), row("OS3706", { kind: "exchange", saleType: "Exchange/Paid", amountAed: 30 })],
    refundsPaidInMonth: [{ order: "OS3500", amountAed: 150, date: "2026-09-05", payoutId: "P3", gateway: "Stripe" }],
    orderMonthOf: new Map([["OS3500", "2026-08"]]),
  });
  const w = r.waterfall;
  assert.equal(w.placed.orders, 6);
  assert.equal(w.failedUnpaid.aed, 400);
  assert.equal(w.cancelled.aed, 1100);
  assert.equal(w.cancelled.bySheetOnly, 1);
  assert.equal(w.grossSales.aed, 2200);               // 1000 + 500 + 700
  assert.equal(w.refunds.aed, 200);                   // 200 gateway; OS3706's 100 credit note is an exchange credit
  assert.equal(w.netSales.aed, 2000);
  assert.deepEqual(r.fromDashboard.dashboard, { orders: 4, aed: 3000 });   // 1000 + 500 + 800 + 700
  assert.equal(r.fromDashboard.sheetCancelled.aed, 800);
  const by = Object.fromEntries(r.lines.map((l) => [l.order, l]));
  assert.equal(by.OS3701.refund.source, "gateway");
  assert.equal(by.OS3701.refund.paidMonth, "2026-10");
  assert.ok(by.OS3701.issues.some((i) => i.key === "zoho_ne_gateway"));
  assert.equal(by.OS3706.refund.source, null);         // exchange: the valued credit note went onto the new invoice
  assert.equal(by.OS3706.exchange.creditAed, 100);
  assert.equal(by.OS3706.exchange.count, 1);
  assert.equal(by.OS3706.exchange.extraAed, 30);
  assert.ok(by.OS3706.issues.some((i) => i.key === "exchange_reinvoiced"));
  assert.equal(r.cash.receivedAed, 970);
  assert.equal(r.cash.receivableAed, 500 + 700);      // COD 500 + OS3706 net 700
  assert.equal(r.cash.receivableByBucket.find((b) => b.bucket === "cod_courier")!.aed, 500);
  assert.equal(r.refundsPaidThisMonth.ofEarlierMonths, 1);
  assert.equal(r.exchanges.reinvoicedInZoho, 1);
  const t = r.cash.tie;
  assert.ok(Math.abs(t.receivedAed + t.feesOnReceivedAed + t.fxOtherAed - t.refundsOnReceivedAed + t.receivableAed - t.netSalesAed) < 0.01);
  assert.equal(t.feesOnReceivedAed, 30);
  assert.equal(t.refundsOnReceivedAed, 200);
});

test("app adjustments: cancel is a cancellation, COD return is the official refund, exchange note is not a refund", () => {
  const r = buildManagementReport({
    month: "2026-09", today: "2026-10-02",
    orders: [
      o("WA1", 500, { gateway: "COD", financial_status: "pending", store_id: "WA", ops_status: "cancelled" }),
      o("WA2", 500, { gateway: "COD", financial_status: "pending", store_id: "WA", ops_status: "returned" }),
      o("WA3", 800, { ops_status: "exchanged" }),
    ],
    ledger: new Map([
      ["WA2", { status: "cod", feeAed: 0, receivedAed: 0, payoutId: null, bankDate: null }],
      ["WA3", { status: "received", feeAed: 20, receivedAed: 780, payoutId: "P1", bankDate: "2026-09-15" }],
    ]),
    gatewayRefunds: [],
    creditNotes: new Map([
      ["WA2", [{ number: "CN-2", date: "2026-10-02", total: 400, reference: "ADJ/WA2/CN" }]],
      ["WA3", [{ number: "CN-3", date: "2026-10-02", total: 800, reference: "ADJ/WA3/CN" }]],
    ]),
    invoiceCounts: new Map([["WA3", 2]]),
    sheet: [], refundsPaidInMonth: [], orderMonthOf: new Map(),
    adjustments: new Map([
      ["WA1", { kind: "cancelled" as const, creditAed: 500, creditNote: "CN-1", exchangeTotalAed: 0, date: "2026-10-02" }],
      ["WA2", { kind: "returned" as const, creditAed: 400, creditNote: "CN-2", exchangeTotalAed: 0, date: "2026-10-02" }],
      ["WA3", { kind: "exchanged" as const, creditAed: 800, creditNote: "CN-3", exchangeTotalAed: 900, date: "2026-10-02" }],
    ]),
  });
  const by = Object.fromEntries(r.lines.map((l) => [l.order, l]));
  assert.equal(by.WA1.stage, "cancelled");
  assert.equal(by.WA1.cancelledBy, "app");
  assert.equal(by.WA2.refund.source, "app");
  assert.equal(by.WA2.refund.officialAed, 400);
  assert.equal(by.WA2.netSalesAed, 100);
  assert.deepEqual(by.WA2.issues, []);
  assert.equal(by.WA3.refund.officialAed, 0, "an exchange credit note is not a refund");
  assert.equal(by.WA3.exchange.count, 1);
  assert.equal(by.WA3.exchange.extraAed, 100);
  assert.ok(!by.WA3.issues.some((i) => i.key === "exchange_reinvoiced"));
});

test("COD shows both organisations and takes its amount from House of Omnia", () => {
  const r = buildManagementReport({
    month: "2026-09", today: "2026-10-03",
    orders: [
      o("OS4001", 700, { gateway: "COD", financial_status: "pending" }),
      o("OS4002", 450, { gateway: "COD", financial_status: "pending" }),   // only the intercompany copy
      o("OS4003", 900),                                                       // card — main org
    ],
    ledger: new Map([
      ["OS4001", { status: "cod", feeAed: 0, receivedAed: 0, payoutId: null, bankDate: null }],
      ["OS4002", { status: "cod", feeAed: 0, receivedAed: 0, payoutId: null, bankDate: null }],
      ["OS4003", { status: "received", feeAed: 25, receivedAed: 875, payoutId: "P1", bankDate: "2026-09-12" }],
    ]),
    gatewayRefunds: [],
    creditNotes: new Map(),
    invoiceCounts: new Map([["OS4001", 2], ["OS4002", 1], ["OS4003", 1]]),
    invoicesByOrg: new Map([
      ["OS4001", [{ org: "Omniastores LLC", numbers: ["MNS-1"], totalAed: 0 }, { org: "House of Omnia", numbers: ["HOO-1"], totalAed: 690 }]],
      ["OS4002", [{ org: "Omniastores LLC", numbers: ["MNS-2"], totalAed: 0 }]],
      ["OS4003", [{ org: "Omniastores LLC", numbers: ["MNS-3"], totalAed: 900 }]],
    ]),
    codOrg: "House of Omnia",
    sheet: [row("OS4001", { kind: "exchange", amountAed: 0 })],
    refundsPaidInMonth: [],
    orderMonthOf: new Map(),
  });
  const by = Object.fromEntries(r.lines.map((l) => [l.order, l]));
  assert.equal(by.OS4001.zoho.amountAed, 690);
  assert.equal(by.OS4001.zoho.amountOrg, "House of Omnia");
  assert.equal(by.OS4003.zoho.amountOrg, "Omniastores LLC");
  // one invoice in each org is NOT a re-invoiced exchange
  assert.ok(!by.OS4001.issues.some((i) => i.key === "exchange_reinvoiced"));
  assert.equal(r.cod.orders, 2);
  assert.equal(r.cod.grossAed, 1150);
  assert.equal(r.cod.byOrg[0].org, "House of Omnia");
  assert.deepEqual(r.cod.notInAmountOrg, ["OS4002"]);
  assert.deepEqual(r.cod.mismatches, [{ order: "OS4001", storeAed: 700, zohoAed: 690 }]);
});
