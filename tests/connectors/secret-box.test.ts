import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encryptJson, decryptJson, encryptSecret, decryptSecret } from "@/lib/crypto/secret-box";
import { redactSecrets } from "@/lib/audit";
import { currentTenant } from "@/lib/tenant";

// The box reads its key on every call, so setting it after import is fine.
process.env.CONNECTIONS_KEY = randomBytes(32).toString("base64");
delete process.env.ZOHO_CREDENTIALS_KEY;

test("JSON round-trips through the box", () => {
  const v = { refresh_token: "r1", nested: { a: 1 } };
  const enc = encryptJson(v);
  assert.match(enc, /^v1:/);
  assert.deepEqual(decryptJson(enc), v);
});

test("CONNECTIONS_KEY is used; legacy ZOHO_CREDENTIALS_KEY still decrypts old values", () => {
  const enc = encryptSecret("x");
  const saved = process.env.CONNECTIONS_KEY!;
  delete process.env.CONNECTIONS_KEY;
  process.env.ZOHO_CREDENTIALS_KEY = saved;
  assert.equal(decryptSecret(enc), "x");
  process.env.CONNECTIONS_KEY = saved;
  delete process.env.ZOHO_CREDENTIALS_KEY;
});

test("a missing or short key fails loudly", () => {
  const saved = process.env.CONNECTIONS_KEY!;
  delete process.env.CONNECTIONS_KEY;
  assert.throws(() => encryptSecret("x"), /CONNECTIONS_KEY is not set/);
  process.env.CONNECTIONS_KEY = randomBytes(16).toString("base64");
  assert.throws(() => encryptSecret("x"), /32 bytes/);
  process.env.CONNECTIONS_KEY = saved;
});

test("redactSecrets masks secret-looking keys at any depth", () => {
  assert.deepEqual(
    redactSecrets({ label: "a", client_secret: "s", secrets: { refresh_token: "t" }, nested: { access_token: "z", ok: 1 } }),
    { label: "a", client_secret: "••••", secrets: "••••", nested: { access_token: "••••", ok: 1 } },
  );
});

test("currentTenant defaults to omnia and follows DEFAULT_TENANT_ID", () => {
  const saved = process.env.DEFAULT_TENANT_ID;
  delete process.env.DEFAULT_TENANT_ID;
  assert.equal(currentTenant(), "omnia");
  process.env.DEFAULT_TENANT_ID = "acme";
  assert.equal(currentTenant(), "acme");
  if (saved === undefined) delete process.env.DEFAULT_TENANT_ID; else process.env.DEFAULT_TENANT_ID = saved;
});
