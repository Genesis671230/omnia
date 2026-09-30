import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { decryptSecret, encryptSecret, maskSecret } from "../../lib/crypto/secret-box";
import { ENV_CONNECTION_ID, runInZohoScope, zohoConnectionId, zohoOrgId } from "../../lib/integrations/zoho-context";

// Both modules read env at call time, so setting it here is enough.
process.env.ZOHO_CREDENTIALS_KEY ||= randomBytes(32).toString("base64");
process.env.ZOHO_ORGANIZATION_ID = "721369942";

const HOO = { connectionId: "house-of-omnia", orgId: "799179049", label: "House of Omnia", dailyBudget: 4500 };

test("secrets round-trip and every encryption is unique", () => {
  const a = encryptSecret("1000.refresh-token");
  const b = encryptSecret("1000.refresh-token");
  assert.notEqual(a, b); // random IV
  assert.equal(decryptSecret(a), "1000.refresh-token");
  assert.match(a, /^v1:/);
});

test("a tampered secret fails instead of decrypting to garbage", () => {
  const [v, iv, tag, data] = encryptSecret("secret").split(":");
  const flipped = Buffer.from(data, "base64");
  flipped[0] ^= 1;
  assert.throws(() => decryptSecret([v, iv, tag, flipped.toString("base64")].join(":")));
});

test("masking never shows the whole secret", () => {
  assert.equal(maskSecret("1000.d233ea1b5a4117ca"), "1000.d2…ca");
  assert.equal(maskSecret("short"), "••••");
});

test("no scope = the default (env) organisation, as before multi-org", () => {
  assert.equal(zohoOrgId(), "721369942");
  assert.equal(zohoConnectionId(), ENV_CONNECTION_ID);
});

test("inside a scope every read resolves to that organisation, across awaits", async () => {
  await runInZohoScope(HOO, async () => {
    assert.equal(zohoOrgId(), "799179049");
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(zohoOrgId(), "799179049");
    assert.equal(zohoConnectionId(), "house-of-omnia");
  });
  assert.equal(zohoOrgId(), "721369942"); // and it doesn't leak out
});

test("concurrent requests in different organisations never see each other's org", async () => {
  const seen: string[] = [];
  await Promise.all([
    runInZohoScope(HOO, async () => { await new Promise((r) => setTimeout(r, 10)); seen.push(`hoo:${zohoOrgId()}`); }),
    (async () => { await new Promise((r) => setTimeout(r, 5)); seen.push(`main:${zohoOrgId()}`); })(),
  ]);
  assert.deepEqual(seen.sort(), ["hoo:799179049", "main:721369942"]);
});
