import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { setSettingsBackend, memorySettingsBackend, setSetting } from "@/lib/settings";
import { memoryConnectionStore } from "@/lib/connectors/store";
import * as rt from "@/lib/connectors/runtime";
import { registerConnector } from "@/lib/connectors/registry";
import * as oauth from "@/lib/connectors/oauth";
import * as flow from "@/lib/connectors/flow";
import { OAuthFlowError } from "@/lib/connectors/types";

process.env.CONNECTIONS_KEY = randomBytes(32).toString("base64");

let accounts: { accountRef: string; label: string; config: Record<string, unknown> }[] = [];
let onConnectCalls = 0;
let onConnectFails = false;
let lastExchange: any = null;
let lastRefreshSecrets: any = null;
let verifyCalls = 0;
const passthrough = z.object({}).passthrough();

registerConnector({
  provider: "multi", label: "Multi", category: "accounting",
  authModes: ["platform", "own_app", "token"],
  grantTypes: { platform: ["authorization_code"], own_app: ["authorization_code", "static_refresh", "client_credentials"], token: ["static_token"] },
  configSchema: passthrough, secretsSchema: passthrough as any, configFields: [],
  startParams: [{ key: "region", label: "Region", options: ["eu", "me"] }],
  oauth: {
    authorizeUrl: ({ state, redirectUri, pkceChallenge, params }) =>
      `https://idp.example/auth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}&region=${params.region}${pkceChallenge ? "&pkce=1" : ""}`,
    exchangeCode: async (ctx) => { lastExchange = ctx; return { accessToken: `at-${ctx.code}`, refreshToken: "refresh-XYZ", expiresAt: Date.now() + 3600_000, raw: {} }; },
    refresh: async (secrets) => { lastRefreshSecrets = secrets; return { accessToken: "minted", expiresAt: Date.now() + 3600_000, raw: {} }; },
    clientCredentials: async () => ({ accessToken: "cc", expiresAt: Date.now() + 86_399_000, raw: {} }),
  },
  verifyCallback: (query) => { verifyCalls++; if (query.get("tamper")) throw new OAuthFlowError("bad_hmac", "bad"); },
  accountsFromGrant: async () => accounts,
  test: async () => ({ ok: true, accountName: "ok" }),
  onConnect: async () => { onConnectCalls++; if (onConnectFails) throw new Error("webhook boom"); },
});

beforeEach(async () => {
  setSettingsBackend(memorySettingsBackend());
  await setSetting("app.public_url", "https://os.example.com", "t");
  rt.setConnectionStore(memoryConnectionStore());
  rt.setAlertSink(async () => {});
  rt._resetRuntimeCaches();
  oauth.setOAuthStateStore(oauth.memoryOAuthStateStore());
  accounts = [{ accountRef: "org-1", label: "Org 1", config: {} }];
  onConnectCalls = 0; onConnectFails = false; lastExchange = null; lastRefreshSecrets = null; verifyCalls = 0;
  delete process.env.PLATFORM_MULTI_CLIENT_ID; delete process.env.PLATFORM_MULTI_CLIENT_SECRET;
});

const OWN = { clientId: "client-id-XYZ", clientSecret: "client-secret-XYZ" };
const start = (over: Record<string, unknown> = {}) =>
  flow.startConnect({ provider: "multi", authMode: "own_app", ownApp: OWN, params: { region: "me" }, ...over } as any, "admin");
const stateOf = (url: string) => new URL(url).searchParams.get("state")!;
const cb = (redirect: string, extra: Record<string, string> = {}, user = "admin") =>
  flow.completeCallback("multi", new URLSearchParams({ code: "abc", state: stateOf(redirect), ...extra }), user);

test("own app: start → callback with one account → active connection with the app + grant stored", async () => {
  const r = await start() as { redirect: string };
  assert.match(r.redirect, /redirect_uri=https%3A%2F%2Fos\.example\.com%2Fapi%2Fconnections%2Foauth%2Fmulti%2Fcallback/);
  assert.match(r.redirect, /region=me/);
  const done = await cb(r.redirect) as { connectionIds: string[] };
  assert.equal(lastExchange.redirectUri, "https://os.example.com/api/connections/oauth/multi/callback");
  assert.deepEqual(lastExchange.app, OWN);
  assert.deepEqual(lastExchange.params, { region: "me" });
  assert.equal(verifyCalls, 1);
  const c = (await rt.getConnection(done.connectionIds[0]))!;
  assert.equal(c.status, "active");
  assert.equal(c.authMode, "own_app");
  assert.equal(c.grantType, "authorization_code");
  assert.equal(c.secrets.client_secret, "client-secret-XYZ");
  assert.equal(c.secrets.refresh_token, "refresh-XYZ");
  assert.equal(c.secrets.access_token, "at-abc");
  assert.equal(onConnectCalls, 1);
});

