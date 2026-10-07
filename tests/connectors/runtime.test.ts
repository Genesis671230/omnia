import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { memoryConnectionStore, type ConnectionStore } from "@/lib/connectors/store";
import * as rt from "@/lib/connectors/runtime";
import { registerConnector } from "@/lib/connectors/registry";
import { GrantRevokedError, ReauthRequiredError } from "@/lib/connectors/types";

process.env.CONNECTIONS_KEY = randomBytes(32).toString("base64");

let refreshCalls = 0;
let ccCalls = 0;
let refreshMode: "ok" | "revoked" | "rotate" | "transient" = "ok";
let refs: string[] = [];
let testResult: { ok: boolean; accountName?: string; error?: string; missingScopes?: string[] } = { ok: true, accountName: "Fake shop" };
const alerts: string[] = [];
const secrets = z.object({
  client_id: z.string().optional(), client_secret: z.string().optional(), refresh_token: z.string().optional(),
  access_token: z.string().optional(), access_token_expires_at: z.number().optional(), grant_id: z.string().optional(),
});

registerConnector({
  provider: "fake", label: "Fake", category: "store",
  authModes: ["platform", "own_app", "token"],
  grantTypes: { platform: ["authorization_code"], own_app: ["authorization_code", "client_credentials", "static_refresh"], token: ["static_token"] },
  configSchema: z.object({ n: z.number().default(1) }),
  secretsSchema: secrets,
  configFields: [],
  oauth: {
    authorizeUrl: () => "https://fake/auth",
    exchangeCode: async () => ({ accessToken: "a0", raw: {} }),
    refresh: async () => {
      refreshCalls++;
      await new Promise((r) => setTimeout(r, 20));
      if (refreshMode === "revoked") throw new GrantRevokedError("invalid_grant");
      if (refreshMode === "transient") throw new Error("HTTP 503");
      return { accessToken: `a${refreshCalls}`, expiresAt: Date.now() + 3600_000, refreshToken: refreshMode === "rotate" ? "r2" : undefined, raw: {} };
    },
    clientCredentials: async () => { ccCalls++; return { accessToken: `cc${ccCalls}`, expiresAt: Date.now() + 86_399_000, raw: {} }; },
  },
  accountsFromGrant: async () => [],
  test: async () => testResult,
  references: async () => refs,
});

let store: ConnectionStore;
beforeEach(() => {
  store = memoryConnectionStore();
  rt.setConnectionStore(store);
  rt.setAlertSink(async (t) => { alerts.push(t); });
  rt._resetRuntimeCaches();
  refreshCalls = 0; ccCalls = 0; refreshMode = "ok"; refs = []; alerts.length = 0;
  testResult = { ok: true, accountName: "Fake shop" };
});

const save = (over: Partial<rt.SaveInput> = {}) => rt.saveConnection({
  provider: "fake", authMode: "own_app", grantType: "authorization_code", accountRef: "acct-1", label: "One",
  config: {}, secrets: { client_id: "c", client_secret: "s", refresh_token: "r1", access_token: "old", access_token_expires_at: Date.now() - 1000 },
  connectedBy: "test", ...over,
});

test("saveConnection: encrypts secrets, applies config defaults, keeps id on re-save of the same account", async () => {
  const PLAIN = "refresh-token-PLAINTEXT-must-not-appear";
  const a = await save({ id: "fake-one", secrets: { client_id: "c", client_secret: "s", refresh_token: PLAIN } });
  assert.equal(a.config.n, 1);
  const raw = (await store.get("omnia", "fake-one"))!;
  assert.match(raw.secrets_enc, /^v1:[^:]+:[^:]+:[^:]+$/);
  assert.ok(!raw.secrets_enc.includes(PLAIN) && !raw.secrets_enc.includes(Buffer.from(PLAIN).toString("base64")), "secrets must not be stored in plain text");
  await save({ id: "fake-one", secrets: { client_id: "c", client_secret: "s", refresh_token: "r1" } });
  const b = await save({ label: "Renamed" });
  assert.equal(b.id, "fake-one");
  assert.equal(b.label, "Renamed");
  assert.equal(b.secrets.refresh_token, "r1");
  assert.ok(b.secrets.grant_id, "grant fingerprint is derived from the refresh token");
});

test("saveConnection: generated ids are unique and readable", async () => {
  const a = await save({ accountRef: "Omnia UAE.myshopify.com" });
  assert.equal(a.id, "fake-omnia-uae-myshopify-com");
  await store.insert({ ...(await store.get("omnia", a.id))!, id: "fake-other", account_ref: "other" });
  const b = await save({ accountRef: "omnia-uae-myshopify-com" });
  assert.notEqual(b.id, a.id);
});

