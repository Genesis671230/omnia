import { test } from "node:test";
import assert from "node:assert/strict";
import { kindOf, parseSheetDate, rowsFromValues, type SheetRow } from "../../lib/integrations/dispatch-sheet-read";
import { compareThreeWay, type TwOrder } from "../../lib/dispatch/three-way";

test("sheet dates in every shape the team types", () => {
  assert.deepEqual(parseSheetDate("2026-09-01 11:10"), { day: "2026-09-01", time: "11:10" });
  assert.deepEqual(parseSheetDate("2026-09-01 6:57"), { day: "2026-09-01", time: "06:57" });
  assert.deepEqual(parseSheetDate("02.Sep.2026"), { day: "2026-09-02", time: null });
  assert.deepEqual(parseSheetDate("21 Sep.2026"), { day: "2026-09-21", time: null });
  assert.deepEqual(parseSheetDate(" 01.July.2026"), { day: "2026-07-01", time: null });
  assert.deepEqual(parseSheetDate("2026-09-30T21:30:00Z"), { day: "2026-10-01", time: "01:30" });
  assert.deepEqual(parseSheetDate("tbd"), { day: null, time: null });
});

test("row kinds from the team's own words", () => {
  assert.equal(kindOf("Exchange/COD", "", "", 30, null), "exchange");
  assert.equal(kindOf("Repair", "", "", 0, null), "repair");
  assert.equal(kindOf("COD", "Canceled Before Dispatch - 796.50 AED", "Cancelled", 0, 796.5), "cancelled");
  assert.equal(kindOf("", "Returned and refunded - 912.52 SAR", "", 84.34, 894.27), "refunded");      // a few dirhams kept
  assert.equal(kindOf("", "1 Item Returned and Refunded 724.15 SAR", "", 435.8, 709.67), "partial_refund");
  assert.equal(kindOf("Paid", "", "", 1210, null), "sale");
});

test("month-sheet columns: refunded amount restores the original sale", () => {
  const smsa = rowsFromValues("SMSA", [
    ["Duplicate customer", "S.No", "Date", "Order #", "Total Amt", "Currency", "In AED", "Party", "Part", "Exc Rate", "", "Status / Comments", "Payment Authorised - Status", "Actual Payment Status", "Payment Received Date", "Total Amount", "Fee Deducted", "Amount After Deduction", "Cancelled / Refunded Amount", "Fee%", "sales person", "Refund Date"],
    ["", "13", "02.Sep.2026", "WA55598", "86.06", "SAR", "84.34", "stripe", "Paid", "0.98", "", "Returned and refunded - 912.52 SAR", "Authorised", "Payment Received", "Payment Received on 08.09.2026 (7,455.77)", "", "", "", "894.2696", "", "", ""],
  ], "September 2026");
  assert.equal(smsa[0].kind, "refunded");
  assert.equal(smsa[0].grossAed, 978.61);
  assert.equal(smsa[0].source, "September 2026");
  assert.equal(smsa[0].exchangeRate, 0.98);
  const local = rowsFromValues("Local", [
    ["Duplicate customer", "Duplicate Check", "S.No", "Date", "Order #", "Voucher #", "Type of Sale", "Total", "Party", "Customer", "contact", " Comments", "Payment Status", "Delivery By", "COD to Other Payment", "Actual Payment Status", "Payment Received on", "OT Invoice#", "Total Amount", "Fee Deducted", "Amount After Deduction", "Cancelled / Refunded Amount", "% Charged", "sales person", "Shipment Status "],
    ["", "", "14", "01.Sep.2026", "804671", "12060", "Exchange/COD", "30.00", "Exchange/COD", "", "", "", "Exchange/COD", "On Track", "", "Payment Received ", "Payment Received on 05.09.2026 (3,325.00)", "17126", "30.00", "30.00", "0.00", "", "", "", ""],
  ]);
  assert.equal(local[0].kind, "exchange");
  assert.equal(local[0].voucher, "12060");
  assert.equal(local[0].otInvoice, "17126");
  assert.equal(local[0].deliveryBy, "On Track");
});

