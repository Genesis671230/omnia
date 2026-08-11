import { test } from "node:test";
import assert from "node:assert/strict";
import { amountWithinTolerance } from "@/lib/sync/payment-match-tolerance";

test("amountWithinTolerance: an exact match is always within tolerance", () => {
  assert.equal(amountWithinTolerance(948.75, 948.75), true);
});

test("amountWithinTolerance: accepts a real observed FX-drift gap (~0.45%)", () => {
  assert.equal(amountWithinTolerance(953.03, 948.75), true);
});

test("amountWithinTolerance: accepts a real observed FX-drift gap (~2%)", () => {
  assert.equal(amountWithinTolerance(2676, 2623.5), true);
});

test("amountWithinTolerance: rejects a wild mismatch that's a different transaction (~94% off)", () => {
  assert.equal(amountWithinTolerance(52.5, 975), false);
});

test("amountWithinTolerance: rejects a wild mismatch that's a different transaction (~90% off)", () => {
  assert.equal(amountWithinTolerance(100, 971.5), false);
});

test("amountWithinTolerance: floor keeps small orders from being over-strict (2 AED floor > 3% of a 20 AED order)", () => {
  assert.equal(amountWithinTolerance(21.5, 20), true); // 1.5 AED gap, 3% of 20 would be 0.6 — floor covers it
});

test("amountWithinTolerance: still rejects a small order that's genuinely a different amount", () => {
  assert.equal(amountWithinTolerance(30, 20), false);
});
