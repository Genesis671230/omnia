import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCustomerPaymentBody } from "@/lib/integrations/zoho";

const BASE = {
  invoiceReferenceNumber: "SH-10234",
  amount: 250.5,
  gateway: "Stripe",
  bankReference: "po_1ABC123",
  customerId: "CUST1",
  invoiceId: "INV1",
};

test("buildCustomerPaymentBody: defaults date to today and reference_number to the bank reference", () => {
  const body = buildCustomerPaymentBody(BASE);
  assert.equal(body.date, new Date().toISOString().slice(0, 10));
  assert.equal(body.reference_number, "po_1ABC123");
  assert.equal(body.payment_mode, "Credit Card");
  assert.equal(body.amount, 250.5);
  assert.deepEqual(body.invoices, [{ invoice_id: "INV1", amount_applied: 250.5 }]);
  assert.equal("account_id" in body, false);
});

test("buildCustomerPaymentBody: an explicit date wins over today", () => {
  const body = buildCustomerPaymentBody({ ...BASE, date: "2026-07-19" });
  assert.equal(body.date, "2026-07-19");
});

test("buildCustomerPaymentBody: accountId, when given, is sent as account_id", () => {
  const body = buildCustomerPaymentBody({ ...BASE, accountId: "BANK1" });
  assert.equal(body.account_id, "BANK1");
});

test("buildCustomerPaymentBody: referenceNumberOverride replaces the bank reference", () => {
  const body = buildCustomerPaymentBody({ ...BASE, referenceNumberOverride: "Batch 42" });
  assert.equal(body.reference_number, "Batch 42");
});

test("buildCustomerPaymentBody: COD gateway gets Cash on Delivery", () => {
  const body = buildCustomerPaymentBody({ ...BASE, gateway: "COD" });
  assert.equal(body.payment_mode, "Cash on Delivery");
});
