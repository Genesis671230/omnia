import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCodInvoiceReport, type CodDocIn, type CodOrderIn } from "@/lib/reports/cod-invoice-report";

const HOO = "House of Omnia";
const o = (n: string, gross: number, extra: Partial<CodOrderIn> = {}): CodOrderIn => ({
  uid: `WA-${n}`, order_number: n, store_id: "WA", order_date: "2026-09-10T08:00:00", customer_name: "C", gross_aed: gross, financial_status: "pending", ...extra,
});
const inv = (order: string, total: number, balance: number, extra: Partial<CodDocIn> = {}): CodDocIn => ({
  kind: "invoice", org: HOO, id: `I-${order}`, number: `INV-${order}`, order, date: "2026-09-11", status: balance > 0 ? "sent" : "paid", total, balance, ...extra,
});

test("one state per COD order, with what to do next", () => {
  const r = buildCodInvoiceReport({
    month: "2026-09", today: "2026-10-02", homeOrg: HOO,
    orders: [
      o("WA1", 500),                                        // open, no voucher → with courier
      o("WA2", 400),                                        // voucher uploaded, Zoho open → book it
      o("WA3", 300),                                        // paid
      o("WA4", 200),                                        // no invoice
      o("WA5", 100, { ops_status: "cancelled" }),           // cancelled from the app
      o("WA6", 600),                                        // returned from the app
      o("WA7", 700),                                        // invoiced in the wrong org, amount differs
      o("WA8", 50, { order_date: "2026-08-30T08:00:00" }), // other month
    ],
    docs: [
      inv("WA1", 500, 500), inv("WA2", 400, 400), inv("WA3", 300, 0), inv("WA5", 100, 0), inv("WA6", 600, 0),
      inv("WA7", 650, 650, { org: "Omniastores LLC" }),
      { kind: "creditnote", org: HOO, id: "C6", number: "CN-6", order: "WA6", date: "2026-10-01", status: "closed", total: 600, balance: 0 },
    ],
    ledger: new Map([
      ["WA1", { status: "cod", payoutId: null, payoutSource: null, bankDate: null, receivedAed: 0 }],
      ["WA2", { status: "awaiting_bank", payoutId: "P", payoutSource: "CP17187", bankDate: null, receivedAed: 0 }],
    ]),
    adjustments: new Map([["WA6", { kind: "returned", creditAed: 600, creditNote: "CN-6", date: "2026-10-01" }]]),
  });
  const s = Object.fromEntries(r.rows.map((x) => [x.order, x]));
  assert.equal(s.WA1.state, "with_courier");
  assert.equal(s.WA1.ageDays, 22);
  assert.equal(s.WA2.state, "remitted_not_booked");
  assert.equal(s.WA2.courier!.voucher, "CP17187");
  assert.equal(s.WA3.state, "paid");
  assert.equal(s.WA4.state, "no_invoice");
  assert.equal(s.WA5.state, "cancelled");
  assert.equal(s.WA6.state, "returned");
  assert.equal(s.WA7.state, "with_courier");
  assert.deepEqual(s.WA7.flags, ["Invoiced in Omniastores LLC, not House of Omnia", "Invoice 650.00 ≠ order 700.00"]);
  assert.equal(s.WA8, undefined);
  assert.equal(r.totals.orders, 6);
  assert.equal(r.totals.openAed, 500 + 400 + 200 + 650);
  assert.equal(r.openByAge.find((b) => b.band === "16–30 days")!.orders, 4);
  assert.equal(r.rows[0].state, "with_courier", "what needs action first");
});

test("a zero-value intercompany invoice in Omniastores is not a second invoice (805455)", () => {
  const r = buildCodInvoiceReport({
    month: "2026-09", today: "2026-10-02", homeOrg: HOO, orders: [o("805455", 1668)],
    docs: [inv("805455", 0, 0, { org: "Omniastores LLC", number: "MNS-053274" }), inv("805455", 1668, 1668)],
    ledger: new Map(), adjustments: new Map(),
  });
  assert.equal(r.rows[0].invoice!.number, "INV-805455");
  assert.deepEqual(r.rows[0].flags, []);
  assert.equal(r.rows[0].state, "with_courier");
});
