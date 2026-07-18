import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeShopifyOrder } from "@/lib/normalize/order";
import type { ShopifyRawOrder } from "@/lib/integrations/shopify";

function rawOrder(overrides: Partial<ShopifyRawOrder> = {}): ShopifyRawOrder {
  return {
    id: "gid://shopify/Order/1",
    name: "#1001",
    createdAt: "2026-07-01T00:00:00Z",
    email: "buyer@example.com",
    displayFinancialStatus: "paid",
    displayFulfillmentStatus: "unfulfilled",
    paymentGatewayNames: ["stripe"],
    customer: { displayName: "Jane Doe", phone: null },
    shippingAddress: { city: "Dubai", countryCodeV2: "AE", phone: null },
    currentTotalPriceSet: { shopMoney: { amount: "100.00", currencyCode: "AED" } },
    currentSubtotalPriceSet: { shopMoney: { amount: "100.00" } },
    totalShippingPriceSet: { shopMoney: { amount: "0" } },
    currentTotalTaxSet: { shopMoney: { amount: "0" } },
    currentTotalDiscountsSet: { shopMoney: { amount: "0" } },
    fulfillments: [],
    lineItems: { nodes: [] },
    ...overrides,
  };
}

test("normalizeShopifyOrder: prefers shippingAddress.phone (checkout) over customer.phone (marketing profile)", () => {
  const raw = rawOrder({
    customer: { displayName: "Jane Doe", phone: "+971500000001" },
    shippingAddress: { city: "Dubai", countryCodeV2: "AE", phone: "+971500000002" },
  });
  const order = normalizeShopifyOrder(raw, "UAE");
  assert.equal(order.customer_phone, "+971500000002");
});

test("normalizeShopifyOrder: falls back to customer.phone when shippingAddress has none", () => {
  const raw = rawOrder({
    customer: { displayName: "Jane Doe", phone: "+971500000001" },
    shippingAddress: { city: "Dubai", countryCodeV2: "AE", phone: null },
  });
  const order = normalizeShopifyOrder(raw, "UAE");
  assert.equal(order.customer_phone, "+971500000001");
});

test("normalizeShopifyOrder: empty string when neither source has a phone", () => {
  const raw = rawOrder({
    customer: { displayName: "Jane Doe", phone: null },
    shippingAddress: { city: "Dubai", countryCodeV2: "AE", phone: null },
  });
  const order = normalizeShopifyOrder(raw, "UAE");
  assert.equal(order.customer_phone, "");
});
