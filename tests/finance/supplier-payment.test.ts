import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateOldestFirst, checkAllocation, supplierPaymentReference } from "../../lib/finance/supplier-payment";
import { buildVendorPaymentBody, buildApplyAdvanceBody } from "../../lib/integrations/zoho-vendors";

const bills = [
  { bill_id: "b1", balance: 1000 },
  { bill_id: "b2", balance: 500.5 },
  { bill_id: "b3", balance: 200 },
];

test("allocateOldestFirst fills bills in order until the amount runs out", () => {
  assert.deepEqual(allocateOldestFirst(1300.25, bills), { b1: 1000, b2: 300.25 });
  assert.deepEqual(allocateOldestFirst(5000, bills), { b1: 1000, b2: 500.5, b3: 200 });
  assert.deepEqual(allocateOldestFirst(0, bills), {});
});

test("checkAllocation leaves the unapplied part as an advance", () => {
  const c = checkAllocation({ amount: 1200, bankAmount: 1500, bills, applied: { b1: 1000 } });
  assert.equal(c.ok, true);
  assert.equal(c.applied, 1000);
  assert.equal(c.advance, 200);
});

test("checkAllocation: no bills at all is a pure advance", () => {
  const c = checkAllocation({ amount: 750, bankAmount: 750, bills: [], applied: {} });
  assert.deepEqual(c, { ok: true, applied: 0, advance: 750, errors: [] });
});

test("checkAllocation refuses more than the debit, a bill's balance, or the payment", () => {
  assert.equal(checkAllocation({ amount: 2000, bankAmount: 1500, bills, applied: {} }).ok, false);
  assert.equal(checkAllocation({ amount: 1500, bankAmount: 1500, bills, applied: { b3: 250 } }).ok, false);
  assert.equal(checkAllocation({ amount: 800, bankAmount: 1500, bills, applied: { b1: 900 } }).ok, false);
  assert.equal(checkAllocation({ amount: 800, bankAmount: 1500, bills, applied: { gone: 10 } }).ok, false);
  assert.equal(checkAllocation({ amount: 0, bankAmount: 1500, bills, applied: {} }).ok, false);
});

test("supplierPaymentReference is stable per bank line + supplier", () => {
  assert.equal(supplierPaymentReference("FT123", "L1", "2330082000000123456"), "FT123/VP/00123456");
  assert.equal(supplierPaymentReference("", "L1", "999"), "BANKLINE-L1/VP/999");
});

test("buildVendorPaymentBody matches Zoho's create-a-vendor-payment-request", () => {
  const body = buildVendorPaymentBody({
    vendorId: "v1", amount: 1200.005, date: "2026-09-29", paidThroughAccountId: "bank",
    reference: "FT1/VP/v1", description: "Payment", bills: [{ billId: "b1", amount: 1000 }],
  });
  assert.deepEqual(body.bills, [{ bill_id: "b1", amount_applied: 1000 }]);
  assert.equal(body.paid_through_account_id, "bank");
  assert.equal(body.amount, 1200.01);
  const advance = buildVendorPaymentBody({ vendorId: "v1", amount: 50, date: "2026-09-29", paidThroughAccountId: "bank", reference: "r", description: "d", bills: [] });
  assert.equal("bills" in advance, false);
});

test("applying an advance keeps the bills the payment already pays and adds to them", () => {
  const body = buildApplyAdvanceBody({
    payment_id: "P", vendor_id: "V", amount: 1000, balance: 600, date: "2026-09-01", reference_number: "FT1/VP/x",
    description: "advance", payment_mode: "Bank Transfer", paid_through_account_id: "BANK", exchange_rate: 1,
    bills: [{ bill_id: "B1", amount_applied: 400 }],
  }, [{ billId: "B1", amount: 100 }, { billId: "B2", amount: 250.005 }]);
  assert.equal(body.vendor_id, "V");
  assert.equal(body.amount, 1000);
  assert.deepEqual(body.bills, [{ bill_id: "B1", amount_applied: 500 }, { bill_id: "B2", amount_applied: 250.01 }]);
});
