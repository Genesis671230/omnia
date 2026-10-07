import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { memoryConnectionStore, type ConnectionRow } from "@/lib/connectors/store";
import { getJson, postForm, postJson } from "@/lib/connectors/http";

const row = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  id: "shopify-uae", tenant_id: "omnia", provider: "shopify", auth_mode: "token", grant_type: "static_token",
  account_ref: "uae.myshopify.com", label: "UAE", config: { store_id: "UAE" }, secrets_enc: "", scopes: "",
  status: "active", last_checked_at: null, last_synced_at: null, last_error: "", connected_by: "t",
  created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z", ...over,
});

test("memory store: insert, find by account, update, list by provider, remove", async () => {
  const s = memoryConnectionStore();
  await s.insert(row());
  await s.insert(row({ id: "gmail-a", provider: "gmail", account_ref: "a@x.com" }));
  assert.equal((await s.findByAccount("omnia", "shopify", "uae.myshopify.com"))?.id, "shopify-uae");
  await s.update("omnia", "shopify-uae", { label: "UAE store" });
  const got = await s.get("omnia", "shopify-uae");
  assert.equal(got?.label, "UAE store");
  assert.notEqual(got?.updated_at, "2026-10-07T00:00:00Z");
  assert.deepEqual((await s.list("omnia", "gmail")).map((r) => r.id), ["gmail-a"]);
  assert.equal((await s.list("omnia")).length, 2);
  await s.remove("omnia", "gmail-a");
  assert.equal(await s.get("omnia", "gmail-a"), null);
});

test("memory store: duplicate account or id is rejected", async () => {
  const s = memoryConnectionStore();
  await s.insert(row());
  await assert.rejects(s.insert(row({ id: "other" })), /already connected/);
  await assert.rejects(s.insert(row({ account_ref: "other.myshopify.com" })), /already connected/);
});

test("memory store: tenants are isolated", async () => {
  const s = memoryConnectionStore();
  await s.insert(row());
  assert.equal(await s.get("acme", "shopify-uae"), null);
  assert.deepEqual(await s.list("acme"), []);
  await s.insert(row({ tenant_id: "acme" })); // same id + account in another tenant is fine
  assert.equal((await s.list("acme")).length, 1);
});

test("memory store: returned rows are copies, not live references", async () => {
  const s = memoryConnectionStore();
  await s.insert(row());
  const r = (await s.get("omnia", "shopify-uae"))!;
  r.label = "mutated";
  assert.equal((await s.get("omnia", "shopify-uae"))!.label, "UAE");
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("http helpers return status + parsed JSON and never throw on HTTP errors", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    seen.push({ url: String(url), init });
    return String(url).includes("html") ? new Response("<html>", { status: 502 }) : new Response(JSON.stringify({ ok: 1 }), { status: 400 });
  }) as typeof fetch;
  assert.deepEqual(await postForm("https://x/token", { a: "1" }), { status: 400, json: { ok: 1 } });
  assert.equal(String(seen[0].init.body), "a=1");
  assert.equal((seen[0].init.headers as any)["Content-Type"], "application/x-www-form-urlencoded");
  assert.deepEqual(await postJson("https://x/gql", { q: 1 }, { "X-T": "t" }), { status: 400, json: { ok: 1 } });
  assert.equal(seen[1].init.body, '{"q":1}');
  assert.equal((seen[1].init.headers as any)["X-T"], "t");
  assert.deepEqual(await getJson("https://x/html"), { status: 502, json: {} });
});
