import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRowFromHeaders, tabForOrder, computePaidCellUpdates, findHeaderRowIndex, SMSA_TAB, LOCAL_TAB } from "@/lib/integrations/dispatch-sheet";
import type { OrderRow } from "@/lib/normalize/order";

function makeOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "KSA_1", tenant_id: "omnia", uid: "KSA_1", store_id: "KSA", order_id: "1",
    order_number: "1001", order_date: "2026-08-07T08:00:00Z",
    currency: "SAR", gross_original: 375, gross_aed: 367.5,
    subtotal_aed: 0, shipping_aed: 0, tax_aed: 0, discount_aed: 0,
    gateway: "COD", gateway_raw: "Cash on Delivery (COD)",
    telr_cartid: "", telr_tranref: "",
    shipping_address1: "123 Main St", shipping_address2: "Apt 4", shipping_state: "", shipping_postcode: "", shipping_company: "",
    billing_address1: "", billing_address2: "", billing_state: "", billing_postcode: "", billing_company: "",
    financial_status: "pending", fulfillment_status: "unfulfilled",
    city: "Riyadh", country: "SA",
    customer_name: "Jane Doe", customer_email: "jane@example.com", customer_phone: "0501234567",
    customer_id: "email:jane@example.com", source: "shopify", payout_status: "awaiting",
    updated_at: "2026-08-07T00:00:00Z",
    line_items: [{ title: "Rose Oud 100ml", sku: "OUD-100", qty: 2, total_aed: 100, image_url: "", stock: 5 }],
    courier: "", tracking_number: "", tracking_url: "",
    ...overrides,
  };
}

test("tabForOrder: UAE country routes to Local orders", () => {
  assert.equal(tabForOrder(makeOrder({ country: "AE" })), LOCAL_TAB);
});

test("tabForOrder: any non-AE country routes to SMSA Orders", () => {
  assert.equal(tabForOrder(makeOrder({ country: "SA" })), SMSA_TAB);
});

test("buildRowFromHeaders (SMSA): maps the real SMSA Orders columns by exact header name", () => {
  const headers = ["x", "S.No", "Date", "Order #", "Total Amt", "Currency", "In AED", "Party", "Part", "Status / Comments", "Payment Authorised - Status"];
  const row = buildRowFromHeaders(SMSA_TAB, headers, makeOrder());
  assert.deepEqual(row, [
    "", "", "2026-08-07 12:00", "1001", "375.00", "SAR", "367.50", "Jane Doe", "",
    "Gateway: COD — needs payment confirmation — Sinan",
    "", // Payment Authorised - Status is Sinan's manual field — never filled by us
  ]);
});

test("buildRowFromHeaders (SMSA): never writes into Sinan/Finance-owned columns", () => {
  const headers = ["Payment Authorised - Status", "Actual Payment Status", "Fee Deducted", "Balance Received ", "sales person"];
  const row = buildRowFromHeaders(SMSA_TAB, headers, makeOrder());
  assert.deepEqual(row, ["", "", "", "", ""]);
});

test("buildRowFromHeaders (Local orders): maps Customer (not Party) and contact", () => {
  const headers = ["Date", "Order #", "Total", "Party", "Customer", "contact", " Comments", "Payment Status"];
  const row = buildRowFromHeaders(LOCAL_TAB, headers, makeOrder({ country: "AE", customer_phone: "0501234567" }));
  assert.deepEqual(row, [
    "2026-08-07 12:00", "1001", "375.00",
    "", // Party left blank — ambiguous vs Customer, not guessed
    "Jane Doe", "0501234567",
    "Gateway: COD — needs payment confirmation — Sinan",
    "", // Payment Status is Sinan's manual field
  ]);
});

test("buildRowFromHeaders (Local orders): does not touch the finance-recalculated 'Total Amt' column", () => {
  const headers = ["Total", "Total Amt", "Fee Deducted", "Amount After Deduction"];
  const row = buildRowFromHeaders(LOCAL_TAB, headers, makeOrder());
  assert.deepEqual(row, ["375.00", "", "", ""]);
});

test("buildRowFromHeaders: date cell carries full Dubai-local date+time, not just a bare date", () => {
  const headers = ["Date"];
  // 08:00 UTC -> 12:00 Dubai (UTC+4)
  const row = buildRowFromHeaders(SMSA_TAB, headers, makeOrder({ order_date: "2026-08-07T08:00:00Z" }));
  assert.deepEqual(row, ["2026-08-07 12:00"]);
});

test("buildRowFromHeaders: reordered headers still land in the right cells", () => {
  const headers = ["Order #", "Date"];
  const row = buildRowFromHeaders(SMSA_TAB, headers, makeOrder());
  assert.deepEqual(row, ["1001", "2026-08-07 12:00"]);
});

const SMSA_HEADERS = ["x", "S.No", "Date", "Order #", "Total Amt", "Currency", "In AED", "Party", "Part", "Exc Rate", "", "Status / Comments", "Payment Authorised - Status", "Actual Payment Status", "Payment Received Date"];
const LOCAL_HEADERS = ["Date", "Order #", "Total", "Party", "Customer", "contact", " Comments", "Payment Status", "Delivery By", "COD to Other Payment", "Actual Payment Status", "Payment Received on"];

