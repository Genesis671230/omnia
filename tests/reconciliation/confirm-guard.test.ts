import { test } from "node:test";
import assert from "node:assert/strict";
import { isConfirmable, isConfirmablePartial, type ReconLine } from "@/components/finance/reconciliation/types";

// Four credits were confirmed while still AWAITING_PAYOUT — recon_lines held
// confirmed_by: "founder" with payout_id: null — and then could not be repaired,
// because the upload control was hidden on confirmed rows. The row showed a
// clean "Confirmed" badge with no file behind it and no way to attach one.

type Line = Pick<ReconLine, "state" | "payout" | "resolvedOrders" | "variance" | "bankAmount">;

const withPayout: Line = {
  state: "SETTLED",
  payout: { id: "Tabby20260914AED-AE", net: 34695.28, source: "f.xlsx", currency: null, fxRate: null, fxSource: null },
  resolvedOrders: ["805253"],
  variance: 0,
  bankAmount: 34695.28,
};

const fileless: Line = {
  state: "AWAITING_PAYOUT",
  payout: null,
  resolvedOrders: [],
  variance: 0,
  bankAmount: 34695.28,
};

test("a credit with no payout file is never confirmable", () => {
  assert.equal(isConfirmable(fileless), false);
});

test("a settled credit backed by a payout stays confirmable", () => {
  assert.equal(isConfirmable(withPayout), true);
});

test("SETTLED alone does not make a fileless row confirmable", () => {
  // Defence in depth: the engine cannot currently produce SETTLED without a
  // payout, but the button must not reappear if that ever changes.
  assert.equal(isConfirmable({ ...fileless, state: "SETTLED", resolvedOrders: ["805253"] }), false);
});

test("a partial row still requires its payout", () => {
  assert.equal(
    isConfirmablePartial({ state: "ORDERS_UNRESOLVED", payout: null, resolvedOrders: ["805253"] }),
    false,
  );
  assert.equal(
    isConfirmablePartial({ state: "ORDERS_UNRESOLVED", payout: withPayout.payout, resolvedOrders: ["805253"] }),
    true,
  );
});
