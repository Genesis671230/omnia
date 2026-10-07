import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import * as o from "@/lib/connectors/oauth";
import { OAuthFlowError } from "@/lib/connectors/types";
import { setSettingsBackend, memorySettingsBackend, setSetting } from "@/lib/settings";

process.env.CONNECTIONS_KEY = randomBytes(32).toString("base64");

let mem: ReturnType<typeof o.memoryOAuthStateStore>;
beforeEach(() => {
  mem = o.memoryOAuthStateStore();
  o.setOAuthStateStore(mem);
  setSettingsBackend(memorySettingsBackend());
});

const APP = { clientId: "client-id-XYZ", clientSecret: "client-secret-XYZ" };
const base = { provider: "gmail", authMode: "own_app" as const, pendingApp: APP, params: { dc: "x" }, createdBy: "admin" };
const code = (e: unknown) => (e as OAuthFlowError).code;

test("state is long, random and single-use; own-app credentials are stored encrypted", async () => {
  const a = await o.createState(base);
  const b = await o.createState(base);
  assert.notEqual(a.state, b.state);
  assert.ok(a.state.length >= 40);
  const raw = mem._peek(a.state)!;
  assert.ok(!raw.pending_app_enc.includes("client-secret-XYZ"));
  const rec = await o.consumeState(a.state, "gmail", "admin");
  assert.deepEqual(rec.pendingApp, APP);
  assert.deepEqual(rec.params, { dc: "x" });
  await assert.rejects(o.consumeState(a.state, "gmail", "admin"), (e) => e instanceof OAuthFlowError && code(e) === "state_used");
});

test("missing, unknown, wrong-provider, wrong-user and other-tenant states are rejected", async () => {
  await assert.rejects(o.consumeState("", "gmail", "admin"), (e) => code(e) === "state_invalid");
  await assert.rejects(o.consumeState("nope", "gmail", "admin"), (e) => code(e) === "state_invalid");
  const a = await o.createState(base);
  await assert.rejects(o.consumeState(a.state, "zoho", "admin"), (e) => code(e) === "provider_mismatch");
  const b = await o.createState(base);
  await assert.rejects(o.consumeState(b.state, "gmail", "someone-else"), (e) => code(e) === "state_user_mismatch");
  const c = await o.createState(base);
  const saved = process.env.DEFAULT_TENANT_ID;
  process.env.DEFAULT_TENANT_ID = "acme";
  try {
    await assert.rejects(o.consumeState(c.state, "gmail", "admin"), (e) => code(e) === "state_invalid");
  } finally {
    if (saved === undefined) delete process.env.DEFAULT_TENANT_ID; else process.env.DEFAULT_TENANT_ID = saved;
  }
});

test("a rejected attempt still burns the state (no retry with a different user)", async () => {
  const a = await o.createState(base);
  await assert.rejects(o.consumeState(a.state, "gmail", "attacker"));
  await assert.rejects(o.consumeState(a.state, "gmail", "admin"), (e) => code(e) === "state_used");
});

test("expired state is rejected; TTL is 10 minutes", async () => {
  const { state } = await o.createState(base);
  const ttl = new Date(mem._peek(state)!.expires_at).getTime() - Date.now();
  assert.ok(ttl > 9.9 * 60_000 && ttl <= 10 * 60_000);
  mem._expire(state);
  await assert.rejects(o.consumeState(state, "gmail", "admin"), (e) => code(e) === "state_expired");
});

test("PKCE: verifier is stored, challenge is base64url S256 of it; no PKCE → empty verifier", async () => {
  const { state, pkceChallenge } = await o.createState(base, { pkce: true });
  const rec = await o.consumeState(state, "gmail", "admin");
  assert.ok(rec.pkceVerifier.length >= 43 && rec.pkceVerifier.length <= 128);
  assert.equal(pkceChallenge, createHash("sha256").update(rec.pkceVerifier).digest("base64url"));
  const plain = await o.createState(base);
  assert.equal(plain.pkceChallenge, undefined);
  assert.equal((await o.consumeState(plain.state, "gmail", "admin")).pkceVerifier, "");
});

test("Shopify HMAC: Shopify's documented example verifies", () => {
  const q = new URLSearchParams("code=0907a61c0c8d55e99db179b68161bc00&hmac=700e2dadb827fcc8609e9d5ce208b2e9cdaab9df07390d2cbca10d7c328fc4bf&shop=some-shop.myshopify.com&state=0.6784241404160823&timestamp=1337178173");
  assert.equal(o.verifyShopifyHmac(q, "hush"), true);
});

