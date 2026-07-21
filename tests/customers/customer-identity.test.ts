import { test } from "node:test";
import assert from "node:assert/strict";
import { customerIdentityKey, normalizeEmail, normalizePhone } from "@/lib/customer-identity";

test("normalizeEmail: lowercases and trims", () => {
  assert.equal(normalizeEmail("  Foo@Example.com  "), "foo@example.com");
});

test("normalizeEmail: blank/missing email is null", () => {
  assert.equal(normalizeEmail(""), null);
  assert.equal(normalizeEmail(null), null);
  assert.equal(normalizeEmail(undefined), null);
});

test("normalizePhone: absorbs country-code formatting variance to the last 9 digits", () => {
  assert.equal(normalizePhone("+971501234567"), "501234567");
  assert.equal(normalizePhone("00971501234567"), "501234567");
  assert.equal(normalizePhone("971501234567"), "501234567");
  assert.equal(normalizePhone("0501234567"), "501234567");
});

test("normalizePhone: too short to be a real number is null", () => {
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone(""), null);
});

test("customerIdentityKey: prefers email over phone when both are present", () => {
  const id = customerIdentityKey("foo@example.com", "0501234567");
  assert.deepEqual(id, { id: "email:foo@example.com", matchedBy: "email" });
});

test("customerIdentityKey: falls back to phone when email is absent", () => {
  const id = customerIdentityKey(null, "0501234567");
  assert.deepEqual(id, { id: "phone:501234567", matchedBy: "phone" });
});

test("customerIdentityKey: null when neither is present/derivable", () => {
  assert.equal(customerIdentityKey(null, null), null);
  assert.equal(customerIdentityKey("", "123"), null);
});

test("customerIdentityKey: two phone formattings for the same number resolve to the same key", () => {
  const a = customerIdentityKey(null, "+971501234567");
  const b = customerIdentityKey(null, "0501234567");
  assert.equal(a?.id, b?.id);
});
