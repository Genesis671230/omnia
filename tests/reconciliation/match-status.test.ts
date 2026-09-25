import { test } from "node:test";
import assert from "node:assert/strict";
import { dayKpis, inStatus, matchKind } from "@/lib/reconciliation/match-status";

const base = { state: "SETTLED" as const, bankAmount: 10000, variance: 0, payout: {}, resolvedOrders: ["1"], forceBook: null, confirmedBy: null, reviewFlag: false };

test("each state maps to exactly one label", () => {
  assert.equal(matchKind(base).kind, "matched");
  assert.equal(matchKind({ ...base, state: "AWAITING_PAYOUT", payout: null }).kind, "awaiting");
  assert.equal(matchKind({ ...base, state: "ORDERS_UNRESOLVED" }).kind, "exception");
});

test("variance within the bank's cut is force matched and carries its gap", () => {
  const r = matchKind({ ...base, state: "PAYOUT_VARIANCE", variance: -47.94 }); // 0.48% of 10k
  assert.deepEqual(r, { kind: "force", gap: -47.94 });
});

test("variance beyond the limit is an exception unless force-booked and confirmed", () => {
  const big = { ...base, state: "PAYOUT_VARIANCE" as const, variance: 900 };
  assert.equal(matchKind(big).kind, "exception");
  assert.equal(matchKind({ ...big, forceBook: {}, confirmedBy: "founder" }).kind, "force");
  assert.equal(matchKind({ ...big, forceBook: {} }).kind, "exception");
});

test("a variance with no matched orders is never force matched", () => {
  assert.equal(matchKind({ ...base, state: "PAYOUT_VARIANCE", variance: 1, resolvedOrders: [] }).kind, "exception");
});

test("flagged rows show under Exceptions and Flagged, not only their state", () => {
  const f = { ...base, reviewFlag: true };
  assert.ok(inStatus(f, "settled"));
  assert.ok(inStatus(f, "exceptions"));
  assert.ok(inStatus(f, "flagged"));
});

test("day KPIs: settled share by AED, variance only on rows with a payout", () => {
  const k = dayKpis([base, { ...base, state: "AWAITING_PAYOUT", payout: null, bankAmount: 30000, variance: 30000 }]);
  assert.equal(k.credits, 2);
  assert.equal(k.pctSettled, 25);
  assert.equal(k.variance, 0);
});
