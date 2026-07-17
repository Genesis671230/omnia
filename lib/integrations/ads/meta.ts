// Meta Marketing API (Graph API) — covers both Facebook and Instagram
// campaigns under one ad-account insights call. Two account groups are
// configured: "Main" (2 ad accounts, targets the WooCommerce/.com site) and
// "KSA" (1 ad account, targets the Shopify KSA store) — see lib/ads-accounts.ts
// for the account -> store mapping.
//
// Reference: https://developers.facebook.com/docs/marketing-api/insights
// Pinned API version below; verify field names still match if Meta has
// rolled a new version by the time this runs live.
//
// "actions"/"action_values" are Meta's generic conversion-event arrays, keyed
// by action_type (e.g. "omni_purchase", "onsite_web_purchase"). Meta reports
// the SAME conversion under many aliases, so we take the first canonical
// alias present and never sum them — see FUNNEL_STAGES below for why.

import type { AdPlatform, DateRange, NormalizedInsight, PlatformFetchResult } from "./types";
import { normalizeAdAccountId } from "./account-id";

const API_VERSION = "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

type MetaAccountGroup = { label: string; accessToken: string; adAccountIds: string[] };

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

export function metaConfigured(): boolean {
  return accountGroups().length > 0;
}

type MetaAction = { action_type: string; value: string };
type MetaInsightRow = {
  campaign_id: string;
  campaign_name: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
  account_currency?: string;
};

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

async function fetchAdAccountInsights(
  adAccountId: string,
  accessToken: string,
  range: DateRange,
): Promise<MetaInsightRow[]> {
  const fields = [
    "campaign_id", "campaign_name", "spend", "impressions", "clicks",
    "actions", "action_values", "account_currency",
  ].join(",");
  const timeRange = JSON.stringify({ since: range.from, until: range.to });
  const qs = new URLSearchParams({
    level: "campaign",
    time_increment: "1",
    fields,
    time_range: timeRange,
    access_token: accessToken,
  });

  const rows: MetaInsightRow[] = [];
  const urls: string[] = [`${BASE}/act_${adAccountId}/insights?${qs.toString()}`];
  while (urls.length > 0) {
    const currentUrl: string = urls.shift()!;
    const res: Response = await fetch(currentUrl, { cache: "no-store" });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Meta API HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const json: { data?: MetaInsightRow[]; paging?: { next?: string } } = await res.json();
    rows.push(...(json.data ?? []));
    if (json.paging?.next) urls.push(json.paging.next);
  }
  return rows;
}

// Campaign status isn't in the insights payload — fetched separately, best
// effort. If it fails (rate limit, permission), we still return spend data
// with status "unknown" rather than losing the whole account's numbers.
async function fetchCampaignStatuses(adAccountId: string, accessToken: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const qs = new URLSearchParams({ fields: "id,effective_status", limit: "500", access_token: accessToken });
    const res = await fetch(`${BASE}/act_${adAccountId}/campaigns?${qs.toString()}`, { cache: "no-store" });
    if (!res.ok) return map;
    const json = await res.json();
    for (const c of json.data ?? []) map.set(c.id, String(c.effective_status || "unknown").toLowerCase());
  } catch {
    // best effort only
  }
  return map;
}

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