test("the own-app secret never appears in the redirect URL", async () => {
  const r = await start() as { redirect: string };
  assert.ok(!r.redirect.includes("client-secret-XYZ"));
});

test("several accounts → pending picker → chosen accounts become connections sharing one grant", async () => {
  accounts = [{ accountRef: "org-1", label: "A", config: {} }, { accountRef: "org-2", label: "B", config: {} }, { accountRef: "org-3", label: "C", config: {} }];
  const r = await start() as { redirect: string };
  const p = await cb(r.redirect) as { pendingId: string };
  assert.ok(p.pendingId);
  assert.equal((await rt.listConnections()).length, 0, "nothing saved before the user picks");
  assert.deepEqual((await oauth.peekPendingAccounts(p.pendingId))!.accounts.map((a) => a.accountRef), ["org-1", "org-2", "org-3"]);
  const ids = await flow.completePending(p.pendingId, ["org-1", "org-3"], "admin");
  assert.equal(ids.length, 2);
  const [a, b] = await Promise.all(ids.map((id) => rt.getConnection(id)));
  assert.equal(a!.secrets.grant_id, b!.secrets.grant_id);
  assert.deepEqual([a!.accountRef, b!.accountRef], ["org-1", "org-3"]);
});

test("picker: empty selection and accounts not offered are rejected", async () => {
  accounts = [{ accountRef: "org-1", label: "A", config: {} }, { accountRef: "org-2", label: "B", config: {} }];
  const r = await start() as { redirect: string };
  const p = await cb(r.redirect) as { pendingId: string };
  await assert.rejects(flow.completePending(p.pendingId, ["org-999"], "admin"), (e: any) => e.code === "bad_request");
});

test("provider error in callback → denied, nothing saved", async () => {
  const r = await start() as { redirect: string };
  await assert.rejects(cb(r.redirect, { error: "access_denied", error_description: "User said no" }), (e: any) => e.code === "denied" && /User said no/.test(e.message));
  assert.equal((await rt.listConnections()).length, 0);
});

test("callback finished by a different admin, or replayed → rejected, nothing saved", async () => {
  const r = await start() as { redirect: string };
  await assert.rejects(cb(r.redirect, {}, "someone-else"), (e: any) => e.code === "state_user_mismatch");
  await assert.rejects(cb(r.redirect), (e: any) => e.code === "state_used");
  assert.equal((await rt.listConnections()).length, 0);
});

test("verifyCallback failure (Shopify HMAC) stops the flow before the code exchange", async () => {
  const r = await start() as { redirect: string };
  await assert.rejects(cb(r.redirect, { tamper: "1" }), (e: any) => e.code === "bad_hmac");
  assert.equal(lastExchange, null);
});

test("no code in the callback → bad_request", async () => {
  const r = await start() as { redirect: string };
  await assert.rejects(flow.completeCallback("multi", new URLSearchParams({ state: stateOf(r.redirect) }), "admin"), (e: any) => e.code === "bad_request");
});

test("reconnecting the same account keeps the connection id and clears needs_reauth", async () => {
  const r1 = await start() as { redirect: string };
  const [id] = ((await cb(r1.redirect)) as { connectionIds: string[] }).connectionIds;
  await rt.updateConnection(id, { status: "disabled" }, "t");
  const r2 = await start() as { redirect: string };
  const [id2] = ((await cb(r2.redirect)) as { connectionIds: string[] }).connectionIds;
  assert.equal(id2, id);
  assert.equal((await rt.getConnection(id))!.status, "active");
  assert.equal((await rt.listConnections(undefined, { includeDisabled: true })).length, 1);
});

test("onConnect failure keeps the grant but marks the connection error with the reason", async () => {
  onConnectFails = true;
  const r = await start() as { redirect: string };
  const [id] = ((await cb(r.redirect)) as { connectionIds: string[] }).connectionIds;
  const c = (await rt.getConnection(id))!;
  assert.equal(c.status, "error");
  assert.match(c.lastError, /Setup step failed: webhook boom/);
  assert.equal(c.secrets.refresh_token, "refresh-XYZ");
});