test("saveConnection rejects an auth mode the connector doesn't support and invalid config", async () => {
  await assert.rejects(save({ authMode: "nope" as any }), /does not support/);
  await assert.rejects(save({ config: { n: "x" } as any }));
});

test("10 concurrent calls with an expired token → one refresh, persisted, reused after restart", async () => {
  const c = await save();
  const tokens = await Promise.all(Array.from({ length: 10 }, () => rt.getAccessToken(c.id)));
  assert.equal(refreshCalls, 1);
  assert.ok(tokens.every((t) => t === "a1"));
  rt._resetRuntimeCaches();
  assert.equal(await rt.getAccessToken(c.id), "a1");
  assert.equal(refreshCalls, 1);
});

test("a fresh stored token is used without refreshing", async () => {
  const c = await save({ secrets: { client_id: "c", client_secret: "s", refresh_token: "r1", access_token: "still-good", access_token_expires_at: Date.now() + 600_000 } });
  assert.equal(await rt.getAccessToken(c), "still-good");
  assert.equal(refreshCalls, 0);
});

test("a token inside the 60 s margin is refreshed", async () => {
  const c = await save({ secrets: { client_id: "c", client_secret: "s", refresh_token: "r1", access_token: "nearly", access_token_expires_at: Date.now() + 30_000 } });
  assert.equal(await rt.getAccessToken(c.id), "a1");
});

test("rotated refresh token is persisted on the row and on siblings sharing the grant", async () => {
  refreshMode = "rotate";
  const a = await save({ accountRef: "org-1" });
  const b = await save({ accountRef: "org-2" });
  const other = await save({ accountRef: "org-3", secrets: { client_id: "c", client_secret: "s", refresh_token: "different" } });
  await rt.getAccessToken(a.id);
  assert.equal((await rt.getConnection(a.id))!.secrets.refresh_token, "r2");
  assert.equal((await rt.getConnection(b.id))!.secrets.refresh_token, "r2");
  assert.equal((await rt.getConnection(b.id))!.secrets.grant_id, (await rt.getConnection(a.id))!.secrets.grant_id);
  assert.equal((await rt.getConnection(other.id))!.secrets.refresh_token, "different");
});

test("revoked grant → needs_reauth, ReauthRequiredError, one alert, no repeated refresh", async () => {
  refreshMode = "revoked";
  const c = await save();
  await assert.rejects(rt.getAccessToken(c.id), ReauthRequiredError);
  await assert.rejects(rt.getAccessToken(c.id), ReauthRequiredError);
  const after = (await rt.getConnection(c.id))!;
  assert.equal(after.status, "needs_reauth");
  assert.match(after.lastError, /invalid_grant/);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /One/);
  assert.equal(refreshCalls, 1);
});

test("a transient provider error is NOT treated as revoked", async () => {
  refreshMode = "transient";
  const c = await save();
  await assert.rejects(rt.getAccessToken(c.id), (e: any) => !(e instanceof ReauthRequiredError) && /503/.test(e.message));
  const after = (await rt.getConnection(c.id))!;
  assert.equal(after.status, "active");
  assert.match(after.lastError, /503/);
  assert.equal(alerts.length, 0);
});

test("reconnecting (re-save) clears needs_reauth", async () => {
  refreshMode = "revoked";
  const c = await save();
  await assert.rejects(rt.getAccessToken(c.id));
  refreshMode = "ok";
  await save({ secrets: { client_id: "c", client_secret: "s", refresh_token: "new" } });
  assert.equal((await rt.getConnection(c.id))!.status, "active");
  assert.equal(await rt.getAccessToken(c.id), "a2"); // second refresh (the first was the revoked one)
  assert.equal(refreshCalls, 2);
});

test("static token mode returns the stored token; missing token → reauth", async () => {
  const c = await save({ authMode: "token", grantType: "static_token", accountRef: "t", secrets: { access_token: "shpat_x" } });
  assert.equal(await rt.getAccessToken(c.id), "shpat_x");
  assert.equal(refreshCalls, 0);
  const empty = await save({ authMode: "token", grantType: "static_token", accountRef: "t2", secrets: {} });
  await assert.rejects(rt.getAccessToken(empty.id), ReauthRequiredError);
});

test("client credentials: minted on first use, re-minted once expired", async () => {
  const c = await save({ grantType: "client_credentials", secrets: { client_id: "c", client_secret: "s" } });
  assert.equal(await rt.getAccessToken(c.id), "cc1");
  assert.equal(await rt.getAccessToken(c.id), "cc1");
  assert.equal(ccCalls, 1);
  await rt.updateConnection(c.id, { secrets: { access_token_expires_at: Date.now() - 1 } }, "t");
  assert.equal(await rt.getAccessToken(c.id), "cc2");
});

