import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedStorefrontUrl } from "../../lib/storefront/sites";

test("allowedStorefrontUrl only lets the three storefront hosts through", () => {
  assert.equal(allowedStorefrontUrl("https://omniastores.com/products/x")?.href, "https://omniastores.com/products/x");
  assert.equal(allowedStorefrontUrl("http://www.omniastores.ae/")?.protocol, "https:");
  assert.ok(allowedStorefrontUrl("https://sa.omniastores.ae/collections/all"));
  assert.equal(allowedStorefrontUrl("https://evil.com/?omniastores.com"), null);
  assert.equal(allowedStorefrontUrl("https://omniastores.com.evil.com/"), null);
  assert.equal(allowedStorefrontUrl("http://169.254.169.254/latest"), null);
  assert.equal(allowedStorefrontUrl("file:///etc/passwd"), null);
  assert.equal(allowedStorefrontUrl(""), null);
});
