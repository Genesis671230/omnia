# Meta Ads Correctness & Funnel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Meta ad connector actually work and report honest numbers — fix the total-failure `act_act_` bug, kill the 8x purchase overcount, capture the purchase funnel, and stop one bad account from blanking all Meta data.

**Architecture:** Three surgical fixes to `lib/integrations/ads/meta.ts` plus one shared normalizer module, an additive `ad_insights` migration for four funnel columns, a uniform `PlatformFetchResult` return so per-account errors reach the founder, and a marketing-panel update showing the funnel and both ROAS figures labeled by source.

**Tech Stack:** Next.js 16, TypeScript, Supabase (PostgREST), Meta Graph API v21.0, `node:test` via `tsx --test`.

Spec: `docs/superpowers/specs/2026-07-17-meta-ads-correctness-design.md`

## Global Constraints

- **Never sum Meta action_type aliases.** Meta reports one conversion under many names. Always pick the first canonical alias present. This is the whole point of the plan.
- **Account IDs: canonical internal form is the bare numeric ID.** `act_` is added only when building a Graph URL. Normalization must come from the one shared helper — never re-implemented inline.
- Graph API version stays pinned at `v21.0` (`API_VERSION` in `meta.ts`).
- Tests run with `npx tsx --test <path>`. Full suite: `npm test`. Existing suite is **26 tests, all passing** — it must stay green.
- Tests in this task set must **not** require `.env` — `meta.ts` and `ads-accounts.ts` import no Supabase client. Set `process.env` values inside the test itself.
- Follow the existing additive-migration style in `db/schema.sql` (`alter table ... add column if not exists`). `ad_insights` currently has **0 rows** — no backfill needed.
- Comments explaining a reversal of a prior documented decision must be **rewritten to record the reversal and its reasoning**, never silently deleted.

---

### Task 1: Shared account-ID normalizer

Fixes the `act_act_` total-failure bug. Must land in one shared helper because `ads-accounts.ts:41` matches account IDs by string equality against the raw env value — normalizing in `meta.ts` alone would desync them, tag every insight `store: "UNKNOWN"`, and render an empty panel while reporting sync success.

**Files:**
- Create: `lib/integrations/ads/account-id.ts`
- Create: `tests/integrations/ads-account-id.test.ts`
- Modify: `lib/integrations/ads/meta.ts:24-41` (`accountGroups`), `:86` (URL build)
- Modify: `lib/ads-accounts.ts:18-20` (`metaMainAccountIds`), `:22-38` (`buildMapping`), `:40-43` (`storeForAccount`)
- Modify: `.env` (add the second Main ad account ID)

**Interfaces:**
- Produces: `normalizeAdAccountId(raw: string): string` — strips a leading `act_` (case-insensitive) and trims. Used by Tasks 2-5 wherever an account ID crosses a boundary.

- [ ] **Step 1: Write the failing test**

Create `tests/integrations/ads-account-id.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAdAccountId } from "@/lib/integrations/ads/account-id";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/integrations/ads-account-id.test.ts`
Expected: FAIL — cannot find module `@/lib/integrations/ads/account-id`

- [ ] **Step 3: Write minimal implementation**

Create `lib/integrations/ads/account-id.ts`:

```ts
// Canonical internal form for an ad account id is the BARE numeric id.
// `act_` is a Graph API URL prefix, not part of the id — it is added only
// when building a request URL.
//
// This exists as one shared helper on purpose. `.env` may hold either form,
// and lib/ads-accounts.ts matches insight rows to stores by string equality.
// If normalization lived in only one of those places the two would desync,
// every insight would map to store "UNKNOWN", and /api/ads/summary (which
// filters on WOO/KSA/UAE) would render an empty panel while the sync
// reported success. Normalize once, here, and use it on both sides.

export function normalizeAdAccountId(raw: string): string {
  return raw.trim().replace(/^act_/i, "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/integrations/ads-account-id.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Wire the normalizer into `meta.ts`**

In `lib/integrations/ads/meta.ts`, add the import:

```ts
import { normalizeAdAccountId } from "./account-id";
```

Replace the body of `accountGroups()` (currently lines 24-41) so both groups normalize their ids:

```ts
function accountGroups(): MetaAccountGroup[] {
  const groups: MetaAccountGroup[] = [];
  if (process.env.META_MAIN_ACCESS_TOKEN && process.env.META_MAIN_AD_ACCOUNT_IDS) {
    groups.push({
      label: "main",
      accessToken: process.env.META_MAIN_ACCESS_TOKEN,
      adAccountIds: process.env.META_MAIN_AD_ACCOUNT_IDS.split(",").map(normalizeAdAccountId).filter(Boolean),
    });
  }
  if (process.env.META_KSA_ACCESS_TOKEN && process.env.META_KSA_AD_ACCOUNT_ID) {
    groups.push({
      label: "ksa",
      accessToken: process.env.META_KSA_ACCESS_TOKEN,
      adAccountIds: [normalizeAdAccountId(process.env.META_KSA_AD_ACCOUNT_ID)],
    });
  }
  return groups;
}
```

Line 86 already reads `` `${BASE}/act_${adAccountId}/insights?...` `` and line 108 reads `` `${BASE}/act_${adAccountId}/campaigns?...` `` — leave both exactly as they are. They are now correct because `adAccountId` is bare.

- [ ] **Step 6: Wire the normalizer into `ads-accounts.ts`**

In `lib/ads-accounts.ts`, add the import:

```ts
import { normalizeAdAccountId } from "./integrations/ads/account-id";
```

Replace `metaMainAccountIds()` (lines 18-20):

```ts
function metaMainAccountIds(): string[] {
  return (process.env.META_MAIN_AD_ACCOUNT_IDS || "").split(",").map(normalizeAdAccountId).filter(Boolean);
}
```

In `buildMapping()`, normalize the KSA, TikTok, and Snap ids too:

```ts
  if (process.env.META_KSA_AD_ACCOUNT_ID) {
    entries.push({ platform: "meta", accountId: normalizeAdAccountId(process.env.META_KSA_AD_ACCOUNT_ID), store: "KSA" });
  }
  if (process.env.TIKTOK_ADVERTISER_ID) {
    entries.push({ platform: "tiktok", accountId: process.env.TIKTOK_ADVERTISER_ID.trim(), store: "WOO" });
  }
  if (process.env.GOOGLE_ADS_CUSTOMER_ID) {
    entries.push({ platform: "google", accountId: process.env.GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, ""), store: "WOO" });
  }
  if (process.env.SNAP_AD_ACCOUNT_ID) {
    entries.push({ platform: "snap", accountId: process.env.SNAP_AD_ACCOUNT_ID.trim(), store: "UAE" });
  }
