import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dropClobberRiskFields,
  isPaymentDowngrade,
  type ExistingOrderState,
} from "@/lib/orders-clobber-guard";
import type { OrderRow } from "@/lib/normalize/order";

/** The uid -> current-DB-state map the repository builds before upserting. */
function existing(entries: Record<string, ExistingOrderState>): Map<string, ExistingOrderState> {
  return new Map(Object.entries(entries));
}

function makeRow(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "KSA_1",
    tenant_id: "omnia",
    uid: "KSA_1",
    store_id: "KSA",
    order_id: "1",
    order_number: "1001",
    order_date: "2026-01-01T00:00:00Z",
    currency: "SAR",
    gross_original: 100,
    gross_aed: 98,
    subtotal_aed: 90,
    shipping_aed: 5,
    tax_aed: 3,
    discount_aed: 0,
    gateway: "COD",
    gateway_raw: "COD",
    telr_cartid: "",
    telr_tranref: "",
    financial_status: "paid",
    fulfillment_status: "unfulfilled",
    city: "Riyadh",
    country: "SA",
    customer_name: "Test Customer",
    customer_email: "test@example.com",
    customer_phone: "0500000000",
    customer_id: "email:test@example.com",
    source: "shopify",
    payout_status: "awaiting",
    updated_at: "2026-01-01T00:00:00Z",
    line_items: [],
    courier: "Aramex", // store's own raw shipping label
    tracking_number: "STORE-123",
    tracking_url: "https://track.example/STORE-123",
    ...overrides,
  };
}

test("dropClobberRiskFields: strips payout_status for every row regardless of shipped state", () => {
  const row = makeRow();
  const result = dropClobberRiskFields(row, existing({}));
  assert.ok(!("payout_status" in result));
});

test("dropClobberRiskFields: keeps courier/tracking when the order hasn't been shipped via our own pipeline", () => {
  const row = makeRow();
  const result = dropClobberRiskFields(row, existing({ KSA_1: { awb_number: null } }));
  assert.equal(result.courier, "Aramex");
  assert.equal(result.tracking_number, "STORE-123");
  assert.equal(result.tracking_url, "https://track.example/STORE-123");
});

test("dropClobberRiskFields: restores our own courier/tracking when awb_number already exists for this uid", () => {
  const row = makeRow({ uid: "KSA_2" });
  const result = dropClobberRiskFields(
    row,
    existing({
      KSA_2: {
        awb_number: "AWB-9",
        courier: "SMSA",
        tracking_number: "SMSA-777",
        tracking_url: "https://smsa.example/SMSA-777",
      },
    }),
  );
  assert.equal(result.courier, "SMSA", "the store's raw label must not replace the AWB we shipped on");
  assert.equal(result.tracking_number, "SMSA-777");
  assert.equal(result.tracking_url, "https://smsa.example/SMSA-777");
  // everything else still refreshes from the store
  assert.equal(result.order_number, "1001");
  assert.equal(result.gross_aed, 98);
});

test("dropClobberRiskFields: only affects the specific uid marked as shipped, not others in the same batch", () => {
  const shipped = makeRow({ uid: "KSA_3" });
  const notShipped = makeRow({ uid: "KSA_4" });
  const state = existing({
    KSA_3: { awb_number: "AWB-3", courier: "SMSA", tracking_number: "SMSA-3", tracking_url: "u3" },
    KSA_4: { awb_number: null },
  });

  assert.equal(dropClobberRiskFields(shipped, state).courier, "SMSA");
  assert.equal(dropClobberRiskFields(notShipped, state).courier, "Aramex");
});

// The whole reason this guard preserves values instead of omitting keys:
// Supabase sends the batch as one PostgREST request and unions the keys, so a
// key missing from one row is written as NULL for that row. A row whose key set
// differs from its siblings either nulls out real data or fails the batch on a
// NOT NULL column, which is exactly how 212 confirmed WA payments were lost.
test("dropClobberRiskFields: every row in a batch comes back with an identical key set", () => {
  const rows = [
    makeRow({ uid: "A" }),
    makeRow({ uid: "B" }),
    makeRow({ uid: "C", financial_status: "pending" }),
    makeRow({ uid: "D", financial_status: "pending" }),
  ];
  const state = existing({
    B: { awb_number: "AWB-B", courier: "SMSA", tracking_number: "t", tracking_url: "u" },
    C: { financial_status: "paid" },
    D: { awb_number: "AWB-D", courier: "SMSA", tracking_number: "t", tracking_url: "u", financial_status: "paid" },
  });

  const out = rows.map((r) => dropClobberRiskFields(r, state));
  const shape = Object.keys(out[0]).sort().join(",");
  for (const row of out) {
    assert.equal(Object.keys(row).sort().join(","), shape, "key sets must match across the batch");
  }
  assert.ok(!shape.includes("payout_status"));
  assert.ok(shape.includes("financial_status"));
});

