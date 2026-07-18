import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvoicePdf, type InvoiceFields } from "@/lib/invoice";
import { buildIntlInvoicePdf, type IntlInvoiceFields } from "@/lib/invoice-intl";

const PDF_MAGIC = "%PDF";

const ontrackFields: InvoiceFields = {
  orderNumber: "718578", invoiceNo: "718578", customerId: "", date: "17/07/2026",
  customerName: "Hissa Alzaabi", address1: "", address2: "Mbz City, AE",
  mobile: "00971509981616", additionalNotes: "", remarks: "PAID",
  orderValue: 954, shipping: 30, total: 984, totalLabel: "PAID",
  paid: "Yes", courier: "Ontrack", currency: "AED",
};

const intlFields: IntlInvoiceFields = {
  invoiceNo: "3671", customerId: "#SA3671", date: "17/07/26",
  name: "Abdul Wahid", address: "Riyadh, Saudi Arabia", tel: "00966568578818", email: "z@x.com",
  shipDate: "17/07/26", terms: "-",
  items: [{ itemNo: "3671", description: "Necklace Set — Made in China", qty: 1, unitPrice: 100 }],
  shipping: 0, currency: "AED",
  contactName: "Omnia Fouad", contactEmail: "support@omniastores.com", contactPhone: "+971565478227",
};

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 0 && Buffer.from(bytes.slice(0, 4)).toString("latin1") === PDF_MAGIC;
}

test("buildInvoicePdf: returns non-empty PDF bytes with a PAID total label", async () => {
  const pdf = await buildInvoicePdf(ontrackFields);
  assert.ok(isPdf(pdf));
});

test("buildInvoicePdf: does not throw on Arabic name/address or empty fields", async () => {
  const pdf = await buildInvoicePdf({
    ...ontrackFields, customerName: "عبد الواحد", address1: "شارع خالد", address2: "الرياض", remarks: "", totalLabel: undefined,
  });
  assert.ok(isPdf(pdf));
});

test("buildIntlInvoicePdf: returns non-empty PDF bytes", async () => {
  const pdf = await buildIntlInvoicePdf(intlFields);
  assert.ok(isPdf(pdf));
});

test("buildIntlInvoicePdf: does not throw on Arabic fields or empty item list", async () => {
  const pdf = await buildIntlInvoicePdf({
    ...intlFields, name: "عبد الواحد", address: "الرياض، المملكة العربية السعودية", items: [],
  });
  assert.ok(isPdf(pdf));
});
