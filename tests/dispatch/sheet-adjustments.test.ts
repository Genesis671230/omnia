import { test } from "node:test";
import assert from "node:assert/strict";
import { refundFromComment, suggestSheetAdjustments, type SheetAdjOrder } from "@/lib/dispatch/sheet-adjustments";
import type { SheetRow } from "@/lib/integrations/dispatch-sheet-read";

const order = (n: string, over: Partial<SheetAdjOrder> = {}): SheetAdjOrder => ({
  uid: `u-${n}`, order_number: n, store_id: "MAIN", order_date: "2026-09-10T08:00:00", customer_name: "C", gateway: "Tabby",
  gross_aed: 1000, financial_status: "paid", ...over,
});
const row = (n: string, kind: SheetRow["kind"], over: Partial<SheetRow> = {}): SheetRow => ({
  tab: "Local", source: "September 2026", row: 10, order: n, day: "2026-09-12", time: null, kind, amountAed: 0, grossAed: 1000,
  cancelledRefundedAed: null, amountOriginal: null, currency: "AED", exchangeRate: null, party: "", gateway: "", saleType: "Paid", voucher: "",
  comments: "", paymentAuthorised: "", paymentStatus: "", receivedOn: "", feeDeducted: null, balanceReceived: null, feePct: "", refundDate: "",
  deliveryBy: "", shipmentStatus: "", salesPerson: "", otInvoice: "", flaggedDuplicate: false, ...over,
} as SheetRow);
const run = (orders: SheetAdjOrder[], sheet: SheetRow[], extra: Partial<Parameters<typeof suggestSheetAdjustments>[0]> = {}) =>
  suggestSheetAdjustments({ fromDay: "2026-09-01", toDay: "2026-09-30", orders, sheet, posted: new Map(), ...extra });

test("refund amount: gateway cash beats the Zoho credit note beats the sheet", () => {
  const [s] = run([order("OS1")], [row("OS1", "partial_refund", { cancelledRefundedAed: 700, comments: "Returned and refunded" })], {
    creditNotes: new Map([["OS1", [{ number: "CN-1", total: 720, date: "2026-09-13", reference: "" }]]]),
    gatewayRefunds: new Map([["OS1", [{ amountAed: 690, gateway: "Tabby", date: "2026-09-20" }]]]),
  });
  assert.equal(s.kind, "returned");
  assert.equal(s.refundedAed, 690);
  assert.equal(s.amountSource, "gateway");
  assert.equal(s.deductAed, 310);
  assert.equal(s.eventDate, "2026-09-20");
  assert.equal(s.evidence.length, 3);
});

test("a refund credit note on an order marked received is a refund — not blocked", () => {
  const [s] = run([order("OS2")], [], {
    posted: new Map([["u-OS2", "received"]]),
    creditNotes: new Map([["OS2", [{ number: "CN-2", total: 1000, date: "2026-09-15", reference: "" }]]]),
  });
  assert.equal(s.kind, "refunded");
  assert.equal(s.wasReceived, true);
  assert.equal(s.blockedBy, null);
  assert.equal(s.deductAed, 0);
});

test("already marked returned / refunded / exchanged → not listed again", () => {
  assert.equal(run([order("OS3")], [row("OS3", "refunded")], { posted: new Map([["u-OS3", "refunded"]]) }).length, 0);
});

test("exchange in the sheet with a valued (re-invoice) credit note stays an exchange", () => {
  const [s] = run([order("OS4")], [row("OS4", "exchange", { saleType: "Exchange/Paid" })], {
    creditNotes: new Map([["OS4", [{ number: "CN-4", total: 1000, date: "2026-09-15", reference: "" }]]]),
  });
  assert.equal(s.kind, "exchanged");
  assert.equal(s.refundedAed, 0);
});

test("the app's own ADJ/ credit notes are not outside evidence; cancelled sheet row wins", () => {
  assert.equal(run([order("OS5")], [], { creditNotes: new Map([["OS5", [{ number: "CN-5", total: 1000, date: "", reference: "ADJ/OS5/CN" }]]]) }).length, 0);
  const [c] = run([order("OS6", { gateway: "COD", financial_status: "pending", store_id: "WA" })], [row("OS6", "cancelled", { comments: "Canceled Before Dispatch" })]);
  assert.equal(c.kind, "cancelled");
  assert.equal(c.refundedAed, 1000);
});

test("partial refund amount read off the comment when the column is empty; SAR is left for a person", () => {
  assert.equal(refundFromComment("Paid — 1 Item refunded (714)"), 714);
  assert.equal(refundFromComment("25 AED Refunded - Extra Payment"), 25);
  assert.equal(refundFromComment("109.30 SAR - REFUND"), null);
  const [s] = run([order("OS7")], [row("OS7", "partial_refund", { comments: "109.30 SAR - REFUND" })]);
  assert.equal(s.needsAmount, true);
});

test("orders outside the month are ignored", () => {
  assert.equal(run([order("OS8", { order_date: "2026-08-30T08:00:00" })], [row("OS8", "refunded")]).length, 0);
});