```

And make the lookup normalize its input, so a caller passing either form still matches:

```ts
export function storeForAccount(platform: AdPlatform, accountId: string): string {
  const id = platform === "meta" ? normalizeAdAccountId(accountId) : accountId.trim();
  const match = buildMapping().find((e) => e.platform === platform && e.accountId === id);
  return match?.store ?? "UNKNOWN";
}
```

Update the header comment's account count to reflect reality:

```ts
//   Meta Main (2 ad accounts) -> WOO   (act_526983864499176 OmniaFouad,
//                                       act_3216294595244505 OmniaStores 2026)
```

- [ ] **Step 7: Add the store-mapping regression test**

Append to `tests/integrations/ads-account-id.test.ts`:

```ts
import { storeForAccount } from "@/lib/ads-accounts";

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
```

- [ ] **Step 8: Run the tests**

Run: `npx tsx --test tests/integrations/ads-account-id.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 9: Add the second Main ad account to `.env`**

Edit `.env`, changing the `META_MAIN_AD_ACCOUNT_IDS` line to:

```
META_MAIN_AD_ACCOUNT_IDS=act_526983864499176,act_3216294595244505
```

`ads-accounts.ts` already maps every Main id to `WOO`, so no further code change is needed.

**Note for the implementer — do not treat this as a bug:** the Main system-user token currently **cannot reach `act_3216294595244505`** (it is not granted in Business Manager). Until the founder grants it, that one account will return an error while the other two sync normally. That partial-failure behavior is exactly what Task 4 builds, and it is the intended outcome — do not "fix" it by removing the id.

- [ ] **Step 10: Run the full suite**

Run: `npm test`
Expected: PASS — 32 tests (26 existing + 6 new)

- [ ] **Step 11: Commit**

```bash
git add lib/integrations/ads/account-id.ts lib/integrations/ads/meta.ts lib/ads-accounts.ts tests/integrations/ads-account-id.test.ts .env
git commit -m "Fix act_act_ double prefix that broke every Meta sync

.env stores ids with the act_ prefix; meta.ts prepended act_ again,
producing act_act_<id> -> HTTP 400 on every account, every 15 minutes.
ad_insights has 0 rows as a result.

Normalization lives in one shared helper because ads-accounts.ts matches
insights to stores by string equality against the raw env value —
normalizing in meta.ts alone would desync the two, tag every insight
store:UNKNOWN, and render an empty panel while reporting success.

Also wires in act_3216294595244505 (OmniaStores 2026), a live account
spending AED 1,586/30d that was tracked nowhere."
```

---

### Task 2: Canonical action-type picker — kill the 8x overcount

`meta.ts:60-65` sums every action type containing `"purchase"`. Meta reports the same 653 purchases under 8 aliases, so this reports **5,224 purchases** and **AED 5,222,860**, inflating pixel ROAS to **28.55x** against a real **4.76x**.

**Files:**
- Modify: `lib/integrations/ads/meta.ts:47-65` (replace `sumPurchaseActions`), `:128-143` (call sites)
- Create: `tests/integrations/ads-meta.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (independent).
- Produces: `pickCanonical(actions: MetaAction[] | undefined, aliases: string[]): number` and `FUNNEL_STAGES` — both consumed by Task 3. Both must be `export`ed for tests.

- [ ] **Step 1: Write the failing test**

Create `tests/integrations/ads-meta.test.ts`. The fixture values are **real**, captured from `act_526983864499176` over the live last-30-day window:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCanonical, FUNNEL_STAGES } from "@/lib/integrations/ads/meta";

// Real payload shape from act_526983864499176, last 30 days. Meta reports ONE
// set of 653 purchases under EIGHT aliases. Summing them yields 5,224.
const REAL_ACTIONS = [
  { action_type: "web_in_store_purchase", value: "653" },
  { action_type: "omni_purchase", value: "653" },
  { action_type: "offsite_purchase_add_20_s_calls", value: "653" },
  { action_type: "offsite_conversion.fb_pixel_purchase", value: "653" },
  { action_type: "onsite_web_app_purchase", value: "653" },
  { action_type: "purchase", value: "653" },
  { action_type: "web_app_in_store_purchase", value: "653" },
  { action_type: "onsite_web_purchase", value: "653" },
  { action_type: "landing_page_view", value: "24455" },
  { action_type: "omni_landing_page_view", value: "24455" },
  { action_type: "omni_view_content", value: "30964" },
  { action_type: "view_content", value: "30964" },
  { action_type: "offsite_conversion.fb_pixel_view_content", value: "30964" },
  { action_type: "omni_add_to_cart", value: "2442" },
  { action_type: "add_to_cart", value: "2442" },
  { action_type: "omni_initiated_checkout", value: "756" },
  { action_type: "initiate_checkout", value: "756" },
];

// Note web_app_in_store_purchase reports 87.05 where every other alias reports
// 870462.12 — aliases are not even value-identical, so summing is never valid.
const REAL_ACTION_VALUES = [
  { action_type: "onsite_web_app_purchase", value: "870462.12" },
  { action_type: "onsite_web_purchase", value: "870462.12" },
  { action_type: "purchase", value: "870462.12" },
  { action_type: "web_app_in_store_purchase", value: "87.05" },
  { action_type: "offsite_conversion.fb_pixel_purchase", value: "870462.12" },
  { action_type: "omni_purchase", value: "870462.12" },
  { action_type: "web_in_store_purchase", value: "870462.12" },
];

test("pickCanonical: returns 653 purchases, NOT the 5224 produced by summing aliases", () => {
  assert.equal(pickCanonical(REAL_ACTIONS, FUNNEL_STAGES.purchase), 653);
});

test("pickCanonical: returns the real conversion value, not the 6x-inflated sum", () => {
  assert.equal(pickCanonical(REAL_ACTION_VALUES, FUNNEL_STAGES.purchase), 870462.12);
});

test("pickCanonical: falls back to the next alias when the preferred one is absent", () => {
  const noOmni = REAL_ACTIONS.filter((a) => a.action_type !== "omni_purchase");
  // omni_purchase gone -> next in priority is offsite_conversion.fb_pixel_purchase
  assert.equal(pickCanonical(noOmni, FUNNEL_STAGES.purchase), 653);
});

test("pickCanonical: returns 0 when no alias is present", () => {
  assert.equal(pickCanonical([{ action_type: "link_click", value: "47994" }], FUNNEL_STAGES.purchase), 0);
});

test("pickCanonical: returns 0 for undefined actions", () => {
  assert.equal(pickCanonical(undefined, FUNNEL_STAGES.purchase), 0);
});

test("FUNNEL_STAGES: every stage resolves to its real canonical value", () => {
  assert.equal(pickCanonical(REAL_ACTIONS, FUNNEL_STAGES.landing_page_views), 24455);
  assert.equal(pickCanonical(REAL_ACTIONS, FUNNEL_STAGES.view_content), 30964);
  assert.equal(pickCanonical(REAL_ACTIONS, FUNNEL_STAGES.add_to_cart), 2442);
  assert.equal(pickCanonical(REAL_ACTIONS, FUNNEL_STAGES.initiate_checkout), 756);
  assert.equal(pickCanonical(REAL_ACTIONS, FUNNEL_STAGES.purchase), 653);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/integrations/ads-meta.test.ts`
