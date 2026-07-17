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
// by action_type (e.g. "omni_purchase", "onsite_web_purchase"). We sum every
// action_type containing "purchase" as the pixel-conversion signal — this is
// deliberately inclusive since Meta's exact action_type naming varies by
// account/pixel setup and there is no single canonical "the" purchase type.

import type { AdPlatform, DateRange, NormalizedInsight } from "./types";
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

function sumPurchaseActions(actions: MetaAction[] | undefined): number {
  if (!actions) return 0;
  return actions
    .filter((a) => a.action_type.toLowerCase().includes("purchase"))
    .reduce((s, a) => s + Number(a.value || 0), 0);
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

export async function fetchInsights(range: DateRange): Promise<NormalizedInsight[]> {
  const platform: AdPlatform = "meta";
  const out: NormalizedInsight[] = [];

  for (const group of accountGroups()) {
    for (const adAccountId of group.adAccountIds) {
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
          conversions: sumPurchaseActions(r.actions),
          conversionValue: sumPurchaseActions(r.action_values),
        });
      }
    }
  }
  return out;
}