test("disabled connection refuses to hand out tokens", async () => {
  const c = await save();
  await rt.updateConnection(c.id, { status: "disabled" }, "t");
  await assert.rejects(rt.getAccessToken(c.id), /disabled/);
  assert.equal((await rt.listConnections("fake")).length, 0);
  assert.equal((await rt.listConnections("fake", { includeDisabled: true })).length, 1);
});

test("listPublicConnections never exposes secrets", async () => {
  await save({ secrets: { client_id: "cid-XYZ", client_secret: "secret-XYZ", refresh_token: "refresh-XYZ", access_token: "access-XYZ" } });
  const [p] = await rt.listPublicConnections();
  assert.equal((p as any).secrets, undefined);
  assert.equal(p.hasSecrets, true);
  assert.equal(p.category, "store");
  assert.equal(p.providerLabel, "Fake");
  for (const s of ["cid-XYZ", "secret-XYZ", "refresh-XYZ", "access-XYZ"]) assert.ok(!JSON.stringify(p).includes(s), `leaked ${s}`);
});

test("invalid stored config or undecryptable secrets surface as status error, not a throw", async () => {
  const base = { tenant_id: "omnia", provider: "fake", auth_mode: "token", grant_type: "static_token", scopes: "", status: "active", last_checked_at: null, last_synced_at: null, last_error: "", connected_by: "", created_at: "", updated_at: "" };
  await store.insert({ ...base, id: "bad-config", account_ref: "b1", label: "B1", config: { n: "x" } as any, secrets_enc: "" });
  await store.insert({ ...base, id: "bad-secret", account_ref: "b2", label: "B2", config: {}, secrets_enc: "v1:garbage:x:y" });
  const list = await rt.listConnections("fake");
  const bc = list.find((c) => c.id === "bad-config")!;
  const bs = list.find((c) => c.id === "bad-secret")!;
  assert.equal(bc.status, "error");
  assert.match(bc.parseError!, /config: n/);
  assert.equal(bs.status, "error");
  assert.match(bs.parseError!, /secrets/);
});

test("testConnection records ok, failures and missing scopes", async () => {
  const c = await save({ secrets: { client_id: "c", client_secret: "s", refresh_token: "r1", access_token: "t", access_token_expires_at: Date.now() + 600_000 } });
  testResult = { ok: true, accountName: "Shop", missingScopes: ["read_reports"] };
  assert.equal((await rt.testConnection(c.id)).ok, true);
  let after = (await rt.getConnection(c.id))!;
  assert.equal(after.status, "active");
  assert.match(after.lastError, /read_reports/);
  assert.ok(after.lastCheckedAt);
  testResult = { ok: false, error: "403 forbidden" };
  await rt.testConnection(c.id);
  after = (await rt.getConnection(c.id))!;
  assert.equal(after.status, "error");
  assert.equal(after.lastError, "403 forbidden");
});

test("removeConnection is blocked while other records reference it", async () => {
  const c = await save();
  refs = ["3 payouts"];
  assert.deepEqual(await rt.removeConnection(c.id, "t"), { blocked: ["3 payouts"] });
  assert.ok(await rt.getConnection(c.id));
  refs = [];
  assert.deepEqual(await rt.removeConnection(c.id, "t"), { removed: true });
  assert.equal(await rt.getConnection(c.id), null);
});

test("resolveApp: platform reads PLATFORM_<PROVIDER>_*; own app reads the row's secrets", () => {
  delete process.env.PLATFORM_FAKE_CLIENT_ID;
  assert.equal(rt.resolveApp({ provider: "fake", authMode: "platform", secrets: {} }), null);
  process.env.PLATFORM_FAKE_CLIENT_ID = "pid";
  process.env.PLATFORM_FAKE_CLIENT_SECRET = "psec";
  assert.deepEqual(rt.resolveApp({ provider: "fake", authMode: "platform", secrets: { client_id: "ignored" } }), { clientId: "pid", clientSecret: "psec" });
  assert.deepEqual(rt.resolveApp({ provider: "fake", authMode: "own_app", secrets: { client_id: "c", client_secret: "s" } }), { clientId: "c", clientSecret: "s" });
  assert.equal(rt.resolveApp({ provider: "fake", authMode: "own_app", secrets: { client_id: "c" } }), null);
});

test("markSynced and setConnectionError update the row", async () => {
  const c = await save();
  await rt.markSynced(c.id);
  assert.ok((await rt.getConnection(c.id))!.lastSyncedAt);
  await rt.setConnectionError(c.id, "Setup step failed: boom");
  const after = (await rt.getConnection(c.id))!;
  assert.equal(after.status, "error");
  assert.equal(after.lastError, "Setup step failed: boom");
  assert.equal(rt.isLiveStore(), false);
});

test("unknown connection id is an error, not a silent null token", async () => {
  await assert.rejects(rt.getAccessToken("nope"), /not found/);
});
