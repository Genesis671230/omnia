import { test } from "node:test";
import assert from "node:assert/strict";
import {
  merchantSlug,
  refsFingerprint,
  resolvePayoutId,
  type ExistingPayoutIdentity,
} from "@/lib/finance/payout-identity";

// Tabby numbers a settlement statement by date+currency only — "Tabby20260914AED"
// — but issues one report per store. The statement number is the payouts primary
// key, so every same-date same-currency report used to overwrite its predecessor.
// Measured against the real files: 13 distinct payouts collapsed onto 5 keys.

const NONE: ExistingPayoutIdentity[] = [];

test("merchantSlug normalises a merchant code into an id-safe segment", () => {
  assert.equal(merchantSlug("OSUAEPL"), "OSUAEPL");
  assert.equal(merchantSlug("ksa"), "KSA");
  assert.equal(merchantSlug("Omniastores UAE Paylink"), "OMNIASTORES-UAE-PAYLINK");
  assert.equal(merchantSlug("  Omniastores  KSA "), "OMNIASTORES-KSA");
  assert.equal(merchantSlug(""), "");
  assert.equal(merchantSlug(null), "");
});

test("refsFingerprint is order-insensitive and stable", () => {
  const a = refsFingerprint(["805253", "805262", "805254"]);
  const b = refsFingerprint(["805254", "805253", "805262"]);
  assert.equal(a, b, "same refs in a different order must fingerprint identically");
  assert.notEqual(a, refsFingerprint(["805253", "805262"]));
  assert.match(a, /^[0-9a-f]{6}$/);
});

test("an unclaimed statement number keeps the bare id", () => {
  const id = resolvePayoutId({
    statementNo: "Tabby20260914AED",
    merchantCode: "OSUAEPL",
    merchantName: "Omniastores UAE Paylink",
    orderRefs: ["7399369"],
    existing: NONE,
  });
  assert.equal(id, "Tabby20260914AED");
});

test("re-uploading the identical file reuses its id, so the upsert is idempotent", () => {
  const existing: ExistingPayoutIdentity[] = [
    {
      id: "Tabby20260914AED",
      statementNo: "Tabby20260914AED",
      merchantCode: "OSUAEPL",
      store: "Omniastores UAE Paylink",
      orderRefs: ["7399369", "7399370"],
    },
  ];
  const id = resolvePayoutId({
    statementNo: "Tabby20260914AED",
    merchantCode: "OSUAEPL",
    merchantName: "Omniastores UAE Paylink",
    orderRefs: ["7399370", "7399369"],
    existing,
  });
  assert.equal(id, "Tabby20260914AED", "same merchant + same refs is the same payout");
});

test("a different store under a claimed statement number gets a merchant segment", () => {
  // The real case: uploading "2026-09-14 AED settlement report Omniastores UAE.xlsx"
  // (net 34695.28) when Paylink's 14477.55 already holds Tabby20260914AED.
  const existing: ExistingPayoutIdentity[] = [
    {
      id: "Tabby20260914AED",
      statementNo: "Tabby20260914AED",
      merchantCode: "OSUAEPL",
      store: "Omniastores UAE Paylink",
      orderRefs: ["7399369"],
    },
  ];
  const id = resolvePayoutId({
    statementNo: "Tabby20260914AED",
    merchantCode: "AE",
    merchantName: "Omniastores UAE",
    orderRefs: ["805253", "805262"],
    existing,
  });
  assert.equal(id, "Tabby20260914AED-AE");
});

test("same merchant, different orders, takes the merchant segment while it is free", () => {
  // Two files share merchant code OSUAEPL under Tabby20260914AED with
  // different nets (14477.55 and 13589.71). The bare key is taken by a
  // different set of orders, so the merchant-qualified key is claimed — no
  // hash needed yet, and nothing is overwritten.
  const existing: ExistingPayoutIdentity[] = [
    {
      id: "Tabby20260914AED",
      statementNo: "Tabby20260914AED",
      merchantCode: "OSUAEPL",
      store: "Omniastores UAE Paylink",
      orderRefs: ["7399369"],
    },
  ];
  const id = resolvePayoutId({
    statementNo: "Tabby20260914AED",
    merchantCode: "OSUAEPL",
    merchantName: "Omniastores UAE Paylink",
    orderRefs: ["8100001", "8100002"],
    existing,
  });
  assert.equal(id, "Tabby20260914AED-OSUAEPL");
});

