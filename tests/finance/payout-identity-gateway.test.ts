import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePayoutId } from "@/lib/finance/payout-identity";

test("a Stripe or Shopify payout id is authoritative even when its order list changes", () => {
  const existing = [{ id: "STRIPE-po_1UCqGq", orderRefs: ["WA1", "WA2"] }];
  // Re-read with a refund row / unreferenced charge added: same payout, not a duplicate.
  assert.equal(resolvePayoutId({ statementNo: "STRIPE-po_1UCqGq", orderRefs: ["WA1", "WA2", "ch_x"], existing } as never), "STRIPE-po_1UCqGq");
  assert.equal(resolvePayoutId({ statementNo: "SHOPIFY-UAE-148527349918", orderRefs: ["3470", "3471"], existing: [{ id: "SHOPIFY-UAE-148527349918", orderRefs: ["3470"] }] } as never), "SHOPIFY-UAE-148527349918");
});

test("Tabby statement numbers still split by store", () => {
  const id = resolvePayoutId({ statementNo: "Tabby20260907SAR", merchantCode: "AE", orderRefs: ["B"], existing: [{ id: "Tabby20260907SAR", orderRefs: ["A"] }] } as never);
  assert.equal(id, "Tabby20260907SAR-AE");
});
