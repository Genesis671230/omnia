import { test } from "node:test";
import assert from "node:assert/strict";
import { calculate, sanitise } from "../../lib/ramza/calculator";

const BASE = {
  ordersPerMonth: 1500,
  gateways: 4,
  hoursPerMonth: 12,
  hourlyCostAed: 120,
};

test("the annual cost is the visitor's own hours times their own rate", () => {
  const r = calculate(BASE);
  // 12h x AED 120 = 1,440 a month, x12 = 17,280. Nothing else feeds this.
  assert.equal(r.monthlyCostAed, 1440);
  assert.equal(r.annualCostAed, 17280);
});

test("lines to match is orders plus one payout reconciliation per gateway per week", () => {
  const r = calculate(BASE);
  assert.equal(r.matchesPerMonth, 1500 + 4 * 4);
  assert.equal(r.matchesPerYear, (1500 + 16) * 12);
});

test("working days are hours over an eight hour day", () => {
  const r = calculate({ ...BASE, hoursPerMonth: 20 });
  assert.equal(r.hoursPerYear, 240);
  assert.equal(r.workingDaysPerYear, 30);
});

test("seconds per match is derived, so the visitor can sanity-check their own hours", () => {
  const r = calculate({ ...BASE, ordersPerMonth: 100, gateways: 1, hoursPerMonth: 1 });
  // 1 hour over 104 lines is about 34.6 seconds each.
  assert.equal(r.matchesPerMonth, 104);
  assert.equal(r.secondsPerMatch, 34.6);
});

test("zero hours gives zero cost rather than NaN", () => {
  const r = calculate({ ...BASE, hoursPerMonth: 0 });
  assert.equal(r.monthlyCostAed, 0);
  assert.equal(r.annualCostAed, 0);
  assert.equal(r.workingDaysPerYear, 0);
  assert.equal(r.secondsPerMatch, 0);
});

test("junk input is clamped to the bounds instead of producing NaN", () => {
  const r = sanitise({
    ordersPerMonth: Number.NaN,
    gateways: -3,
    hoursPerMonth: 99999,
    hourlyCostAed: Number.POSITIVE_INFINITY,
  });
  assert.equal(r.ordersPerMonth, 1);
  assert.equal(r.gateways, 1);
  assert.equal(r.hoursPerMonth, 744);
  assert.equal(r.hourlyCostAed, 10000);
  const c = calculate(r);
  assert.ok(Number.isFinite(c.annualCostAed));
});

test("missing fields do not crash the calculation", () => {
  const c = calculate({});
  assert.ok(Number.isFinite(c.annualCostAed));
  assert.ok(Number.isFinite(c.matchesPerMonth));
});

test("orders and gateways are whole numbers even if a float arrives", () => {
  const r = sanitise({ ...BASE, ordersPerMonth: 1500.7, gateways: 3.4 });
  assert.equal(r.ordersPerMonth, 1501);
  assert.equal(r.gateways, 3);
});

test("money is rounded to two decimals, not left as float noise", () => {
  const r = calculate({ ...BASE, hoursPerMonth: 0.1, hourlyCostAed: 0.2 });
  assert.equal(r.monthlyCostAed, 0.02);
});