Expected: FAIL — `pickCanonical` / `FUNNEL_STAGES` are not exported from `meta.ts`

- [ ] **Step 3: Write minimal implementation**

In `lib/integrations/ads/meta.ts`, **delete** `sumPurchaseActions` (lines 60-65) and replace it with:

```ts
// Meta reports ONE conversion under MANY action_type aliases. On the live
// account, eight aliases each report the same 653 purchases (verified
// 2026-07-17). Summing anything matching "purchase" therefore reported 5,224
// purchases and AED 5,222,860 — a pixel ROAS of 28.55x against a real 4.76x.
//
// The previous author's instinct was right (alias naming genuinely varies by
// account and pixel setup); the remedy was what broke it. So: keep the
// flexibility via a priority list, but take the FIRST alias present and NEVER
// sum. omni_* leads every list because it is Meta's own cross-platform
// DEDUPLICATED metric — their answer to "count this once".
//
// Aliases are not even value-identical: web_app_in_store_purchase reports
// 87.05 where the others report 870462.12. There is no reading under which
// summing them is correct.
export const FUNNEL_STAGES = {
  landing_page_views: ["landing_page_view", "omni_landing_page_view"],
  view_content: ["omni_view_content", "view_content", "offsite_conversion.fb_pixel_view_content"],
  add_to_cart: ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"],
  initiate_checkout: ["omni_initiated_checkout", "initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout"],
  purchase: ["omni_purchase", "offsite_conversion.fb_pixel_purchase", "purchase"],
} as const;

export function pickCanonical(actions: MetaAction[] | undefined, aliases: readonly string[]): number {
  if (!actions) return 0;
  for (const alias of aliases) {
    const hit = actions.find((a) => a.action_type === alias);
    if (hit) return Number(hit.value || 0);
  }
  return 0;
}
```

Then update the two call sites in `fetchInsights` (lines 140-141) from `sumPurchaseActions(...)` to:

```ts
          conversions: pickCanonical(r.actions, FUNNEL_STAGES.purchase),
          conversionValue: pickCanonical(r.action_values, FUNNEL_STAGES.purchase),
```

Finally, rewrite the stale file-header paragraph (lines 11-15) that documents the old behavior:

```ts
// "actions"/"action_values" are Meta's generic conversion-event arrays, keyed
// by action_type (e.g. "omni_purchase", "onsite_web_purchase"). Meta reports
// the SAME conversion under many aliases, so we take the first canonical
// alias present and never sum them — see FUNNEL_STAGES below for why.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/integrations/ads-meta.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/ads/meta.ts tests/integrations/ads-meta.test.ts
git commit -m "Stop summing Meta purchase aliases (8x conversion overcount)

Meta reports one conversion under many action_type aliases; the live
account returns the same 653 purchases under 8 names. Summing every type
containing 'purchase' reported 5,224 purchases and AED 5,222,860 —
inflating pixel ROAS to 28.55x against a real 4.76x.

Takes the first canonical alias instead, omni_* first (Meta's own
cross-platform deduplicated metric). Aliases are not even value-identical
(web_app_in_store_purchase: 87.05 vs 870462.12), so summing is never valid.

Regression test uses the real 8-alias payload and asserts 653, not 5,224."
```

---

### Task 3: Purchase funnel capture

The founder's "actual money leads" means the purchase funnel — this account has no lead-gen at all (objectives are only `OUTCOME_AWARENESS`, `LINK_CLICKS`, `OUTCOME_SALES`). Live funnel: LPV 24,455 → view_content 30,964 → ATC 2,442 → checkout 756 → purchase 653. The view_content → ATC step drops **92%**.

**Files:**
- Modify: `lib/integrations/ads/types.ts:7-20` (`NormalizedInsight`)
- Modify: `lib/integrations/ads/meta.ts` (`fetchInsights` — populate funnel fields)
- Modify: `db/schema.sql` (append four columns)
- Modify: `lib/repositories/ad-insights.repository.ts:6-20` (`AdInsightRow`), `:46-60` (upsert), `:72-107` (list)
- Modify: `tests/integrations/ads-meta.test.ts` (add funnel assertions)

**Interfaces:**
- Consumes: `pickCanonical`, `FUNNEL_STAGES` from Task 2.
- Produces: `NormalizedInsight.landingPageViews / viewContent / addToCart / initiateCheckout` — all **optional** `number | undefined`. Optional on purpose: Google/TikTok/Snap do not report these and must not be forced to fabricate zeros. The repository coerces with `?? 0`.

- [ ] **Step 1: Add the optional funnel fields to the shared type**

In `lib/integrations/ads/types.ts`, extend `NormalizedInsight`:

```ts
export type NormalizedInsight = {
  platform: AdPlatform;
  accountId: string;
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  date: string; // YYYY-MM-DD
  spend: number;
  currency: string;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  // Purchase-funnel stages. Optional because only Meta reports them today —
  // Google/TikTok/Snap leave them undefined rather than fake a zero, and the
  // repository coerces to 0 at the storage boundary.
  landingPageViews?: number;
  viewContent?: number;
  addToCart?: number;
  initiateCheckout?: number;
};
```

