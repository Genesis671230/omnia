import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCanonical, FUNNEL_STAGES } from "@/lib/integrations/ads/meta";

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
