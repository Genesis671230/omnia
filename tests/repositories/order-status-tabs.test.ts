import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOrdersQuery, statusTabFilter } from "@/lib/repositories/orders.repository";

test("each status tab maps to its financial status; refunded also catches returns", () => {
  assert.deepEqual(statusTabFilter("cancelled"), { eq: "cancelled" });
  assert.deepEqual(statusTabFilter("voided"), { eq: "voided" });
  assert.deepEqual(statusTabFilter("failed"), { eq: "failed" });
  assert.deepEqual(statusTabFilter("refunded"), { or: "financial_status.in.(refunded,partially_refunded),refunded_amount.gt.0" });
  assert.equal(statusTabFilter("all"), null);
  assert.equal(statusTabFilter("not_in_zoho"), null, "resolved against Zoho in the route");
});

test("an unknown ?status= falls back to all orders", () => {
  assert.equal(parseOrdersQuery(new URLSearchParams("status=bogus")).status, "all");
  assert.equal(parseOrdersQuery(new URLSearchParams("status=not_in_zoho")).status, "not_in_zoho");
});
