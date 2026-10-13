import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { byDay, byGateway, orderMoney, overdueByGateway, sumMoney, DEFAULT_TERMS } from "@/lib/dashboard/admin-money";
import { fxShare } from "@/lib/orders/sales-ledger";
import { overdueMessage, overdueCallScript } from "@/lib/alerts/overdue-followup";
import type { LedgerOrder } from "@/lib/orders/sales-ledger";

const base: LedgerOrder = {
  uid: "u1", store: "MAIN", orderNumber: "OS1", orderDate: "2026-10-05T08:00:00", customerName: "A", gateway: "Stripe",
  grossAed: 1000, feeAed: 30, receivedAed: 0, feeBasis: "measured", vatAed: 1.5, payoutNetAed: 968.5, fxAed: 0,
  status: "awaiting_bank", reason: "", currency: "AED", grossOriginal: null, paymentMethod: "Stripe", financialStatus: "paid",
  payoutLine: null, adjustment: null, partial: null, payout: null, bank: null,
};
const o = (p: Partial<LedgerOrder>) => ({ ...base, ...p });
const TODAY = "2026-10-13";
const like = (a: object, b: Record<string, unknown>) => { for (const [k, v] of Object.entries(b)) assert.deepEqual((a as Record<string, unknown>)[k], v, k); };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
const foots = (r: ReturnType<typeof orderMoney>) => +(r.deductions + r.refunds + r.fx + r.netReceived + r.awaiting).toFixed(2);

describe("orderMoney", () => {
  it("received: fee + VAT deducted, FX taken off what reached the bank", () => {
    const r = orderMoney(o({ status: "received", receivedAed: 968.5, fxAed: 8.5, bank: { id: "b", date: "2026-10-09", amountAed: 960, reference: "", state: "SETTLED", confirmed: true } }), TODAY);
    like(r, { status: "received", fee: 30, vat: 1.5, deductions: 31.5, netPayout: 968.5, fx: 8.5, netReceived: 960, awaiting: 0, ageDays: 4, receivedOn: "2026-10-09" });
    assert.equal(foots(r), r.sale);
  });
  it("awaiting: expected net is what is awaited; overdue after usual days + grace", () => {
    const r = orderMoney(o({}), TODAY); // Stripe 7 + 2 grace, 8 days old
    like(r, { status: "awaiting", awaiting: 968.5, netReceived: 0, ageDays: 8, overdueDays: 0 });
    const late = orderMoney(o({ orderDate: "2026-10-02T08:00:00" }), TODAY);
    like(late, { status: "overdue", ageDays: 11, overdueDays: 2 });
    assert.equal(foots(late), late.sale);
  });
  it("COD without a voucher awaits the whole sale; refunded orders move nothing", () => {
    const cod = orderMoney(o({ gateway: "COD", status: "cod", feeAed: 0, vatAed: null, payoutNetAed: 0 }), TODAY);
    like(cod, { deductions: 0, awaiting: 1000 });
    const ref = orderMoney(o({ status: "adjusted", payoutNetAed: 0 }), TODAY);
    like(ref, { status: "refunded", refunds: 1000, awaiting: 0, netPayout: 0 });
    assert.equal(foots(ref), 1000);
  });
  it("uses the dubai day of the order (early-morning UTC orders)", () => {
    assert.equal(orderMoney(o({ orderDate: "2026-10-04T21:30:00" }), TODAY).day, "2026-10-05");
  });
});

describe("sums agree everywhere", () => {
  const rows = [
    orderMoney(o({ uid: "1" }), TODAY),
    orderMoney(o({ uid: "2", gateway: "Tabby", grossAed: 500, feeAed: 25, vatAed: 0, payoutNetAed: 475, orderDate: "2026-10-06T08:00:00" }), TODAY),
    orderMoney(o({ uid: "3", status: "received", receivedAed: 968.5, fxAed: 2, bank: { id: "b", date: "2026-10-08", amountAed: 966.5, reference: "", state: "SETTLED", confirmed: true } }), TODAY),
  ];
  it("day rows and gateway rows add up to the range total", () => {
    const t = sumMoney(rows);
    const days = byDay(rows, ["2026-10-05", "2026-10-06"]);
    const gws = byGateway(rows);
    for (const k of ["sale", "deductions", "fx", "netReceived", "awaiting"] as const) {
      assert.equal(+days.reduce((a, d) => a + d[k], 0).toFixed(2), t[k]);
      assert.equal(+gws.reduce((a, g) => a + g[k], 0).toFixed(2), t[k]);
    }
    near(t.deductionRate, (31.5 * 2 + 25) / 2500);
    near(gws.find((g) => g.gateway === "Stripe")!.deductionRate, 63 / 2000);
  });
  it("overdue grouping", () => {
    const late = [orderMoney(o({ orderDate: "2026-10-01T08:00:00" }), TODAY), orderMoney(o({ uid: "x", orderNumber: "OS2", orderDate: "2026-10-02T08:00:00" }), TODAY)];
    const g = overdueByGateway(late, DEFAULT_TERMS);
    assert.equal(g.length, 1);
    like(g[0], { gateway: "Stripe", orders: 2, amount: 1937, oldestOrder: "OS1", oldestDays: 12 });
    const msg = overdueMessage(TODAY, g, late, 5000)!;
    assert.ok(msg.includes("AED 1,937 overdue across 2 orders"));
    assert.ok(msg.includes("transfer reference")); // awaiting_bank → next step
    assert.ok(overdueCallScript(g).includes("1,937 dirhams"));
    assert.equal(overdueMessage(TODAY, [], [], 0), null);
  });
});

describe("fxShare", () => {
  it("splits the bank shortfall by the order's share of the payouts", () => {
    assert.equal(fxShare(250, 970, 1000), 7.5);
    assert.equal(fxShare(250, 1000, 1000), 0);
  });
  it("ignores gaps over 5% (a mismatch, not FX) and bad input", () => {
    assert.equal(fxShare(250, 900, 1000), 0);
    assert.equal(fxShare(0, 970, 1000), 0);
    assert.equal(fxShare(250, 970, 0), 0);
  });
});
