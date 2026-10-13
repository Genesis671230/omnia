import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSettlementConflicts } from "@/lib/reconciliation/engine";

// WA55672: Tabby paid 534 (booked), a Stripe top-up of 313.50 paid the
// exchange difference on another payout. Both records must exist.
const tabby = { id: "u1_TABBYLINE", order_uid: "u1", bank_line_id: "TABBYLINE", payout_id: "Tabby20260914AED", zoho_payment_id: "PAY1" };
const stripe = { id: "u1_STRIPELINE", order_uid: "u1", order_number: "WA55672", bank_line_id: "STRIPELINE", payout_id: "STRIPE-po_1UG73r" };
const claimsBoth = () => true;

test("a second gateway's top-up is not blocked by the first gateway's record", () => {
  const r = resolveSettlementConflicts([stripe], [tabby], claimsBoth);
  assert.equal(r.blocked.size, 0);
  assert.deepEqual(r.orphanedIds, []);
});

test("the same payout's money can never get a second record", () => {
  const same = { ...tabby, payout_id: "STRIPE-po_1UG73r", bank_line_id: "OTHERLINE" };
  assert.ok(resolveSettlementConflicts([stripe], [same], claimsBoth).blocked.has(stripe.id));
  // booked but its credit no longer claims the order: still blocked (a booked payment is history)
  assert.ok(resolveSettlementConflicts([stripe], [same], () => false).blocked.has(stripe.id));
});

test("a same-payout orphan is superseded and its evidence carried over", () => {
  const orphan = { ...tabby, payout_id: "STRIPE-po_1UG73r", bank_line_id: "OLDLINE", zoho_payment_id: null };
  const r = resolveSettlementConflicts([stripe], [orphan], () => false);
  assert.equal(r.blocked.size, 0);
  assert.deepEqual(r.orphanedIds, [orphan.id]);
  assert.equal(r.carryFrom.get(stripe.id), orphan.id);
});

test("a stale unbooked record of another payout is cleaned up without carrying evidence", () => {
  const stale = { ...tabby, zoho_payment_id: null };
  const r = resolveSettlementConflicts([stripe], [stale], () => false);
  assert.equal(r.blocked.size, 0);
  assert.deepEqual(r.orphanedIds, [stale.id]);
  assert.equal(r.carryFrom.size, 0);
});

test("two candidates of one order on two payouts in the same run are both kept", () => {
  const tabbyCand = { id: "u1_TABBYLINE", order_uid: "u1", order_number: "WA55672", bank_line_id: "TABBYLINE", payout_id: "Tabby20260914AED" };
  const r = resolveSettlementConflicts([tabbyCand, stripe], [tabby], claimsBoth);
  assert.equal(r.blocked.size, 0);
});
