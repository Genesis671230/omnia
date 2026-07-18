import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeShopifyOrder } from "@/lib/normalize/order";
import type { ShopifyRawOrder } from "@/lib/integrations/shopify";

// Real-world shape: customer.phone is null (marketing profile, opt-in only),
// checkout collected no shipping phone, but the customer's default address —
// and often the billing address — carries the number the store actually has.
function rawOrder(overrides: Partial<ShopifyRawOrder>): ShopifyRawOrder {
  return {
    id: "gid://shopify/Order/6818557984926",
    name: "#3347",
    createdAt: "2026-07-18T10:00:00Z",
    email: "m@example.com",
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    paymentGatewayNames: ["stripe"],
    customer: { displayName: "mohammad alshamsi", phone: null, defaultAddress: null },
    shippingAddress: { city: "الشارقة", countryCodeV2: "AE", phone: null },
    billingAddress: null,
    currentTotalPriceSet: { shopMoney: { amount: "199.00", currencyCode: "AED" } },
    currentSubtotalPriceSet: { shopMoney: { amount: "199.00" } },
    totalShippingPriceSet: { shopMoney: { amount: "0" } },
    currentTotalTaxSet: { shopMoney: { amount: "0" } },
    currentTotalDiscountsSet: { shopMoney: { amount: "0" } },
    fulfillments: [],
    lineItems: { nodes: [] },
    ...overrides,
  };
}

test("phone falls back to billingAddress.phone when shipping + profile are empty", () => {
  const row = normalizeShopifyOrder(
    rawOrder({ billingAddress: { phone: "0501112222" } }),
    "UAE",
  );
  assert.equal(row.customer_phone, "0501112222");
});

test("phone falls back to customer.defaultAddress.phone as the last resort", () => {
  const row = normalizeShopifyOrder(
    rawOrder({
      customer: { displayName: "mohammad alshamsi", phone: null, defaultAddress: { phone: "0523337092" } },
    }),
    "UAE",
  );
  assert.equal(row.customer_phone, "0523337092");
});

test("shippingAddress.phone still wins when present", () => {
  const row = normalizeShopifyOrder(
    rawOrder({
      shippingAddress: { city: "Dubai", countryCodeV2: "AE", phone: "0559998888" },
      billingAddress: { phone: "0501112222" },
      customer: { displayName: "x", phone: "0500000000", defaultAddress: { phone: "0523337092" } },
    }),
    "UAE",
  );
  assert.equal(row.customer_phone, "0559998888");
});

test("all sources empty yields empty string, not undefined", () => {
  const row = normalizeShopifyOrder(rawOrder({}), "UAE");
  assert.equal(row.customer_phone, "");
});
