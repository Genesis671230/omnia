import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { gmailConnector, GMAIL_SCOPES } from "@/lib/connectors/gmail";
import { GrantRevokedError, OAuthFlowError } from "@/lib/connectors/types";
import { getConnector } from "@/lib/connectors/registry";

const realFetch = globalThis.fetch;
const calls: { url: string; body?: string; headers?: any }[] = [];
const mock = (status: number, body: unknown) => {
  globalThis.fetch = (async (url: any, init?: any) => {
    calls.push({ url: String(url), body: init?.body?.toString(), headers: init?.headers });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
};
afterEach(() => { globalThis.fetch = realFetch; calls.length = 0; });
const app = { clientId: "client-id-XYZ", clientSecret: "client-secret-XYZ" };
const idToken = (claims: object) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const cfg = gmailConnector.configSchema.parse({});

test("registers as gmail; config defaults are empty", () => {
  assert.equal(getConnector("gmail"), gmailConnector);
  assert.deepEqual(cfg, { ingest_queries: {}, labels: [] });
});

test("authorize URL: offline, consent, PKCE S256, read-only + identity scopes", () => {
  const u = new URL(gmailConnector.oauth!.authorizeUrl({ state: "s", redirectUri: "https://app/cb", app, pkceChallenge: "ch", params: {} }));
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("prompt"), "consent");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("code_challenge"), "ch");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("scope"), GMAIL_SCOPES);
  assert.equal(u.searchParams.get("state"), "s");
  assert.ok(!GMAIL_SCOPES.includes("gmail.modify") && !GMAIL_SCOPES.includes("mail.google.com"), "read-only");
});

test("authorize URL without PKCE omits the challenge params", () => {
  const u = new URL(gmailConnector.oauth!.authorizeUrl({ state: "s", redirectUri: "r", app, params: {} }));
  assert.equal(u.searchParams.get("code_challenge"), null);
});

test("exchangeCode sends the PKCE verifier; mailbox comes from the ID token, lower-cased", async () => {
  mock(200, { access_token: "at", refresh_token: "rt", expires_in: 3599, scope: GMAIL_SCOPES, id_token: idToken({ email: "Marketing@Omnia.com", email_verified: true }) });
  const g = await gmailConnector.oauth!.exchangeCode({ code: "c", redirectUri: "https://app/cb", app, pkceVerifier: "verifier-XYZ", query: new URLSearchParams(), params: {} });
  const body = new URLSearchParams(calls[0].body);
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(body.get("code_verifier"), "verifier-XYZ");
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(g.refreshToken, "rt");
  const [acct] = await gmailConnector.accountsFromGrant(g, app, {});
  assert.equal(acct.accountRef, "marketing@omnia.com");
  assert.equal(acct.label, "marketing@omnia.com");
});

test("an unverified email in the ID token is refused", async () => {
  await assert.rejects(
    gmailConnector.accountsFromGrant({ accessToken: "a", raw: { id_token: idToken({ email: "x@y.com", email_verified: false }) } }, app, {}),
    (e: any) => e instanceof OAuthFlowError && e.code === "no_accounts",
  );
});

test("missing ID token / email → no_accounts", async () => {
  await assert.rejects(gmailConnector.accountsFromGrant({ accessToken: "a", raw: {} }, app, {}), (e: any) => e.code === "no_accounts");
  await assert.rejects(gmailConnector.accountsFromGrant({ accessToken: "a", raw: { id_token: idToken({ sub: "1" }) } }, app, {}), (e: any) => e.code === "no_accounts");
  await assert.rejects(gmailConnector.accountsFromGrant({ accessToken: "a", raw: { id_token: "not-a-jwt" } }, app, {}), (e: any) => e.code === "no_accounts");
});

test("exchangeCode without a refresh token explains how to fix it", async () => {
  mock(200, { access_token: "at", expires_in: 3599, id_token: idToken({ email: "a@b.com", email_verified: true }) });
  await assert.rejects(
    gmailConnector.oauth!.exchangeCode({ code: "c", redirectUri: "r", app, query: new URLSearchParams(), params: {} }),
    (e: any) => e.code === "exchange_failed" && /myaccount\.google\.com\/permissions/.test(e.message),
  );
});

test("refresh: invalid_grant → GrantRevokedError (covers 7-day Testing-mode expiry)", async () => {
  mock(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
  await assert.rejects(gmailConnector.oauth!.refresh({ refresh_token: "r" }, cfg, app), (e: any) => e instanceof GrantRevokedError && /expired or revoked/.test(e.message));
});

test("refresh: deleted OAuth client → GrantRevokedError", async () => {
  mock(401, { error: "invalid_client", error_description: "The OAuth client was not found." });
  await assert.rejects(gmailConnector.oauth!.refresh({ refresh_token: "r" }, cfg, app), GrantRevokedError);
});

test("refresh: server error is transient", async () => {
  mock(503, { error: "backendError" });
  await assert.rejects(gmailConnector.oauth!.refresh({ refresh_token: "r" }, cfg, app), (e: any) => !(e instanceof GrantRevokedError));
});

test("refresh: success returns an expiring grant without rotating the refresh token", async () => {
  mock(200, { access_token: "fresh", expires_in: 3599, scope: GMAIL_SCOPES });
  const g = await gmailConnector.oauth!.refresh({ refresh_token: "r" }, cfg, app);
  assert.equal(g.accessToken, "fresh");
  assert.equal(g.refreshToken, undefined);
  assert.ok(g.expiresAt! > Date.now() + 3500_000);
});

test("test(): ok for the right mailbox (case-insensitive), error for another", async () => {
  mock(200, { emailAddress: "Marketing@Omnia.com", messagesTotal: 10 });
  assert.deepEqual(await gmailConnector.test({ accountRef: "marketing@omnia.com" } as any, "tok"), { ok: true, accountName: "marketing@omnia.com" });
  assert.equal(calls[0].url, "https://gmail.googleapis.com/gmail/v1/users/me/profile");
  assert.equal(calls[0].headers.Authorization, "Bearer tok");
  mock(200, { emailAddress: "other@x.com" });
  const r = await gmailConnector.test({ accountRef: "a@x.com" } as any, "tok");
  assert.equal(r.ok, false);
  assert.match(r.error!, /other@x\.com/);
  mock(403, { error: { message: "Gmail API has not been used in project 123" } });
  assert.match((await gmailConnector.test({ accountRef: "a@x.com" } as any, "tok")).error!, /Gmail API has not been used/);
});

test("onDisconnect revokes the refresh token at Google", async () => {
  mock(200, {});
  await gmailConnector.onDisconnect!({ secrets: { refresh_token: "refresh-XYZ" }, config: cfg } as any, "tok");
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/revoke");
  assert.equal(new URLSearchParams(calls[0].body).get("token"), "refresh-XYZ");
});

test("removing a mailbox is never blocked by ingest history", async () => {
  assert.deepEqual(await gmailConnector.references!({ id: "gmail-a" } as any), []);
});