const o = (n: string, gross: number, extra: Partial<TwOrder> = {}): TwOrder => ({
  order_number: n, order_date: "2026-09-10T08:00:00", gross_aed: gross, financial_status: "paid", store_id: "MAIN", gateway: "Stripe", country: "SA", ...extra,
});
const s = (order: string, aed: number, extra: Partial<SheetRow> = {}): SheetRow => ({
  tab: "SMSA", source: "September 2026", row: 10, order, day: "2026-09-10", time: null, kind: "sale", amountAed: aed, grossAed: aed,
  cancelledRefundedAed: null, amountOriginal: aed, currency: "AED", exchangeRate: null, party: "", gateway: "", saleType: "", voucher: "",
  comments: "", paymentAuthorised: "", paymentStatus: "", receivedOn: "", feeDeducted: null, balanceReceived: null, feePct: "", refundDate: "",
  deliveryBy: "", shipmentStatus: "", salesPerson: "", otInvoice: "", flaggedDuplicate: false, ...extra,
});
const inv = (n: string, t: number): [string, { numbers: string[]; totalAed: number; org: string }] => [n, { numbers: [`MNS-${n}`], totalAed: t, org: "env" }];

test("one status per order across store, Zoho and sheet", () => {
  const { rows, summary } = compareThreeWay({
    fromDay: "2026-09-01", toDay: "2026-09-30",
    orders: [
      o("OS3701", 1000),                                                            // ok
      o("OS3702", 500, { country: "AE" }),                                          // missing (Local)
      o("OS3703", 800),                                                             // amount diff
      o("OS3704", 300, { financial_status: "cancelled" }),                          // cancelled both
      o("OS3705", 400),                                                             // no invoice
      o("OS3706", 600),                                                             // duplicate
      o("OS3707", 900),                                                             // sheet refunded, store still counts → mismatch
      o("SA3708", 978.61, { financial_status: "partially_refunded" }),             // partial refund agrees
      o("OS3709", 700, { order_date: "2026-09-30T19:00:00" }),                     // logged next day → timing +1 (Dubai 30 Sep 23:00)
    ],
    invoices: new Map([inv("OS3701", 1000), inv("OS3703", 800), inv("OS3706", 600), inv("OS3707", 900), inv("SA3708", 978.61), inv("OS3709", 700)]),
    sheet: [
      s("OS3701", 1000), s("OS3703", 700), s("OS3704", 0, { kind: "cancelled", grossAed: 300, cancelledRefundedAed: 300 }), s("OS3705", 400),
      s("OS3706", 600, { row: 11 }), s("OS3706", 600, { row: 12 }),
      s("OS3707", 0, { kind: "refunded", grossAed: 900, cancelledRefundedAed: 900 }),
      s("SA3708", 84.34, { kind: "partial_refund", grossAed: 978.61, cancelledRefundedAed: 894.27, currency: "SAR" }),
      s("OS3709", 700, { day: "2026-10-01" }),
      s("804671", 30, { kind: "exchange", saleType: "Exchange/COD" }),            // shipment, not a sale
      s("OS9999", 50),                                                              // no such order
    ],
  });
  const st = Object.fromEntries(rows.map((r) => [r.order, r.status]));
  assert.deepEqual(st, {
    OS3701: "ok", OS3702: "missing_in_sheet", OS3703: "amount_diff", OS3704: "cancelled_refunded", OS3705: "no_invoice",
    OS3706: "duplicate_in_sheet", OS3707: "cancel_mismatch", SA3708: "ok", OS3709: "ok", "804671": "exchange", OS9999: "sheet_only",
  });
  assert.equal(rows.find((r) => r.order === "OS3709")!.timingDays, 1);
  assert.equal(rows.find((r) => r.order === "OS3702")!.lane, "Local");
  assert.equal(summary.timing.differentMonth, 1);
  assert.equal(summary.foreignCurrency, 1);
  assert.equal(summary.shipments, 1);
});

test("store totals are the dashboard's: an earlier month's order in this sheet is shown, never counted", () => {
  const { rows, summary } = compareThreeWay({
    fromDay: "2026-09-01", toDay: "2026-09-30",
    orders: [o("OS3701", 1000), o("804647", 978.61, { order_date: "2026-08-31T08:00:00" }), o("804671", 1794, { order_date: "2026-08-31T08:00:00" })],
    invoices: new Map([inv("OS3701", 1000), inv("804647", 978.61), inv("804671", 1794)]),
    sheet: [s("OS3701", 1000), s("804647", 978.61, { day: "2026-09-05" }), s("804671", 30, { kind: "exchange", saleType: "Exchange/COD", day: "2026-09-02" })],
  });
  assert.equal(summary.ours.orders, 1);
  assert.equal(summary.ours.aed, 1000);
  assert.equal(summary.verified.aed, 1000);
  const st = Object.fromEntries(rows.map((r) => [r.order, r.status]));
  assert.deepEqual(st, { OS3701: "ok", "804647": "other_month", "804671": "exchange" });
});