- [ ] **Step 2: Confirm the stage extraction is already proven**

No new test here. Task 2's `FUNNEL_STAGES: every stage resolves to its real canonical value` test already proves the extraction logic against the real payload. This task only wires those proven values through `fetchInsights` → the type → the columns, which the typecheck in Step 6 covers.

The `fetchInsights` end-to-end test lives in **Task 4**, where its return shape settles — writing it here would assert a shape this task doesn't yet produce and would fail its own TDD gate.

- [ ] **Step 3: Populate the funnel fields in `meta.ts`**

In `fetchInsights`, extend the pushed object (currently lines 129-142):

```ts
        out.push({
          platform,
          accountId: adAccountId,
          campaignId: r.campaign_id,
          campaignName: r.campaign_name,
          campaignStatus: statuses.get(r.campaign_id) ?? "unknown",
          date: r.date_start,
          spend: Number(r.spend || 0),
          currency: r.account_currency || "AED",
          impressions: Number(r.impressions || 0),
          clicks: Number(r.clicks || 0),
          conversions: pickCanonical(r.actions, FUNNEL_STAGES.purchase),
          conversionValue: pickCanonical(r.action_values, FUNNEL_STAGES.purchase),
          landingPageViews: pickCanonical(r.actions, FUNNEL_STAGES.landing_page_views),
          viewContent: pickCanonical(r.actions, FUNNEL_STAGES.view_content),
          addToCart: pickCanonical(r.actions, FUNNEL_STAGES.add_to_cart),
          initiateCheckout: pickCanonical(r.actions, FUNNEL_STAGES.initiate_checkout),
        });
```

- [ ] **Step 4: Add the schema migration**

Append to `db/schema.sql`:

```sql
-- ad_insights: purchase-funnel stages. The founder's "actual money leads"
-- means this funnel — the Meta accounts run no lead-gen campaigns at all
-- (objectives are only OUTCOME_AWARENESS / LINK_CLICKS / OUTCOME_SALES).
-- Live 30d shape: LPV 24,455 -> view_content 30,964 -> add_to_cart 2,442 ->
-- initiate_checkout 756 -> purchase 653; the view_content -> add_to_cart step
-- drops 92%, the largest weak spot. `purchase` maps to the existing
-- conversions column. Only Meta populates these; other platforms store 0.
alter table ad_insights add column if not exists landing_page_views integer not null default 0;
alter table ad_insights add column if not exists view_content       integer not null default 0;
alter table ad_insights add column if not exists add_to_cart        integer not null default 0;
alter table ad_insights add column if not exists initiate_checkout  integer not null default 0;
```

Apply it: `node db/apply-schema.mjs`
Expected: completes without error.

- [ ] **Step 5: Persist and read the funnel columns**

In `lib/repositories/ad-insights.repository.ts`, extend `AdInsightRow`:

```ts
export type AdInsightRow = {
  campaign_id: string;
  platform: string;
  account_id: string;
  store_id: string;
  campaign_name: string;
  campaign_status: string;
  date: string;
  spend: number;
  currency: string;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  landing_page_views: number;
  view_content: number;
  add_to_cart: number;
  initiate_checkout: number;
};
```

In `upsertInsights`, extend the mapped insight row:

```ts
        conversions: r.conversions,
        conversion_value: r.conversionValue,
        landing_page_views: r.landingPageViews ?? 0,
        view_content: r.viewContent ?? 0,
        add_to_cart: r.addToCart ?? 0,
        initiate_checkout: r.initiateCheckout ?? 0,
        synced_at: new Date().toISOString(),
```

In `listInsights`, add the columns to the select:

```ts
        .select("campaign_id, date, spend, currency, impressions, clicks, conversions, conversion_value, landing_page_views, view_content, add_to_cart, initiate_checkout")
```

And to the pushed row:

```ts
        conversions: Number(ins.conversions || 0),
        conversion_value: Number(ins.conversion_value || 0),
        landing_page_views: Number(ins.landing_page_views || 0),
        view_content: Number(ins.view_content || 0),
        add_to_cart: Number(ins.add_to_cart || 0),
        initiate_checkout: Number(ins.initiate_checkout || 0),
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/integrations/ads/types.ts lib/integrations/ads/meta.ts db/schema.sql lib/repositories/ad-insights.repository.ts tests/integrations/ads-meta.test.ts
git commit -m "Capture the Meta purchase funnel

The founder's 'actual money leads' means the purchase funnel — these
accounts run no lead-gen campaigns (objectives are only
OUTCOME_AWARENESS / LINK_CLICKS / OUTCOME_SALES, and
offsite_content_view_add_meta_leads is a view-content event, not a lead).

Live 30d: LPV 24,455 -> view_content 30,964 -> add_to_cart 2,442 ->
initiate_checkout 756 -> purchase 653. The view_content -> add_to_cart
step drops 92% — the biggest weak spot, at AED 280/purchase.

Fields are optional on NormalizedInsight: only Meta reports them, and
Google/TikTok/Snap shouldn't fabricate zeros."
```

---

### Task 4: Per-account error isolation

`meta.ts:118-147` loops accounts with no try/catch. One failure throws, escapes to `ad-sync.ts`, and is caught **per platform** — zeroing all Meta data. This is exactly how one malformed id blanked everything for weeks. It also matters right now: `act_3216294595244505` **will** fail until the founder grants Business Manager access, and the founder must be able to see that error rather than lose the other AED 204k of accounts.

**Files:**
- Modify: `lib/integrations/ads/types.ts` (add `PlatformFetchResult`)
- Modify: `lib/integrations/ads/meta.ts:118-147` (`fetchInsights`)
- Modify: `lib/integrations/ads/google.ts:58` , `tiktok.ts:52`, `snap.ts:58` (return the new shape)
- Modify: `lib/ad-sync.ts:17-21` (`PlatformClient`), `:38-50` (loop)
- Modify: `tests/integrations/ads-meta.test.ts`

**Interfaces:**
- Consumes: `NormalizedInsight` (Task 3).
- Produces: `PlatformFetchResult = { insights: NormalizedInsight[]; errors: string[] }` — every connector's `fetchInsights` returns this.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integrations/ads-meta.test.ts`. The first test is the funnel end-to-end check deferred from Task 3 — it lands here because this is where `fetchInsights`'s return shape settles:

