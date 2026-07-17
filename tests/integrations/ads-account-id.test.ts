import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAdAccountId } from "@/lib/integrations/ads/account-id";
import { storeForAccount } from "@/lib/ads-accounts";

test("normalizeAdAccountId: strips a leading act_ prefix", () => {
  assert.equal(normalizeAdAccountId("act_526983864499176"), "526983864499176");
});

test("normalizeAdAccountId: leaves a bare numeric id untouched", () => {
  assert.equal(normalizeAdAccountId("526983864499176"), "526983864499176");
});

test("normalizeAdAccountId: trims surrounding whitespace", () => {
  assert.equal(normalizeAdAccountId("  act_123  "), "123");
});

test("normalizeAdAccountId: is case-insensitive on the prefix", () => {
  assert.equal(normalizeAdAccountId("ACT_123"), "123");
});

test("normalizeAdAccountId: strips only the first prefix, never doubling", () => {
  // guards the exact production bug: env held act_123 and the code prepended
  // act_ again, producing act_act_123 -> HTTP 400 on every account, every cycle
  assert.equal(normalizeAdAccountId("act_act_123"), "act_123");
});

test("storeForAccount: matches whether the id carries the act_ prefix or not", () => {
  process.env.META_MAIN_AD_ACCOUNT_IDS = "act_526983864499176,act_3216294595244505";
  process.env.META_KSA_AD_ACCOUNT_ID = "act_391544104019628";

  // guards the desync that would silently tag every insight store:"UNKNOWN"
  assert.equal(storeForAccount("meta", "526983864499176"), "WOO");
  assert.equal(storeForAccount("meta", "act_526983864499176"), "WOO");
  assert.equal(storeForAccount("meta", "3216294595244505"), "WOO");
  assert.equal(storeForAccount("meta", "391544104019628"), "KSA");
  assert.equal(storeForAccount("meta", "999999999999999"), "UNKNOWN");
});
