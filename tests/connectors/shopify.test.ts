import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { shopifyConnector, SHOPIFY_SCOPES } from "@/lib/connectors/shopify";
import { GrantRevokedError, OAuthFlowError } from "@/lib/connectors/types";
import { getConnector } from "@/lib/connectors/registry";

const realFetch = globalThis.fetch;
const calls: { url: string; body: string; headers?: any }[] = [];
const mock = (fn: (url: string, body: string) => { status?: number; body: unknown }) => {
  globalThis.fetch = (async (url: any, init?: any) => {
    const b = init?.body?.toString() ?? "";
    calls.push({ url: String(url), body: b, headers: init?.headers });
    const r = fn(String(url), b);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
};
afterEach(() => { globalThis.fetch = realFetch; calls.length = 0; });
const app = { clientId: "client-id-XYZ", clientSecret: "client-secret-XYZ" };
const params = { shop: "omnia-uae.myshopify.com", store_id: "UAE" };
const cfg = (over: Record<string, unknown> = {}) => shopifyConnector.configSchema.parse({ store_id: "UAE", shop: "omnia-uae.myshopify.com", ...over });
const sign = (q: URLSearchParams, secret = app.clientSecret) => {
  const msg = [...q.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
  q.set("hmac", createHmac("sha256", secret).update(msg).digest("hex"));
  return q;
};

test("registers as shopify with all three auth modes", () => {
  assert.equal(getConnector("shopify"), shopifyConnector);
  assert.deepEqual(shopifyConnector.authModes, ["platform", "own_app", "token"]);
  assert.deepEqual(shopifyConnector.grantTypes.own_app, ["authorization_code", "client_credentials"]);
});

test("config: store code and shop domain are validated", () => {
  assert.throws(() => shopifyConnector.configSchema.parse({ store_id: "uae", shop: "omnia-uae.myshopify.com" }));
  assert.throws(() => shopifyConnector.configSchema.parse({ store_id: "UAE", shop: "evil.com" }));
  assert.deepEqual(cfg().webhook_topics, ["ORDERS_CREATE", "ORDERS_PAID", "INVENTORY_LEVELS_UPDATE"]);
});

test("authorize URL targets the shop admin with the required scopes, no secret", () => {
  const u = new URL(shopifyConnector.oauth!.authorizeUrl({ state: "s", redirectUri: "https://app/cb", app, params }));
  assert.equal(u.origin + u.pathname, "https://omnia-uae.myshopify.com/admin/oauth/authorize");
  assert.equal(u.searchParams.get("scope"), SHOPIFY_SCOPES.join(","));
  assert.equal(u.searchParams.get("client_id"), "client-id-XYZ");
  assert.equal(u.searchParams.get("state"), "s");
  assert.ok(!u.toString().includes("client-secret-XYZ"));
  assert.equal(u.searchParams.get("grant_options[]"), null, "no per-user token: we need an offline token");
});

test("authorize URL refuses a non-myshopify shop", () => {
  for (const shop of ["evil.com", "x.myshopify.com.evil.com", ""]) {
    assert.throws(() => shopifyConnector.oauth!.authorizeUrl({ state: "s", redirectUri: "r", app, params: { shop, store_id: "X" } }), (e: any) => e instanceof OAuthFlowError && e.code === "bad_host", shop);
  }
});

test("verifyCallback: valid HMAC passes; other shop, tampering and wrong secret fail", () => {
  const q = sign(new URLSearchParams({ code: "c", shop: "omnia-uae.myshopify.com", state: "s", timestamp: "1" }));
  assert.doesNotThrow(() => shopifyConnector.verifyCallback!(q, app, params));
  assert.throws(() => shopifyConnector.verifyCallback!(q, app, { ...params, shop: "other.myshopify.com" }), (e: any) => e.code === "bad_host");
  const other = sign(new URLSearchParams({ code: "c", shop: "other.myshopify.com", state: "s", timestamp: "1" }));
  assert.throws(() => shopifyConnector.verifyCallback!(other, app, params), (e: any) => e.code === "bad_host");
  const tampered = new URLSearchParams(q); tampered.set("code", "tampered");
  assert.throws(() => shopifyConnector.verifyCallback!(tampered, app, params), (e: any) => e.code === "bad_hmac");
  const wrong = sign(new URLSearchParams({ code: "c", shop: "omnia-uae.myshopify.com", state: "s", timestamp: "1" }), "attacker");
  assert.throws(() => shopifyConnector.verifyCallback!(wrong, app, params), (e: any) => e.code === "bad_hmac");
});

test("exchangeCode → non-expiring offline token", async () => {
  mock(() => ({ body: { access_token: "shpua_x", scope: "read_orders,read_products" } }));
  const g = await shopifyConnector.oauth!.exchangeCode({ code: "c0de", redirectUri: "r", app, query: new URLSearchParams(), params });
  assert.equal(calls[0].url, "https://omnia-uae.myshopify.com/admin/oauth/access_token");
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get("code"), "c0de");
  assert.equal(body.get("client_secret"), "client-secret-XYZ");
  assert.equal(g.accessToken, "shpua_x");
  assert.equal(g.expiresAt, undefined);
  assert.equal(g.scopes, "read_orders,read_products");
});

test("exchangeCode with a bad code is exchange_failed, not 'revoked'", async () => {
  mock(() => ({ status: 400, body: { error: "invalid_request", error_description: "The authorization code was not found or was already used" } }));
  await assert.rejects(
    shopifyConnector.oauth!.exchangeCode({ code: "c", redirectUri: "r", app, query: new URLSearchParams(), params }),
    (e: any) => e instanceof OAuthFlowError && e.code === "exchange_failed",
  );
});

test("client credentials → 24 h token for the configured shop", async () => {
  mock(() => ({ body: { access_token: "cc-token", scope: "read_orders", expires_in: 86399 } }));
  const g = await shopifyConnector.oauth!.clientCredentials!(app, cfg(), {});
  assert.equal(calls[0].url, "https://omnia-uae.myshopify.com/admin/oauth/access_token");
  assert.equal(new URLSearchParams(calls[0].body).get("grant_type"), "client_credentials");
  assert.ok(g.expiresAt! > Date.now() + 86_000_000 && g.expiresAt! < Date.now() + 86_400_000);
});

test("client credentials at connect time read the shop from params (no config yet)", async () => {
  mock(() => ({ body: { access_token: "cc", expires_in: 86399 } }));
  await shopifyConnector.oauth!.clientCredentials!(app, null as any, params);
  assert.equal(calls[0].url, "https://omnia-uae.myshopify.com/admin/oauth/access_token");
});

test("refresh of a client-credentials connection re-mints; an app removed from the store → revoked", async () => {
  mock(() => ({ body: { access_token: "again", expires_in: 86399 } }));
  assert.equal((await shopifyConnector.oauth!.refresh({}, cfg(), app)).accessToken, "again");
  mock(() => ({ status: 401, body: { error: "invalid_client" } }));
  await assert.rejects(shopifyConnector.oauth!.refresh({}, cfg(), app), GrantRevokedError);
});

const SHOP_DATA = { shop: { name: "Omnia UAE", currencyCode: "AED", ianaTimezone: "Asia/Dubai", myshopifyDomain: "omnia-uae.myshopify.com" }, currentAppInstallation: { accessScopes: [{ handle: "read_orders" }, { handle: "write_inventory" }] } };

test("accountsFromGrant: one account for the shop, config filled from the shop", async () => {
  mock(() => ({ body: { data: SHOP_DATA } }));
  const [a] = await shopifyConnector.accountsFromGrant({ accessToken: "tok", raw: {} }, app, params);
  assert.equal(a.accountRef, "omnia-uae.myshopify.com");
  assert.equal(a.label, "Omnia UAE");
  assert.deepEqual(a.config, { store_id: "UAE", shop: "omnia-uae.myshopify.com", shop_name: "Omnia UAE", currency: "AED", timezone: "Asia/Dubai" });
  assert.equal(a.scopes, "read_orders,write_inventory");
  assert.equal(calls[0].headers["X-Shopify-Access-Token"], "tok");
  assert.match(calls[0].url, /^https:\/\/omnia-uae\.myshopify\.com\/admin\/api\/\d{4}-\d{2}\/graphql\.json$/);
});

test("test() reports missing scopes by name; write_X covers read_X", async () => {
  mock(() => ({ body: { data: SHOP_DATA } }));
  const r = await shopifyConnector.test({ accountRef: "omnia-uae.myshopify.com", config: cfg() } as any, "tok");
  assert.equal(r.ok, true);
  assert.equal(r.accountName, "Omnia UAE");
  assert.ok(r.missingScopes!.includes("read_shopify_payments_payouts"));
  assert.ok(r.missingScopes!.includes("read_reports"));
  assert.ok(!r.missingScopes!.includes("read_inventory"), "write_inventory implies read_inventory");
  assert.ok(!r.missingScopes!.includes("read_orders"));
});

test("a 401 from the Admin API means the token is dead → GrantRevokedError", async () => {
  mock(() => ({ status: 401, body: { errors: "[API] Invalid API key or access token (unrecognized login or wrong password)" } }));
  await assert.rejects(shopifyConnector.test({ accountRef: "x", config: cfg() } as any, "tok"), GrantRevokedError);
});

test("GraphQL errors and 5xx are plain errors, not revocation", async () => {
  mock(() => ({ body: { errors: [{ message: "Field 'x' doesn't exist" }] } }));
  await assert.rejects(shopifyConnector.test({ accountRef: "x", config: cfg() } as any, "tok"), (e: any) => !(e instanceof GrantRevokedError) && /doesn't exist/.test(e.message));
  mock(() => ({ status: 502, body: {} }));
  await assert.rejects(shopifyConnector.test({ accountRef: "x", config: cfg() } as any, "tok"), (e: any) => !(e instanceof GrantRevokedError));
});

test("api_version override is used when set", async () => {
  mock(() => ({ body: { data: SHOP_DATA } }));
  await shopifyConnector.test({ accountRef: "x", config: cfg({ api_version: "2025-07" }) } as any, "tok");
  assert.match(calls[0].url, /\/admin\/api\/2025-07\/graphql\.json$/);
});

const RAW_ORDER = {
  id: "gid://shopify/Order/5551234", name: "#UAE1001", createdAt: "2026-10-06T21:30:00Z", email: "buyer@example.com",
  displayFinancialStatus: "paid", displayFulfillmentStatus: "unfulfilled", paymentGatewayNames: ["stripe"],
  customer: { displayName: "Jane Doe", phone: null }, shippingAddress: { city: "Dubai", countryCodeV2: "AE", phone: null },
  currentTotalPriceSet: { shopMoney: { amount: "199.00", currencyCode: "AED" } },
  currentSubtotalPriceSet: { shopMoney: { amount: "199.00" } }, totalShippingPriceSet: { shopMoney: { amount: "0" } },
  currentTotalTaxSet: { shopMoney: { amount: "0" } }, currentTotalDiscountsSet: { shopMoney: { amount: "0" } },
  fulfillments: [], lineItems: { nodes: [] },
};

test("listOrders: reads `nodes`, normalises with the store code, caps at 50, filters by updated_at", async () => {
  mock(() => ({ body: { data: { orders: { pageInfo: { hasNextPage: true, endCursor: "x" }, nodes: [RAW_ORDER] } } } }));
  const rows = await shopifyConnector.listOrders!({ config: cfg() } as any, "tok", { limit: 500, since: "2026-10-01" });
  const vars = JSON.parse(calls[0].body).variables;
  assert.equal(vars.first, 50);
  assert.equal(vars.after, null);
  assert.equal(vars.query, "updated_at:>='2026-10-01'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].store_id, "UAE");
  assert.equal(rows[0].order_number, "UAE1001");
  assert.equal(rows[0].gross_original, 199);
  assert.equal(rows[0].currency, "AED");
});

test("listOrders without `since` sends no filter", async () => {
  mock(() => ({ body: { data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } }));
  assert.deepEqual(await shopifyConnector.listOrders!({ config: cfg() } as any, "tok", { limit: 10 }), []);
  assert.equal(JSON.parse(calls[0].body).variables.query, null);
  assert.equal(JSON.parse(calls[0].body).variables.first, 10);
});
