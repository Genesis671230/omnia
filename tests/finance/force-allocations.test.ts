import { test } from "node:test";
import assert from "node:assert/strict";
import { planOrderPosting } from "@/lib/finance/settlement-posting";
import { buildCustomerPaymentBody } from "@/lib/integrations/zoho";

// Live case: Stripe order 805489 — invoice MNS-053491 AED 974.93 open, the
// gateway paid only AED 208.50. Automatic booking holds it; a forced
// allocation books whatever difference results.
const base = { grossAed: 208.5, feeAed: 7.5, netAed: 201, bankScale: 1, crossBorder: false, feeVatInclusive: true };

test("a balance far off the gateway amount is held for review", () => {
  assert.match(planOrderPosting({ ...base, invoiceBalance: 974.93 }).review ?? "", /doesn't match/);
});

test("forced: the founder's amount is booked and the difference goes through, not held", () => {
  const p = planOrderPosting({ ...base, invoiceBalance: 210, forced: true });
  assert.equal(p.review, null);
  assert.equal(p.paymentAmount, 210);
  assert.equal(p.difference, 1.5); // 210 − 7.5 fee − 201 received
  assert.equal(p.differenceKind, "rounding");
});

test("forced still refuses an empty allocation", () => {
  assert.ok(planOrderPosting({ ...base, invoiceBalance: 0, forced: true }).review);
});

test("one payment can be applied across several invoices", () => {
  const body = buildCustomerPaymentBody({
    customerName: "x", invoiceReferenceNumber: "WA55577", amount: 1061.97, gateway: "Stripe", bankReference: "FT1",
    customerId: "C1", invoiceId: "I1",
    allocations: [{ invoiceId: "I1", amount: 1000 }, { invoiceId: "I2", amount: 61.97 }],
  } as Parameters<typeof buildCustomerPaymentBody>[0]);
  assert.deepEqual(body.invoices, [{ invoice_id: "I1", amount_applied: 1000 }, { invoice_id: "I2", amount_applied: 61.97 }]);
});