```ts
import { fetchInsights } from "@/lib/integrations/ads/meta";

// Stubs global fetch, routing by URL: /insights returns the row, /campaigns
// returns the status lookup. Restores the original fetch afterwards.
function stubMetaFetch(insightRows: unknown[], campaigns: unknown[] = []) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const body = url.includes("/insights") ? { data: insightRows } : { data: campaigns };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

test("fetchInsights: maps the funnel and reports 653 purchases from a real 8-alias payload", async () => {
  process.env.META_MAIN_ACCESS_TOKEN = "test-token";
  process.env.META_MAIN_AD_ACCOUNT_IDS = "act_526983864499176";
  delete process.env.META_KSA_ACCESS_TOKEN;
  const restore = stubMetaFetch([
    {
      campaign_id: "120210000000000001",
      campaign_name: "Sales - Retarget - Jul26",
      date_start: "2026-07-16",
      spend: "182907.61",
      impressions: "8646572",
      clicks: "47994",
      account_currency: "AED",
      actions: REAL_ACTIONS,
      action_values: REAL_ACTION_VALUES,
    },
  ], [{ id: "120210000000000001", effective_status: "ACTIVE" }]);

  try {
    const { insights } = await fetchInsights({ from: "2026-07-16", to: "2026-07-16" });
    assert.equal(insights.length, 1);
    const i = insights[0];
    assert.equal(i.accountId, "526983864499176"); // normalized, no act_ prefix
    assert.equal(i.conversions, 653);
    assert.equal(i.conversionValue, 870462.12);
    assert.equal(i.landingPageViews, 24455);
    assert.equal(i.viewContent, 30964);
    assert.equal(i.addToCart, 2442);
    assert.equal(i.initiateCheckout, 756);
    assert.equal(i.campaignStatus, "active");
  } finally {
    restore();
  }
});

test("fetchInsights: one failing account does not blank the others", async () => {
  process.env.META_MAIN_ACCESS_TOKEN = "test-token";
  // first id succeeds, second is the un-granted account that 400s
  process.env.META_MAIN_AD_ACCOUNT_IDS = "act_526983864499176,act_3216294595244505";
  delete process.env.META_KSA_ACCESS_TOKEN;

  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("act_3216294595244505")) {
      return new Response(JSON.stringify({ error: { message: "Permission denied" } }), { status: 400 });
    }
    if (url.includes("/insights")) {
      return new Response(JSON.stringify({ data: [{
        campaign_id: "c1", campaign_name: "Live", date_start: "2026-07-16",
        spend: "100", impressions: "10", clicks: "5", account_currency: "AED",
        actions: REAL_ACTIONS, action_values: REAL_ACTION_VALUES,
      }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }) as typeof fetch;

  try {
    const { insights, errors } = await fetchInsights({ from: "2026-07-16", to: "2026-07-16" });
    assert.equal(insights.length, 1, "the healthy account's rows must survive");
    assert.equal(insights[0].conversions, 653);
    assert.equal(errors.length, 1, "the failing account must report an error");
    assert.match(errors[0], /3216294595244505/);
  } finally {
    globalThis.fetch = original;
  }
});

test("fetchInsights: throws only when every account fails", async () => {
  process.env.META_MAIN_ACCESS_TOKEN = "test-token";
  process.env.META_MAIN_AD_ACCOUNT_IDS = "act_1";
  delete process.env.META_KSA_ACCESS_TOKEN;

  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "boom" } }), { status: 400 })) as typeof fetch;

  try {
    await assert.rejects(() => fetchInsights({ from: "2026-07-16", to: "2026-07-16" }), /boom/);
  } finally {
    globalThis.fetch = original;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/integrations/ads-meta.test.ts`
Expected: FAIL — `fetchInsights` returns an array, so destructuring `{ insights, errors }` yields `undefined`.

- [ ] **Step 3: Add the shared result type**

Append to `lib/integrations/ads/types.ts`:

```ts
// A platform fetch can partially succeed: one ad account may fail (expired
// permission, transient "Service temporarily unavailable" — both of which
// Meta returns under normal operation) while its siblings return fine.
// Errors travel alongside the rows so a single bad account cannot blank a
// whole platform's data, and so the founder can still SEE which account
// failed rather than silently losing it.
export type PlatformFetchResult = {
  insights: NormalizedInsight[];
  errors: string[];
};
```

- [ ] **Step 4: Isolate per-account failures in `meta.ts`**

Replace `fetchInsights` (lines 118-147) with:

```ts
export async function fetchInsights(range: DateRange): Promise<PlatformFetchResult> {
  const platform: AdPlatform = "meta";
  const out: NormalizedInsight[] = [];
  const errors: string[] = [];
  let attempted = 0;

  for (const group of accountGroups()) {
    for (const adAccountId of group.adAccountIds) {
      attempted++;
      try {
        const [rows, statuses] = await Promise.all([
          fetchAdAccountInsights(adAccountId, group.accessToken, range),
          fetchCampaignStatuses(adAccountId, group.accessToken),
        ]);
        for (const r of rows) {
          out.push({
            platform,
            accountId: adAccountId,
            campaignId: r.campaign_id,
            campaignName: r.campaign_name,
            campaignStatus: statuses.get(r.campaign_id) ?? "unknown",
            date: r.date_start,
            spend: Number(r.spend || 0),
            currency: r.account_currency || "AED",
            impressions: Number(r.impressions || 0),
            clicks: Number(r.clicks || 0),
            conversions: pickCanonical(r.actions, FUNNEL_STAGES.purchase),
            conversionValue: pickCanonical(r.action_values, FUNNEL_STAGES.purchase),
            landingPageViews: pickCanonical(r.actions, FUNNEL_STAGES.landing_page_views),
            viewContent: pickCanonical(r.actions, FUNNEL_STAGES.view_content),
            addToCart: pickCanonical(r.actions, FUNNEL_STAGES.add_to_cart),
            initiateCheckout: pickCanonical(r.actions, FUNNEL_STAGES.initiate_checkout),
          });
        }
      } catch (e) {
        // One account's failure must never blank the others. act_3216294595244505
        // is expected to fail until it's granted to the Main system user in
        // Business Manager — the AED 182k account must keep flowing regardless.
        errors.push(`act_${adAccountId}: ${(e as Error).message}`);
      }
    }
  }

  // Every account failing is a real platform outage — surface it as a throw so
  // the sync run records it, matching how the other connectors report failure.
  if (attempted > 0 && errors.length === attempted) throw new Error(errors.join("; "));

  return { insights: out, errors };
}
```

