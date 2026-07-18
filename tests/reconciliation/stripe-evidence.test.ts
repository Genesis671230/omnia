import { test } from "node:test";
import assert from "node:assert/strict";
import { stripeEvidencedOrderNumbers } from "@/lib/reconciliation/engine";

test("stripeEvidencedOrderNumbers: keeps only order numbers present in Stripe's refs", () => {
  const result = stripeEvidencedOrderNumbers(["1001", "1002", "1003"], ["1001", "1003", "9999"]);
  assert.deepEqual(result, ["1001", "1003"]);
});

test("stripeEvidencedOrderNumbers: empty refs from Stripe evidences nothing", () => {
  assert.deepEqual(stripeEvidencedOrderNumbers(["1001"], []), []);
});