test("computePaidCellUpdates (SMSA): finds the row by order number and targets Actual Payment Status + Payment Received Date", () => {
  const rows = [SMSA_HEADERS, ["", "1", "2026-08-07 12:00", "1001", "375.00", "SAR", "367.50", "Jane Doe"]];
  const result = computePaidCellUpdates(SMSA_TAB, SMSA_HEADERS, rows, "1001", "2026-08-07T09:00:00Z", "Stripe");
  assert.notEqual(result, null);
  assert.notEqual(result, "not-in-sheet");
  assert.deepEqual((result as { updates: unknown }).updates, [
    { row: 2, col: 13, value: "Paid - Stripe" }, // 0-indexed col 13 = "Actual Payment Status"
    { row: 2, col: 14, value: "2026-08-07 13:00" }, // "Payment Received Date", 09:00 UTC -> 13:00 Dubai
  ]);
});

test("computePaidCellUpdates: status cell names the confirming gateway (Telr here, not Stripe)", () => {
  const rows = [SMSA_HEADERS, ["", "1", "2026-08-07 12:00", "1001", "375.00", "SAR", "367.50", "Jane Doe"]];
  const result = computePaidCellUpdates(SMSA_TAB, SMSA_HEADERS, rows, "1001", "2026-08-07T09:00:00Z", "Telr");
  assert.equal((result as { updates: { value: string }[] }).updates[0].value, "Paid - Telr");
});

test("computePaidCellUpdates (Local orders): uses 'Payment Received on', not 'Payment Received Date'", () => {
  const rows = [LOCAL_HEADERS, ["2026-08-07 12:00", "1001", "375.00", "", "Jane Doe", "0501234567"]];
  const result = computePaidCellUpdates(LOCAL_TAB, LOCAL_HEADERS, rows, "1001", "2026-08-07T09:00:00Z", "Stripe");
  assert.deepEqual((result as { updates: unknown }).updates, [
    { row: 2, col: 10, value: "Paid - Stripe" },
    { row: 2, col: 11, value: "2026-08-07 13:00" },
  ]);
});

test("computePaidCellUpdates: order not found in the sheet returns 'not-in-sheet', writes nothing", () => {
  const rows = [SMSA_HEADERS, ["", "1", "2026-08-07 12:00", "9999"]];
  const result = computePaidCellUpdates(SMSA_TAB, SMSA_HEADERS, rows, "1001", "2026-08-07T09:00:00Z", "Stripe");
  assert.equal(result, "not-in-sheet");
});

test("computePaidCellUpdates: tab has neither payment column returns null, writes nothing", () => {
  const headers = ["Date", "Order #", "Total"];
  const rows = [headers, ["2026-08-07 12:00", "1001", "375.00"]];
  const result = computePaidCellUpdates(SMSA_TAB, headers, rows, "1001", "2026-08-07T09:00:00Z", "Stripe");
  assert.equal(result, null);
});

test("computePaidCellUpdates: never touches any column other than the two payment-confirmation ones", () => {
  const rows = [SMSA_HEADERS, ["x", "1", "date", "1001", "375.00", "SAR", "367.50", "Jane Doe", "part", "rate", "", "comment", "auth-status"]];
  const result = computePaidCellUpdates(SMSA_TAB, SMSA_HEADERS, rows, "1001", "2026-08-07T09:00:00Z", "Stripe");
  const cols = (result as { updates: { col: number }[] }).updates.map((u) => u.col);
  assert.deepEqual(cols.sort((a, b) => a - b), [13, 14]);
});

// Regression coverage for the live incident (2026-08-08): the shared sheet's
// header row kept getting relocated by a manual sort (row-level, so a row's
// own cells stay intact — only its position moves), repeatedly landing a
// real order's data in row-1 position. findHeaderRowIndex + threading
// headerRowIndex through computePaidCellUpdates makes both lookups work off
// wherever the header actually is, not a hardcoded row 0.

test("findHeaderRowIndex: finds the header at row 0 in the normal case", () => {
  const rows = [SMSA_HEADERS, ["", "1", "date", "1001"]];
  assert.equal(findHeaderRowIndex(rows), 0);
});

test("findHeaderRowIndex: finds the header after it's been relocated to row 3 by a sort", () => {
  const rows = [
    ["", "", "2026-08-08 18:11", "WA55381", "", "", "1710", "", "Yasmin Alamer"], // a real order's data, now sitting in row 0
    ["", "", "2026-08-06 21:17", "802541", "11294", "", "870"],
    ["", "", "2026-08-08 15:00", "802618"],
    SMSA_HEADERS, // the header, relocated to row 3
    ["", "1", "date", "1001"],
  ];
  assert.equal(findHeaderRowIndex(rows), 3);
});

test("findHeaderRowIndex: returns -1 when no row contains 'Order #' anywhere", () => {
  const rows = [["", "", "2026-08-08 18:11", "WA55381"], ["", "", "2026-08-06 21:17", "802541"]];
  assert.equal(findHeaderRowIndex(rows), -1);
});

test("computePaidCellUpdates: still finds and correctly updates the right order row when the header has been relocated (not at row 0)", () => {
  const rows = [
    ["", "", "2026-08-08 18:11", "1001", "375.00", "SAR", "367.50", "Jane Doe"], // order 1001's own row, now sitting at row 0
    SMSA_HEADERS, // header relocated to row 1
  ];
  const result = computePaidCellUpdates(SMSA_TAB, SMSA_HEADERS, rows, "1001", "2026-08-07T09:00:00Z", "Stripe", /* headerRowIndex */ 1);
  assert.deepEqual((result as { updates: { row: number; col: number; value: string }[] }).updates, [
    { row: 1, col: 13, value: "Paid - Stripe" }, // sheet row 1 (0-indexed rows[0] = sheet row 1) — NOT row 2, since the header isn't there
    { row: 1, col: 14, value: "2026-08-07 13:00" },
  ]);
});