Add `PlatformFetchResult` to the type import at the top of the file:

```ts
import type { AdPlatform, DateRange, NormalizedInsight, PlatformFetchResult } from "./types";
```

- [ ] **Step 5: Update the other three connectors**

Each already builds its rows and returns them. Wrap the return only.

`lib/integrations/ads/google.ts` — change the signature on line 58 and the final return:

```ts
export async function fetchInsights(range: DateRange): Promise<PlatformFetchResult> {
```

Its `return rows.map((r) => ({ ... }));` becomes:

```ts
  return { insights: rows.map((r) => ({ ... })), errors: [] };
```

(Keep the existing mapping body exactly as-is — only the wrapper changes.)

`lib/integrations/ads/tiktok.ts` — signature on line 52, and `return out;` becomes `return { insights: out, errors: [] };`

`lib/integrations/ads/snap.ts` — signature on line 58, and its final return wraps identically.

Add `PlatformFetchResult` to each file's type import.

Single-account platforms return `errors: []` because a failure there is a total platform failure, which they already signal by throwing.

- [ ] **Step 6: Consume the new shape in `ad-sync.ts`**

Replace the `PlatformClient` type (lines 17-21):

```ts
type PlatformClient = {
  name: string;
  configured: () => boolean;
  fetch: (range: DateRange) => Promise<PlatformFetchResult>;
};
```

Replace the loop body (lines 39-49):

```ts
  for (const platform of PLATFORMS) {
    if (!platform.configured()) continue;
    try {
      const { insights, errors } = await platform.fetch(range);
      const withStore = insights.map((i) => ({ ...i, store: storeForAccount(i.platform, i.accountId) }));
      const saved = await AdInsightsRepository.upsertInsights(withStore);
      // Partial failures still save what worked, but the error rides along so
      // the founder can see which account is broken instead of silently
      // losing it from the totals.
      results.push({
        platform: platform.name,
        fetched: insights.length,
        saved,
        error: errors.length > 0 ? errors.join("; ") : undefined,
      });
    } catch (e) {
      results.push({ platform: platform.name, fetched: 0, saved: 0, error: (e as Error).message });
    }
  }
```

Update the type import:

```ts
import type { NormalizedInsight, DateRange, PlatformFetchResult } from "@/lib/integrations/ads/types";
```

Remove `NormalizedInsight` from that import if it becomes unused — run the typecheck in Step 7 to confirm.

- [ ] **Step 7: Run tests and typecheck**

Run: `npx tsx --test tests/integrations/ads-meta.test.ts`
Expected: PASS — all tests in the file, including the funnel end-to-end test deferred from Task 3.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: PASS — 26 existing + all new tests.

- [ ] **Step 8: Commit**

```bash
git add lib/integrations/ads/types.ts lib/integrations/ads/meta.ts lib/integrations/ads/google.ts lib/integrations/ads/tiktok.ts lib/integrations/ads/snap.ts lib/ad-sync.ts tests/integrations/ads-meta.test.ts
git commit -m "Isolate per-account Meta failures so one bad account can't blank all

fetchInsights looped accounts with no try/catch: one throw escaped to
ad-sync, which catches per PLATFORM, zeroing every Meta account. That is
how a single malformed id blanked all Meta data for weeks.

Matters immediately: act_3216294595244505 will 400 until it's granted to
the Main system user in Business Manager. The AED 182k account must keep
flowing, and the founder must SEE that error rather than lose it.

Errors now ride alongside rows via PlatformFetchResult. Throwing is
reserved for every-account failure — a real platform outage."
```

---

### Task 5: Meta token expiry monitoring

The KSA token is a personal `USER` token expiring **2026-08-26**. Its predecessor expired 2026-06-26 and silently killed KSA data for three weeks. The founder chose monitoring over minting a `SYSTEM_USER` token, so this must warn loudly before it lapses.

**Files:**
- Modify: `lib/integrations/ads/meta.ts` (add `metaTokenStatus`)
- Modify: `app/api/integrations/ads/route.ts:13-23` (GET)
- Modify: `components/finance/marketing-panel.tsx` (`SyncStatus` type + a warning badge)

**Interfaces:**
- Produces: `metaTokenStatus(): Promise<MetaTokenStatus[]>` where
  `MetaTokenStatus = { label: string; type: string; valid: boolean; expiresAt: string | null; daysLeft: number | null }`.
  `expiresAt: null` / `daysLeft: null` means never expires (a system-user token).

- [ ] **Step 1: Add `metaTokenStatus` to `meta.ts`**

```ts
export type MetaTokenStatus = {
  label: string;
  type: string;
  valid: boolean;
  expiresAt: string | null; // null = never expires (SYSTEM_USER)
  daysLeft: number | null;
};

// Meta tokens die silently: a USER token expires on a fixed date and the sync
// simply starts returning nothing. The KSA token's predecessor lapsed on
// 2026-06-26 and cost three weeks of data before anyone noticed. SYSTEM_USER
// tokens (like Main's) never expire — that remains the real fix; this exists so
// the current USER token cannot lapse unannounced.
export async function metaTokenStatus(): Promise<MetaTokenStatus[]> {
  const out: MetaTokenStatus[] = [];
  for (const group of accountGroups()) {
    try {
      const qs = new URLSearchParams({ input_token: group.accessToken, access_token: group.accessToken });
      const res = await fetch(`${BASE}/debug_token?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      const d = json.data ?? {};
      const expiresAt = d.expires_at && d.expires_at > 0 ? new Date(d.expires_at * 1000) : null;
      out.push({
        label: group.label,
        type: String(d.type ?? "unknown"),
        valid: Boolean(d.is_valid),
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        daysLeft: expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000) : null,
      });
    } catch (e) {
      out.push({ label: group.label, type: "unknown", valid: false, expiresAt: null, daysLeft: null });
    }
  }
  return out;
}
```

- [ ] **Step 2: Surface it on the status route**

In `app/api/integrations/ads/route.ts`, import it and add to the GET payload:

```ts
import { metaConfigured, metaTokenStatus } from "@/lib/integrations/ads/meta";