// ---------------------------------------------------------------------------
// financial_status: a locally confirmed payment must survive the next re-sync.
//
// The WhatsApp store never marks its own orders paid — staff send a Stripe /
// Tabby / Tamara link and Shopify reports PENDING forever. This app's gateway
// confirmers (lib/sync/payment-confirm-core.ts) are the only thing that knows
// the money arrived, and they write financial_status = "paid". Before this
// guard, the 2-minute order sync upserted Shopify's stale "pending" straight
// back over it, so every confirmed WA order silently un-paid itself and
// vanished from Gross Sales.
// ---------------------------------------------------------------------------

test("isPaymentDowngrade: the store's not-yet-paid claims are all downgrades from a local paid", () => {
  for (const incoming of ["pending", "PENDING", "unpaid", "authorized", "partially_paid", "expired", ""]) {
    assert.equal(isPaymentDowngrade(incoming), true, `${incoming || "(empty)"} should be a downgrade`);
  }
});

test("isPaymentDowngrade: reversals and paid itself are NOT downgrades — the store is authoritative there", () => {
  for (const incoming of ["paid", "refunded", "partially_refunded", "voided", "cancelled"]) {
    assert.equal(isPaymentDowngrade(incoming), false, `${incoming} must be allowed through`);
  }
});

test("dropClobberRiskFields: keeps paid when the store downgrades a locally confirmed payment", () => {
  const row = makeRow({ uid: "WA_9", store_id: "WA", financial_status: "pending" });
  const result = dropClobberRiskFields(row, existing({ WA_9: { financial_status: "paid" } }));
  assert.equal(
    result.financial_status,
    "paid",
    "a confirmed-paid order must not be reset to the store's pending",
  );
  // the rest of the refresh still lands
  assert.equal(result.order_number, "1001");
  assert.equal(result.gross_aed, 98);
});

test("dropClobberRiskFields: lets a refund through even for a locally confirmed payment", () => {
  const row = makeRow({ uid: "WA_10", store_id: "WA", financial_status: "refunded" });
  const result = dropClobberRiskFields(row, existing({ WA_10: { financial_status: "paid" } }));
  assert.equal(result.financial_status, "refunded", "a real reversal must still reach the database");
});

test("dropClobberRiskFields: a void on a locally confirmed payment still lands", () => {
  const row = makeRow({ uid: "WA_13", store_id: "WA", financial_status: "voided" });
  const result = dropClobberRiskFields(row, existing({ WA_13: { financial_status: "paid" } }));
  assert.equal(result.financial_status, "voided");
});

test("dropClobberRiskFields: an order we never confirmed keeps the store's pending", () => {
  const row = makeRow({ uid: "WA_11", store_id: "WA", financial_status: "pending" });
  const result = dropClobberRiskFields(row, existing({ WA_11: { financial_status: "pending" } }));
  assert.equal(result.financial_status, "pending");
});

test("dropClobberRiskFields: a brand new order the database has never seen passes straight through", () => {
  const row = makeRow({ uid: "WA_NEW", store_id: "WA", financial_status: "pending" });
  const result = dropClobberRiskFields(row, existing({}));
  assert.equal(result.financial_status, "pending");
  assert.equal(result.courier, "Aramex");
});

test("dropClobberRiskFields: the payment guard and the shipping guard compose", () => {
  const row = makeRow({ uid: "WA_12", store_id: "WA", financial_status: "pending" });
  const result = dropClobberRiskFields(
    row,
    existing({
      WA_12: {
        awb_number: "AWB-12",
        courier: "SMSA",
        tracking_number: "SMSA-12",
        tracking_url: "https://smsa.example/12",
        financial_status: "paid",
      },
    }),
  );
  assert.equal(result.courier, "SMSA");
  assert.equal(result.financial_status, "paid");
  assert.equal(result.order_number, "1001");
});
