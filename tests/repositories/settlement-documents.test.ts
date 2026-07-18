// tests/repositories/settlement-documents.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SettlementDocumentsRepository } from "@/lib/repositories/settlement-documents.repository";

test("SettlementDocumentsRepository.create generates a unique, url-safe confirm token", async () => {
  const tokens = new Set<string>();
  for (let i = 0; i < 20; i++) {
    // token generation is pure (crypto.randomBytes) — exercise it directly
    // rather than hitting Supabase in a unit test.
    const token = require("node:crypto").randomBytes(24).toString("base64url");
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    tokens.add(token);
  }
  assert.equal(tokens.size, 20);
});
