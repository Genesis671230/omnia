import { test } from "node:test";
import assert from "node:assert/strict";
import { sumDays, sumGateways, toDayMoney } from "../../lib/orders/day-money";

const day = (over: Partial<Parameters<typeof toDayMoney>[0]> = {}) => ({
  day: "2026-09-27",
  grossAed: 1000,
  orders: 3,
  feeAed: 30,
  receivedAed: 580,
  receivedGrossAed: 600,
  headline: "awaiting_bank",
  reason: "",
  orderList: [
    { feeAed: 20, feeBasis: "measured" as const, status: "received", grossAed: 600, gateway: "Stripe" },
    { feeAed: 10, feeBasis: "estimated" as const, status: "awaiting_bank", grossAed: 300, gateway: "Stripe" },
    { feeAed: 0, feeBasis: "estimated" as const, status: "cod", grossAed: 100, gateway: "COD" },
  ],
  ...over,
});

test("received + pending always stack to what the day sold", () => {
  const m = toDayMoney(day());
  assert.equal(m.soldAed, 1000);
  assert.equal(m.receivedAed, 600);
  assert.equal(m.pendingAed, 400);
  assert.equal(m.landedNetAed, 580);
  assert.equal(m.codAed, 100);
});

test("fee estimate share and rate", () => {
  const m = toDayMoney(day());
  assert.equal(m.feeAed, 30);
  assert.ok(Math.abs(m.feeEstimatedShare - 1 / 3) < 1e-9);
  assert.ok(Math.abs(m.feeRate - 0.03) < 1e-9);
});

test("received never exceeds sold, pending never negative", () => {
  const m = toDayMoney(day({ receivedGrossAed: 1200 }));
  assert.equal(m.receivedAed, 1000);
  assert.equal(m.pendingAed, 0);
});

test("empty day has no fee rate", () => {
  const m = toDayMoney(day({ grossAed: 0, feeAed: 0, receivedGrossAed: 0, receivedAed: 0, orders: 0, orderList: [] }));
  assert.equal(m.feeRate, 0);
  assert.equal(m.feeEstimatedShare, 0);
});

test("sumDays totals and weighted estimate share", () => {
  const t = sumDays([toDayMoney(day()), toDayMoney(day({ feeAed: 30, orderList: [{ feeAed: 30, feeBasis: "measured", status: "received", grossAed: 1000 }] }))]);
  assert.equal(t.soldAed, 2000);
  assert.equal(t.pendingAed, 800);
  assert.equal(t.feeAed, 60);
  assert.ok(Math.abs(t.feeEstimatedShare - 10 / 60) < 1e-9);
});

test("gateway split per day and across days", () => {
  const m = toDayMoney(day());
  assert.deepEqual(m.byGateway.map((g) => [g.gateway, g.soldAed, g.receivedAed, g.pendingAed, g.feeAed]), [
    ["Stripe", 900, 600, 300, 30],
    ["COD", 100, 0, 100, 0],
  ]);
  const t = sumGateways([m, m]);
  assert.equal(t[0].soldAed, 1800);
  assert.equal(t[1].orders, 2);
});

test("an order with no gateway is Unclassified, never dropped", () => {
  const m = toDayMoney(day({ orderList: [{ feeAed: 1, feeBasis: "estimated", status: "received", grossAed: 50 }] }));
  assert.equal(m.byGateway[0].gateway, "Unclassified");
});
