import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { zohoConnector, zohoRefresh, ZOHO_SCOPE } from "@/lib/connectors/zoho";
import { GrantRevokedError, OAuthFlowError } from "@/lib/connectors/types";
import { getConnector } from "@/lib/connectors/registry";

const realFetch = globalThis.fetch;
const calls: { url: string; body?: string; headers?: any }[] = [];
function mockFetch(handler: (url: string) => { status?: number; body: unknown }) {
  globalThis.fetch = (async (url: any, init?: any) => {
    calls.push({ url: String(url), body: init?.body ? String(init.body) : undefined, headers: init?.headers });
    const r = handler(String(url));
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
}
afterEach(() => { globalThis.fetch = realFetch; calls.length = 0; });
const app = { clientId: "client-id-XYZ", clientSecret: "client-secret-XYZ" };
const cfg = (over: Record<string, unknown> = {}) => zohoConnector.configSchema.parse(over);

test("registers itself as the zoho provider", () => {
  assert.equal(getConnector("zoho"), zohoConnector);
  assert.deepEqual(zohoConnector.authModes, ["platform", "own_app"]);
});

test("config defaults match today's behaviour", () => {
  assert.deepEqual(cfg(), {
    accounts_url: "https://accounts.zoho.com", api_domain: "https://www.zohoapis.com", org_name: "",
    daily_budget: 4500, default_for_providers: [], login_email: "",
  });
});

test("authorize URL: chosen data centre, offline, consent, Books scope", () => {
  const u = new URL(zohoConnector.oauth!.authorizeUrl({ state: "st", redirectUri: "https://app/cb", app, params: { dc: "https://accounts.zoho.sa" } }));
  assert.equal(u.origin + u.pathname, "https://accounts.zoho.sa/oauth/v2/auth");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("prompt"), "consent");
  assert.equal(u.searchParams.get("scope"), ZOHO_SCOPE);
  assert.equal(u.searchParams.get("client_id"), "client-id-XYZ");
  assert.equal(u.searchParams.get("redirect_uri"), "https://app/cb");
  assert.equal(u.searchParams.get("state"), "st");
  assert.equal(u.searchParams.get("client_secret"), null);
});

test("authorize URL ignores a non-Zoho data centre and falls back to .com", () => {
  const u = new URL(zohoConnector.oauth!.authorizeUrl({ state: "s", redirectUri: "r", app, params: { dc: "https://evil.io" } }));
  assert.equal(u.origin, "https://accounts.zoho.com");
});

test("exchangeCode posts to the callback's accounts-server and keeps api_domain", async () => {
  mockFetch(() => ({ body: { access_token: "at", refresh_token: "rt", expires_in: 3600, api_domain: "https://www.zohoapis.sa", scope: ZOHO_SCOPE } }));
  const before = Date.now();
  const g = await zohoConnector.oauth!.exchangeCode({ code: "c0de", redirectUri: "https://app/cb", app, query: new URLSearchParams({ "accounts-server": "https://accounts.zoho.sa" }), params: {} });
  assert.equal(calls[0].url, "https://accounts.zoho.sa/oauth/v2/token");
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "c0de");
  assert.equal(body.get("redirect_uri"), "https://app/cb");
  assert.equal(g.refreshToken, "rt");
  assert.equal(g.raw.api_domain, "https://www.zohoapis.sa");
  assert.equal(g.raw.accounts_url, "https://accounts.zoho.sa");
  assert.ok(g.expiresAt! >= before + 3600_000 - 1000);
});

test("exchangeCode refuses a forged accounts-server before sending the secret", async () => {
  mockFetch(() => ({ body: {} }));
  for (const host of ["https://accounts.zoho.com.evil.io", "https://evil.io", "http://accounts.zoho.com"]) {
    await assert.rejects(
      zohoConnector.oauth!.exchangeCode({ code: "c", redirectUri: "x", app, query: new URLSearchParams({ "accounts-server": host }), params: {} }),
      (e: any) => e instanceof OAuthFlowError && e.code === "bad_host",
      host,
    );
  }
  assert.equal(calls.length, 0);
});

test("exchangeCode without a refresh token explains how to fix it", async () => {
  mockFetch(() => ({ body: { access_token: "at", expires_in: 3600 } }));
  await assert.rejects(
    zohoConnector.oauth!.exchangeCode({ code: "c", redirectUri: "x", app, query: new URLSearchParams(), params: {} }),
    (e: any) => e.code === "exchange_failed" && /Connected Apps/.test(e.message),
  );
});

test("exchangeCode with a rejected code is exchange_failed", async () => {
  mockFetch(() => ({ body: { error: "invalid_code" } }));
  await assert.rejects(
    zohoConnector.oauth!.exchangeCode({ code: "c", redirectUri: "x", app, query: new URLSearchParams(), params: {} }),
    (e: any) => e.code === "exchange_failed",
  );
});