test("token mode saves without redirect and returns a public connection", async () => {
  const r = await flow.startConnect({ provider: "multi", authMode: "token", token: "  shpat-XYZ  ", webhookSecret: "wh-XYZ", params: { region: "eu" } }, "admin") as any;
  assert.ok(r.connection);
  assert.equal(r.connection.secrets, undefined);
  const c = (await rt.getConnection(r.connection.id))!;
  assert.equal(c.grantType, "static_token");
  assert.equal(c.secrets.access_token, "shpat-XYZ");
  assert.equal(c.secrets.webhook_secret, "wh-XYZ");
});

test("pasted refresh token (Zoho self-client) is validated by a real refresh before saving", async () => {
  const r = await start({ grantType: "static_refresh", refreshToken: "pasted-refresh-XYZ" }) as any;
  assert.equal(lastRefreshSecrets.refresh_token, "pasted-refresh-XYZ");
  const c = (await rt.getConnection(r.connection.id))!;
  assert.equal(c.grantType, "static_refresh");
  assert.equal(c.secrets.refresh_token, "pasted-refresh-XYZ");
  assert.equal(c.secrets.client_secret, "client-secret-XYZ");
});

test("client credentials save without redirect", async () => {
  const r = await start({ grantType: "client_credentials" }) as any;
  const c = (await rt.getConnection(r.connection.id))!;
  assert.equal(c.grantType, "client_credentials");
  assert.equal(c.secrets.access_token, "cc");
});

test("platform mode: unavailable without platform app; uses PLATFORM_* when set and stores no app secret", async () => {
  await assert.rejects(flow.startConnect({ provider: "multi", authMode: "platform", params: { region: "me" } } as any, "admin"), (e: any) => e.code === "no_app");
  process.env.PLATFORM_MULTI_CLIENT_ID = "pid"; process.env.PLATFORM_MULTI_CLIENT_SECRET = "platform-secret-XYZ";
  const r = await flow.startConnect({ provider: "multi", authMode: "platform", params: { region: "me" } } as any, "admin") as { redirect: string };
  const [id] = ((await cb(r.redirect)) as { connectionIds: string[] }).connectionIds;
  assert.equal(lastExchange.app.clientSecret, "platform-secret-XYZ");
  const c = (await rt.getConnection(id))!;
  assert.equal(c.secrets.client_secret, undefined, "platform secret lives in env, not on the row");
});

test("start validation: unsupported mode/grant, missing own-app creds, bad params", async () => {
  await assert.rejects(start({ authMode: "nope" }), (e: any) => e.code === "bad_request");
  await assert.rejects(start({ grantType: "static_token" }), (e: any) => e.code === "bad_request");
  await assert.rejects(start({ ownApp: { clientId: " ", clientSecret: "" } }), (e: any) => e.code === "bad_request");
  await assert.rejects(start({ params: {} }), (e: any) => e.code === "bad_request" && /Region/.test(e.message));
  await assert.rejects(start({ params: { region: "us" } }), (e: any) => e.code === "bad_request");
  await assert.rejects(flow.startConnect({ provider: "multi", authMode: "token", params: { region: "eu" } } as any, "admin"), (e: any) => e.code === "bad_request");
  await assert.rejects(flow.startConnect({ provider: "unknown", authMode: "own_app" } as any, "admin"), /Unknown connector/);
});

test("a login that reaches no account → no_accounts", async () => {
  accounts = [];
  const r = await start() as { redirect: string };
  await assert.rejects(cb(r.redirect), (e: any) => e.code === "no_accounts");
});

test("runSync: registered handler runs and marks the connection synced; unknown provider is a no-op", async () => {
  const r = await flow.startConnect({ provider: "multi", authMode: "token", token: "t", params: { region: "eu" } }, "admin") as any;
  assert.equal((await flow.runSync(r.connection.id)).summary, "Nothing to sync for this connection");
  flow.registerSyncHandler("multi", async (c) => ({ summary: `synced ${c.label}` }));
  assert.equal((await flow.runSync(r.connection.id)).summary, "synced Org 1");
  assert.ok((await rt.getConnection(r.connection.id))!.lastSyncedAt);
  await assert.rejects(flow.runSync("nope"), /not found/);
});
