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
  assert.equal(w.refunds.aed, 300);                   // 200 gateway + 100 Zoho-only
  assert.equal(w.netSales.aed, 1900);
  assert.deepEqual(r.fromDashboard.dashboard, { orders: 4, aed: 3000 });   // 1000 + 500 + 800 + 700
  assert.equal(r.fromDashboard.sheetCancelled.aed, 800);
  const by = Object.fromEntries(r.lines.map((l) => [l.order, l]));
  assert.equal(by.OS3701.refund.source, "gateway");
  assert.equal(by.OS3701.refund.paidMonth, "2026-10");
  assert.ok(by.OS3701.issues.some((i) => i.key === "zoho_ne_gateway"));
  assert.equal(by.OS3706.refund.source, "zoho");
  assert.equal(by.OS3706.exchange.count, 1);
  assert.equal(by.OS3706.exchange.extraAed, 30);
  assert.ok(by.OS3706.issues.some((i) => i.key === "exchange_reinvoiced"));
  assert.equal(r.cash.receivedAed, 970);
  assert.equal(r.cash.receivableAed, 500 + 600);      // COD 500 + OS3706 net 600
  assert.equal(r.cash.receivableByBucket.find((b) => b.bucket === "cod_courier")!.aed, 500);
  assert.equal(r.refundsPaidThisMonth.ofEarlierMonths, 1);
  assert.equal(r.exchanges.reinvoicedInZoho, 1);
  const t = r.cash.tie;
  assert.ok(Math.abs(t.receivedAed + t.feesOnReceivedAed + t.fxOtherAed - t.refundsOnReceivedAed + t.receivableAed - t.netSalesAed) < 0.01);
  assert.equal(t.feesOnReceivedAed, 30);
  assert.equal(t.refundsOnReceivedAed, 200);
});
