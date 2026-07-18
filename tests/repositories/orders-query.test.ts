import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOrdersQuery } from "@/lib/repositories/orders.repository";

test("parseOrdersQuery: defaults to 30 days, page 1, limit 50, no filters", () => {
  const q = parseOrdersQuery(new URLSearchParams());
  assert.equal(q.days, 30);
  assert.equal(q.page, 1);
  assert.equal(q.limit, 50);
  assert.equal(q.store, null);
  assert.equal(q.location, null);
  assert.equal(q.q, "");
});

test("parseOrdersQuery: days=0 means unbounded (no lower date bound)", () => {
  const q = parseOrdersQuery(new URLSearchParams("days=0"));
  assert.equal(q.days, 0);
});

test("parseOrdersQuery: clamps page below 1 up to 1", () => {
  assert.equal(parseOrdersQuery(new URLSearchParams("page=0")).page, 1);
  assert.equal(parseOrdersQuery(new URLSearchParams("page=-5")).page, 1);
});

test("parseOrdersQuery: clamps limit to [1, 200]", () => {
  assert.equal(parseOrdersQuery(new URLSearchParams("limit=0")).limit, 1);
  assert.equal(parseOrdersQuery(new URLSearchParams("limit=5000")).limit, 200);
});

test("parseOrdersQuery: 'All' store normalizes to null (no filter)", () => {
  assert.equal(parseOrdersQuery(new URLSearchParams("store=All")).store, null);
  assert.equal(parseOrdersQuery(new URLSearchParams("store=UAE")).store, "UAE");
});

test("parseOrdersQuery: 'All locations' normalizes to null", () => {
  assert.equal(parseOrdersQuery(new URLSearchParams("location=All+locations")).location, null);
  assert.equal(parseOrdersQuery(new URLSearchParams("location=Dubai")).location, "Dubai");
});

test("parseOrdersQuery: trims search text", () => {
  assert.equal(parseOrdersQuery(new URLSearchParams("q=+nada+")).q, "nada");
});