test("Shopify HMAC: tampered param, wrong secret, missing or malformed hmac all fail", () => {
  const good = "code=0907a61c0c8d55e99db179b68161bc00&hmac=700e2dadb827fcc8609e9d5ce208b2e9cdaab9df07390d2cbca10d7c328fc4bf&shop=some-shop.myshopify.com&state=0.6784241404160823&timestamp=1337178173";
  const tampered = new URLSearchParams(good); tampered.set("shop", "evil.myshopify.com");
  assert.equal(o.verifyShopifyHmac(tampered, "hush"), false);
  assert.equal(o.verifyShopifyHmac(new URLSearchParams(good), "wrong"), false);
  const missing = new URLSearchParams(good); missing.delete("hmac");
  assert.equal(o.verifyShopifyHmac(missing, "hush"), false);
  const short = new URLSearchParams(good); short.set("hmac", "abc");
  assert.equal(o.verifyShopifyHmac(short, "hush"), false);
  const upper = new URLSearchParams(good); upper.set("hmac", upper.get("hmac")!.toUpperCase());
  assert.equal(o.verifyShopifyHmac(upper, "hush"), false);
});

test("shop domain validator", () => {
  for (const ok of ["omnia-store-main.myshopify.com", "a.myshopify.com", "x1-2.myshopify.com"]) assert.equal(o.isShopDomain(ok), true, ok);
  for (const bad of ["evil.com", "evil.com/x.myshopify.com", "x.myshopify.com.evil.com", "-x.myshopify.com", "X.MYSHOPIFY.COM", "x.myshopify.com:443", "https://x.myshopify.com", "", "x..myshopify.com"]) {
    assert.equal(o.isShopDomain(bad), false, bad);
  }
});

test("Zoho accounts host allowlist is exact (no suffix tricks)", () => {
  for (const ok of ["https://accounts.zoho.com", "https://accounts.zoho.sa", "https://accounts.zoho.eu/", "https://accounts.zoho.com.au"]) assert.equal(o.isZohoAccountsHost(ok), true, ok);
  for (const bad of ["https://accounts.zoho.com.evil.io", "http://accounts.zoho.com", "https://evil.io", "https://accounts.zoho.com@evil.io", "https://accounts.zoho.com/../x", ""]) {
    assert.equal(o.isZohoAccountsHost(bad), false, bad);
  }
});

test("pending grant: encrypted at rest, single-use, user-bound, 15-minute TTL", async () => {
  const id = await o.savePendingGrant({
    provider: "zoho", authMode: "own_app", grant: { accessToken: "access-XYZ", refreshToken: "refresh-XYZ", raw: {} }, app: APP,
    accounts: [{ accountRef: "1", label: "Org", config: {} }], params: { grant_type: "authorization_code" }, createdBy: "admin",
  });
  const raw = mem._peekPending(id)!;
  assert.ok(!raw.grant_enc.includes("refresh-XYZ") && !raw.grant_enc.includes("client-secret-XYZ"));
  const ttl = new Date(raw.expires_at).getTime() - Date.now();
  assert.ok(ttl > 14.9 * 60_000 && ttl <= 15 * 60_000);
  assert.deepEqual((await o.peekPendingAccounts(id))!.accounts.map((a) => a.accountRef), ["1"]);
  await assert.rejects(o.takePendingGrant(id, "other"), (e) => code(e) === "state_user_mismatch");
  const p = await o.takePendingGrant(id, "admin");
  assert.equal(p.grant.refreshToken, "refresh-XYZ");
  assert.deepEqual(p.app, APP);
  assert.equal(p.params.grant_type, "authorization_code");
  await assert.rejects(o.takePendingGrant(id, "admin"), (e) => code(e) === "state_invalid");
  assert.equal(await o.peekPendingAccounts(id), null);
});

test("redirectUri is built from app.public_url and tolerates a trailing slash", async () => {
  await setSetting("app.public_url", "https://os.example.com/", "t");
  assert.equal(await o.redirectUri("zoho"), "https://os.example.com/api/connections/oauth/zoho/callback");
});

test("purge drops only rows that expired over a day ago", async () => {
  const old = await o.createState(base);
  const recent = await o.createState(base);
  mem._peek(old.state)!.expires_at = new Date(Date.now() - 25 * 3600_000).toISOString();
  mem._peek(recent.state)!.expires_at = new Date(Date.now() - 3600_000).toISOString();
  const live = await o.createState(base);
  assert.equal(await o.purgeExpiredOAuthRows(), 1);
  assert.equal(mem._peek(old.state), undefined);
  assert.ok(mem._peek(recent.state));
  assert.ok(mem._peek(live.state));
});