test("accountsFromGrant: one account per organisation, with DC config", async () => {
  mockFetch(() => ({ body: { code: 0, organizations: [{ organization_id: 799179049, name: "House of Omnia", currency_code: "AED" }, { organization_id: "1", name: "Omniastores", currency_code: "AED" }] } }));
  const accts = await zohoConnector.accountsFromGrant({ accessToken: "at", scopes: ZOHO_SCOPE, raw: { api_domain: "https://www.zohoapis.sa", accounts_url: "https://accounts.zoho.sa" } }, app, {});
  assert.deepEqual(accts.map((a) => a.accountRef), ["799179049", "1"]);
  assert.deepEqual(accts[0].config, { accounts_url: "https://accounts.zoho.sa", api_domain: "https://www.zohoapis.sa", org_name: "House of Omnia" });
  assert.equal(calls[0].url, "https://www.zohoapis.sa/books/v3/organizations");
  assert.equal(calls[0].headers.Authorization, "Zoho-oauthtoken at");
});

test("accountsFromGrant: an API error is no_accounts, not an empty list", async () => {
  mockFetch(() => ({ status: 401, body: { code: 57, message: "You are not authorized to perform this operation" } }));
  await assert.rejects(zohoConnector.accountsFromGrant({ accessToken: "x", raw: {} }, app, {}), (e: any) => e.code === "no_accounts");
});

test("refresh: revoked-grant errors → GrantRevokedError", async () => {
  for (const error of ["invalid_code", "invalid_client", "invalid_client_secret", "unauthorized_client", "invalid_grant"]) {
    mockFetch(() => ({ status: 400, body: { error } }));
    await assert.rejects(zohoRefresh({ refresh_token: "r" }, cfg(), app), GrantRevokedError, error);
  }
});

test("refresh: rate limit and server errors are NOT treated as revoked", async () => {
  mockFetch(() => ({ status: 400, body: { error_description: "You have made too many requests continuously. Please try again after some time.", error: "Access Denied", status: "failure" } }));
  await assert.rejects(zohoRefresh({ refresh_token: "r" }, cfg(), app), (e: any) => !(e instanceof GrantRevokedError) && /too many requests/.test(e.message));
  mockFetch(() => ({ status: 500, body: {} }));
  await assert.rejects(zohoRefresh({ refresh_token: "r" }, cfg(), app), (e: any) => !(e instanceof GrantRevokedError));
});

test("refresh: posts to the connection's own data centre and returns a grant", async () => {
  mockFetch(() => ({ body: { access_token: "fresh", expires_in: 3600, api_domain: "https://www.zohoapis.sa" } }));
  const g = await zohoRefresh({ refresh_token: "r" }, cfg({ accounts_url: "https://accounts.zoho.sa" }), app);
  assert.equal(calls[0].url, "https://accounts.zoho.sa/oauth/v2/token");
  assert.equal(new URLSearchParams(calls[0].body).get("grant_type"), "refresh_token");
  assert.equal(g.accessToken, "fresh");
  assert.equal(g.refreshToken, undefined); // Zoho does not rotate refresh tokens
});

test("refresh: a tampered stored accounts_url never receives the secret", async () => {
  mockFetch(() => ({ body: {} }));
  await assert.rejects(zohoRefresh({ refresh_token: "r" }, { ...cfg(), accounts_url: "https://evil.io" }, app), (e: any) => e.code === "bad_host");
  assert.equal(calls.length, 0);
});

test("test(): reads the org from the connection's own API domain", async () => {
  mockFetch(() => ({ body: { code: 0, organization: { name: "House of Omnia" } } }));
  const r = await zohoConnector.test({ accountRef: "799179049", config: cfg({ api_domain: "https://www.zohoapis.sa" }) } as any, "tok");
  assert.deepEqual(r, { ok: true, accountName: "House of Omnia" });
  assert.equal(calls[0].url, "https://www.zohoapis.sa/books/v3/organizations/799179049");
  mockFetch(() => ({ status: 404, body: { code: 6041, message: "Organization not found" } }));
  assert.deepEqual(await zohoConnector.test({ accountRef: "1", config: cfg() } as any, "tok"), { ok: false, error: "Organization not found" });
});

test("references: the default org also owns rows stored with '' (pre-multi-org)", async () => {
  const seen: string[] = [];
  globalThis.fetch = (async (url: any) => {
    seen.push(decodeURIComponent(String(url)));
    return new Response("[]", { status: 200, headers: { "content-range": "0-0/2" } });
  }) as typeof fetch;
  process.env.SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-key";
  const def = await zohoConnector.references!({ id: "env" } as any);
  assert.ok(seen.every((u) => u.includes('zoho_connection_id=in.(env,"")') || u.includes("zoho_connection_id=in.(env,)")), seen[0]);
  assert.equal(def.length, 5);
  seen.length = 0;
  await zohoConnector.references!({ id: "house-of-omnia" } as any);
  assert.ok(seen.every((u) => u.includes("zoho_connection_id=in.(house-of-omnia)")), seen[0]);
});
