import { test } from "node:test";
import assert from "node:assert/strict";
import { refKey } from "@/lib/sync/stripe-payment-confirm";

test("refKey: strips a leading store prefix so 'WA1001' matches order_number '1001'", () => {
  assert.equal(refKey("WA1001"), "1001");
  assert.equal(refKey("UAE1001"), "1001");
  assert.equal(refKey("KSA1001"), "1001");
  assert.equal(refKey("WOO1001"), "1001");
});

test("refKey: is case-insensitive on both the prefix and the rest", () => {
  assert.equal(refKey("wa1001"), "1001");
  assert.equal(refKey("Wa1001"), "1001");
});

test("refKey: an order number with no store prefix is unchanged (aside from case/trim)", () => {
  assert.equal(refKey(" 1001 "), "1001");
});

test("refKey: only strips a LEADING prefix, not one embedded elsewhere", () => {
  assert.equal(refKey("1001WA"), "1001WA");
});
