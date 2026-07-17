import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCanonical, FUNNEL_STAGES, fetchInsights } from "@/lib/integrations/ads/meta";

// Real payload shape from act_526983864499176, last 30 days (captured
// 2026-07-17). Meta reports ONE set of 653 purchases under EIGHT aliases.
// Summing them yields 5,224 — the production bug this file exists to prevent.
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