test("a third payout for the same merchant falls through to the content hash", () => {
  const existing: ExistingPayoutIdentity[] = [
    {
      id: "Tabby20260914AED",
      statementNo: "Tabby20260914AED",
      merchantCode: "OSUAEPL",
      store: "Omniastores UAE Paylink",
      orderRefs: ["7399369"],
    },
    {
      id: "Tabby20260914AED-OSUAEPL",
      statementNo: "Tabby20260914AED",
      merchantCode: "OSUAEPL",
      store: "Omniastores UAE Paylink",
      orderRefs: ["8100001", "8100002"],
    },
  ];
  const refs = ["9200001"];
  const id = resolvePayoutId({
    statementNo: "Tabby20260914AED",
    merchantCode: "OSUAEPL",
    merchantName: "Omniastores UAE Paylink",
    orderRefs: refs,
    existing,
  });
  assert.equal(id, `Tabby20260914AED-OSUAEPL-${refsFingerprint(refs)}`);
});

test("re-uploading a file that had to take a qualified id stays idempotent", () => {
  const existing: ExistingPayoutIdentity[] = [
    {
      id: "Tabby20260914AED",
      statementNo: "Tabby20260914AED",
      merchantCode: "OSUAEPL",
      store: "Omniastores UAE Paylink",
      orderRefs: ["7399369"],
    },
    {
      id: "Tabby20260914AED-AE",
      statementNo: "Tabby20260914AED",
      merchantCode: "AE",
      store: "Omniastores UAE",
      orderRefs: ["805253", "805262"],
    },
  ];
  const id = resolvePayoutId({
    statementNo: "Tabby20260914AED",
    merchantCode: "AE",
    merchantName: "Omniastores UAE",
    orderRefs: ["805262", "805253"],
    existing,
  });
  assert.equal(id, "Tabby20260914AED-AE", "the same file re-uploaded must update, not duplicate");
});

test("three stores on one statement number each get a distinct id", () => {
  // Tabby20260706AED really does carry three payouts: 8126.21, 12199.51, 57486.65.
  const existing: ExistingPayoutIdentity[] = [];
  const ids: string[] = [];
  for (const m of [
    { code: "default", name: "OmniaStores Shopify UAE", refs: ["1"] },
    { code: "OSUAEPL", name: "Omniastores UAE Paylink", refs: ["2"] },
    { code: "AE", name: "Omniastores UAE", refs: ["3"] },
  ]) {
    const id = resolvePayoutId({
      statementNo: "Tabby20260706AED",
      merchantCode: m.code,
      merchantName: m.name,
      orderRefs: m.refs,
      existing,
    });
    ids.push(id);
    existing.push({
      id,
      statementNo: "Tabby20260706AED",
      merchantCode: m.code,
      store: m.name,
      orderRefs: m.refs,
    });
  }
  assert.equal(new Set(ids).size, 3, "three stores must not collapse onto one key");
  assert.equal(ids[0], "Tabby20260706AED");
  assert.equal(ids[1], "Tabby20260706AED-OSUAEPL");
  assert.equal(ids[2], "Tabby20260706AED-AE");
});

test("a missing merchant code falls back to the merchant name, then to the hash", () => {
  const existing: ExistingPayoutIdentity[] = [
    {
      id: "Tabby20260907SAR",
      statementNo: "Tabby20260907SAR",
      merchantCode: null,
      store: "Omniastores Riyadh Paylink",
      orderRefs: ["9"],
    },
  ];
  const id = resolvePayoutId({
    statementNo: "Tabby20260907SAR",
    merchantCode: null,
    merchantName: "Omniastores KSA",
    orderRefs: ["10"],
    existing,
  });
  assert.equal(id, "Tabby20260907SAR-OMNIASTORES-KSA");
});

test("with no merchant information at all, a collision still separates by hash", () => {
  const refs = ["77"];
  const existing: ExistingPayoutIdentity[] = [
    { id: "TELR-X", statementNo: "TELR-X", merchantCode: null, store: null, orderRefs: ["66"] },
  ];
  const id = resolvePayoutId({
    statementNo: "TELR-X",
    merchantCode: null,
    merchantName: null,
    orderRefs: refs,
    existing,
  });
  assert.equal(id, `TELR-X-${refsFingerprint(refs)}`);
});

test("resolution never returns an id belonging to a different payout", () => {
  const existing: ExistingPayoutIdentity[] = [
    { id: "S1", statementNo: "S1", merchantCode: "A", store: "A store", orderRefs: ["1"] },
    { id: "S1-B", statementNo: "S1", merchantCode: "B", store: "B store", orderRefs: ["2"] },
  ];
  const id = resolvePayoutId({
    statementNo: "S1",
    merchantCode: "C",
    merchantName: "C store",
    orderRefs: ["3"],
    existing,
  });
  assert.ok(!["S1", "S1-B"].includes(id), `must not reuse a claimed id, got ${id}`);
  assert.equal(id, "S1-C");
});