export async function GET() {
  const [lastRun, metaTokens] = await Promise.all([
    AdSyncRunsRepository.getLatest(),
    metaConfigured() ? metaTokenStatus() : Promise.resolve([]),
  ]);
  return NextResponse.json({
    meta: metaConfigured(),
    google: googleAdsConfigured(),
    tiktok: tiktokConfigured(),
    snap: snapConfigured(),
    metaTokens,
    lastRun,
  });
}
```

- [ ] **Step 3: Warn in the panel**

In `components/finance/marketing-panel.tsx`, extend the `SyncStatus` type:

```ts
type MetaToken = { label: string; type: string; valid: boolean; expiresAt: string | null; daysLeft: number | null };

type SyncStatus = {
  meta: boolean;
  google: boolean;
  tiktok: boolean;
  snap: boolean;
  metaTokens?: MetaToken[];
  lastRun: {
    trigger: string;
    finished_at: string | null;
    platform_results: { platform: string; fetched: number; saved: number; error?: string }[];
  } | null;
};
```

Render a warning wherever the sync status badge is shown — an expiring or invalid token gets called out by name:

```tsx
{(status?.metaTokens ?? [])
  .filter((t) => !t.valid || (t.daysLeft !== null && t.daysLeft <= 30))
  .map((t) => (
    <div key={t.label} className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
      <XCircle className="h-3.5 w-3.5 shrink-0" />
      <span>
        Meta <strong>{t.label.toUpperCase()}</strong> token{" "}
        {!t.valid
          ? "is invalid — campaign data for this account has stopped."
          : `expires in ${t.daysLeft} day${t.daysLeft === 1 ? "" : "s"}. It's a ${t.type} token; a SYSTEM_USER token never expires.`}
      </span>
    </div>
  ))}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/ads/meta.ts app/api/integrations/ads/route.ts components/finance/marketing-panel.tsx
git commit -m "Warn before a Meta token expires instead of failing silently

The KSA token is a personal USER token expiring 2026-08-26; its
predecessor lapsed on 2026-06-26 and cost three weeks of data with no
signal. Surfaces token type and days-remaining via debug_token, warning
at 30 days. Main is SYSTEM_USER and never expires — still the real fix."
```

---

### Task 6: Funnel + honest ROAS in the summary API

**Files:**
- Modify: `app/api/ads/summary/route.ts:36-49` (store summary), `:8-13` (header comment)

**Interfaces:**
- Consumes: `AdInsightRow` funnel fields (Task 3).
- Produces: per-store `funnel`, `cost_per_purchase`, `pixel_roas`, `settled_roas` — consumed by Task 7.

- [ ] **Step 1: Extend the per-store summary**

In `app/api/ads/summary/route.ts`, replace the `stores` mapping (lines 36-49):

```ts
  const storesToShow = storeFilter === "ALL" ? STORES : [storeFilter];
  const stores = storesToShow.map((store) => {
    const rows = scopedInsights.filter((r) => r.store_id === store);
    const storeOrders = scopedOrders.filter((o) => o.store_id === store);
    const revenue = storeOrders.reduce((s, o) => s + Number(o.gross_aed || 0), 0);
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const purchases = rows.reduce((s, r) => s + r.conversions, 0);
    const pixelValue = rows.reduce((s, r) => s + r.conversion_value, 0);
    return {
      store,
      spend_aed: +spend.toFixed(2),
      impressions: rows.reduce((s, r) => s + r.impressions, 0),
      clicks: rows.reduce((s, r) => s + r.clicks, 0),
      conversions: +purchases.toFixed(2),
      conversion_value_aed: +pixelValue.toFixed(2),
      store_revenue_aed: +revenue.toFixed(2),
      order_count: storeOrders.length,
      funnel: {
        landing_page_views: rows.reduce((s, r) => s + r.landing_page_views, 0),
        view_content: rows.reduce((s, r) => s + r.view_content, 0),
        add_to_cart: rows.reduce((s, r) => s + r.add_to_cart, 0),
        initiate_checkout: rows.reduce((s, r) => s + r.initiate_checkout, 0),
        purchase: +purchases.toFixed(2),
      },
      cost_per_purchase_aed: purchases > 0 ? +(spend / purchases).toFixed(2) : null,
      // Two ROAS figures, never averaged into one. pixel_roas is Meta's own
      // attribution; settled_roas is money that actually reached the store.
      // They measure different things and the gap between them is the point.
      pixel_roas: spend > 0 ? +(pixelValue / spend).toFixed(2) : null,
      settled_roas: spend > 0 ? +(revenue / spend).toFixed(2) : null,
    };
  });
```

- [ ] **Step 2: Rewrite the header comment to record the reversal**

Replace the comment block on lines 8-13:

```ts
// GET /api/ads/summary?days=30&store=ALL — per-store ad spend/conversions
// (Meta/Google/TikTok/Snap) next to actual store revenue for the same
// window, plus a per-campaign breakdown for the marketing table.
//
// REVERSAL (2026-07-17, founder-approved): the 2026-07-15 spec forbade
// computing a "true ROAS" at all. The founder asked for one. We now return
// BOTH — pixel_roas (Meta's self-reported attribution) and settled_roas
// (real store revenue / spend) — each labeled by source, never averaged into
// one figure. The original caution was well-founded: this connector was
// overcounting conversions 8x and would have reported 28.55x against a real
// 4.76x. Showing both keeps that gap visible instead of hiding it in a mean.
// See docs/superpowers/specs/2026-07-17-meta-ads-correctness-design.md.
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/ads/summary/route.ts
git commit -m "Return funnel, cost-per-purchase, and both ROAS figures

Founder-approved reversal of the 2026-07-15 'never blend' decision: we
now return both pixel_roas and settled_roas, labeled by source and never
averaged. The original caution proved well-founded — the connector was
overcounting 8x and would have shown 28.55x against a real 4.76x — so
showing both keeps that gap visible rather than hiding it in a mean."
```

---

### Task 7: Funnel + dual ROAS in the marketing panel

**Files:**
- Modify: `components/finance/marketing-panel.tsx` (`StoreSummary` type, header comment, store cards)

**Interfaces:**
- Consumes: the Task 6 payload (`funnel`, `cost_per_purchase_aed`, `pixel_roas`, `settled_roas`).

- [ ] **Step 1: Extend the `StoreSummary` type**

```ts
type StoreSummary = {
  store: string;
  spend_aed: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value_aed: number;
  store_revenue_aed: number;
  order_count: number;
  funnel: {
    landing_page_views: number;
    view_content: number;
    add_to_cart: number;
    initiate_checkout: number;
    purchase: number;
  };
  cost_per_purchase_aed: number | null;
  pixel_roas: number | null;
  settled_roas: number | null;
};
```

- [ ] **Step 2: Rewrite the file header comment**

```tsx
/* Ad platform performance — campaign spend/conversions pulled from Meta,
   Google Ads, TikTok, and Snapchat (see lib/ad-sync.ts), shown per store next
   to actual store revenue for the same window.

   Two ROAS figures are shown side by side and never averaged into one:
   pixel ROAS is Meta's self-reported attribution, settled ROAS is money that
   actually reached the store. The gap between them is the signal — this
   connector was overcounting conversions 8x and would have reported 28.55x
   against a real 4.76x (founder-approved reversal of the 2026-07-15 spec's
   "never compute a true ROAS" rule; see
   docs/superpowers/specs/2026-07-17-meta-ads-correctness-design.md). */
```

- [ ] **Step 3: Render the funnel strip and both ROAS figures**

Inside the per-store card, after the existing spend/revenue figures:

```tsx
{(() => {
  const f = s.funnel;
  const stages: { label: string; value: number }[] = [
    { label: "Landing", value: f.landing_page_views },
    { label: "Viewed", value: f.view_content },
    { label: "Add to cart", value: f.add_to_cart },
    { label: "Checkout", value: f.initiate_checkout },
    { label: "Purchase", value: f.purchase },
  ];
  return (
    <div className="mt-4 border-t border-border/50 pt-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        {stages.map((stage, idx) => {
          const prev = idx > 0 ? stages[idx - 1].value : null;
          const drop = prev && prev > 0 ? 1 - stage.value / prev : null;
          return (
            <div key={stage.label} className="min-w-[72px]">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{stage.label}</div>
              <div className="text-sm font-semibold tabular-nums">{num(stage.value)}</div>
              {drop !== null && (
                <div className={drop >= 0.9 ? "text-[10px] text-amber-600 dark:text-amber-500" : "text-[10px] text-muted-foreground"}>
                  −{(drop * 100).toFixed(0)}%
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <span className="text-muted-foreground">
          Cost / purchase{" "}
          <strong className="text-foreground tabular-nums">
            {s.cost_per_purchase_aed !== null ? aed(s.cost_per_purchase_aed) : "—"}
          </strong>
        </span>
        <span className="text-muted-foreground">
          ROAS (Meta pixel){" "}
          <strong className="text-foreground tabular-nums">
            {s.pixel_roas !== null ? `${s.pixel_roas.toFixed(2)}x` : "—"}
          </strong>
        </span>
        <span className="text-muted-foreground">
          ROAS (settled revenue){" "}
          <strong className="text-foreground tabular-nums">
            {s.settled_roas !== null ? `${s.settled_roas.toFixed(2)}x` : "—"}
          </strong>
        </span>
      </div>
    </div>
  );
})()}
```

The `−90%+` drop-offs highlight in amber on purpose: on live data the view_content → add_to_cart step drops 92%, and that is the finding worth surfacing.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify end-to-end against the live API**

Run:

```bash
set -a && source .env && set +a && npm run dev
```

Then in a second shell:

```bash
curl -s -X POST localhost:3000/api/integrations/ads -H 'Content-Type: application/json' -d '{"days":7}' | head -40
curl -s 'localhost:3000/api/ads/summary?days=30&store=WOO' | head -40
```

Expected:
- The POST returns `fetched > 0` and `saved > 0` for `meta` — the first successful Meta sync this project has ever had.
- It may also carry an `error` mentioning `act_3216294595244505` if the Business Manager grant isn't done. **That is expected and correct** — the other accounts still saved.
- The summary returns a `pixel_roas` near **4.76** for a 30-day WOO window, **not ~28**. If you see ~28, the alias dedupe is not working — stop and fix before proceeding.
- `funnel.purchase` should be in the hundreds (≈653/30d), not thousands.

- [ ] **Step 6: Commit**

```bash
git add components/finance/marketing-panel.tsx
git commit -m "Show the purchase funnel and both ROAS figures in the panel

Funnel strip with per-stage drop-off (90%+ drops flagged amber — live
data drops 92% at view_content -> add_to_cart, the biggest weak spot),
cost per purchase, and pixel vs settled ROAS side by side."
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Shared account-ID normalizer used by both `meta.ts` and `ads-accounts.ts` | 1 |
| `act_3216294595244505` → WOO | 1 (Step 9) |
| Canonical action types, never sum | 2 |
| Funnel capture + 4 `ad_insights` columns | 3 |
| Per-account error isolation | 4 |
| Token expiry monitoring | 5 |
| Both ROAS labeled by source; reversal documented | 6, 7 |
| Test: purchase dedupe 653 not 5,224 | 2 |
| Test: value dedupe | 2 |
| Test: alias fallback + absent → 0 | 2 |
| Test: funnel extraction | 2 (stage picker), 4 (end-to-end) |
| Test: ID normalization + `storeForAccount` desync guard | 1 |
| Test: error isolation | 4 |

All six spec test requirements are covered. Out-of-scope items (TikTok ID, Snap, ad-level depth, campaign actions, AI suggestions) correctly have no tasks.

**Placeholder scan:** No TBD/TODO. Every code step carries complete code. Every command has expected output.

**Type consistency:** `normalizeAdAccountId` (Task 1) is used identically in Tasks 1-4. `pickCanonical`/`FUNNEL_STAGES` (Task 2) are consumed with matching signatures in Tasks 3-4. `PlatformFetchResult` (Task 4) is produced by all four connectors and consumed once in `ad-sync.ts`. Optional camelCase funnel fields on `NormalizedInsight` (Task 3) map to snake_case columns via `?? 0` in the repository, and the summary route reads the snake_case `AdInsightRow` fields. `MetaTokenStatus` (Task 5) matches the `MetaToken` type in the panel.

**Fixed during review:** Task 3 originally carried a `fetchInsights` test asserting the `{ insights }` shape that Task 4 introduces — it would have failed its own TDD gate. That test now lives in Task 4, and Task 3 leans on Task 2's proven stage picker plus a typecheck. Every task's suite is green at its own commit.
