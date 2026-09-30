// Meta Ads explorer — campaigns → ad sets → ads with their creatives and
// performance, plus the account's day-by-day, hour-of-day and age × gender
// breakdowns, read live from the Graph API for a date range.
//
// One ad-level insights call carries every ad that delivered in the range;
// ad sets and campaigns are summed from their ads (each ad's conversions are
// already de-duplicated through FUNNEL_STAGES, so the sums are safe). The
// entities' own settings (status, budget, targeting, creative) come from
// batched ?ids= lookups. Running ads with no delivery yet are included too.
//
// Cached 15 minutes per range: a page view is ~8 Graph calls per account.

import { toAed } from "@/lib/fx";
import { storeForAccount } from "@/lib/ads-accounts";
import { accountGroups, FUNNEL_STAGES, pickCanonical, type MetaAction } from "./meta";

const BASE = "https://graph.facebook.com/v21.0";
const CACHE_MS = 15 * 60 * 1000;

export type AdMetrics = {
  spend: number; impressions: number; reach: number; clicks: number; linkClicks: number;
  landingPageViews: number; viewContent: number; addToCart: number; checkout: number; purchases: number; value: number;
  ctr: number | null; cpc: number | null; cpm: number | null; cpa: number | null; roas: number | null;
};

type Row = {
  spend?: string; impressions?: string; reach?: string; clicks?: string; inline_link_clicks?: string;
  actions?: MetaAction[]; action_values?: MetaAction[];
};

const emptyMetrics = (): AdMetrics => ({
  spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, landingPageViews: 0, viewContent: 0,
  addToCart: 0, checkout: 0, purchases: 0, value: 0, ctr: null, cpc: null, cpm: null, cpa: null, roas: null,
});

function metricsFrom(r: Row, currency: string): AdMetrics {
  const m = emptyMetrics();
  m.spend = toAed(Number(r.spend) || 0, currency);
  m.impressions = Number(r.impressions) || 0;
  m.reach = Number(r.reach) || 0;
  m.clicks = Number(r.clicks) || 0;
  m.linkClicks = Number(r.inline_link_clicks) || 0;
  m.landingPageViews = pickCanonical(r.actions, FUNNEL_STAGES.landing_page_views);
  m.viewContent = pickCanonical(r.actions, FUNNEL_STAGES.view_content);
  m.addToCart = pickCanonical(r.actions, FUNNEL_STAGES.add_to_cart);
  m.checkout = pickCanonical(r.actions, FUNNEL_STAGES.initiate_checkout);
  m.purchases = pickCanonical(r.actions, FUNNEL_STAGES.purchase);
  m.value = toAed(pickCanonical(r.action_values, FUNNEL_STAGES.purchase), currency);
  return m;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Sums (reach is not additive across ads — kept as the max, a lower bound). */
export function addMetrics(a: AdMetrics, b: AdMetrics): AdMetrics {
  return {
    ...a,
    spend: a.spend + b.spend, impressions: a.impressions + b.impressions, reach: Math.max(a.reach, b.reach),
    clicks: a.clicks + b.clicks, linkClicks: a.linkClicks + b.linkClicks, landingPageViews: a.landingPageViews + b.landingPageViews,
    viewContent: a.viewContent + b.viewContent, addToCart: a.addToCart + b.addToCart, checkout: a.checkout + b.checkout,
    purchases: a.purchases + b.purchases, value: a.value + b.value,
  };
}

export function withRates(m: AdMetrics): AdMetrics {
  return {
    ...m,
    spend: r2(m.spend), value: r2(m.value),
    ctr: m.impressions ? r2((m.linkClicks / m.impressions) * 100) : null,
    cpc: m.linkClicks ? r2(m.spend / m.linkClicks) : null,
    cpm: m.impressions ? r2((m.spend / m.impressions) * 1000) : null,
    cpa: m.purchases ? r2(m.spend / m.purchases) : null,
    roas: m.spend ? r2(m.value / m.spend) : null,
  };
}

export type ExplorerCampaign = {
  id: string; accountId: string; store: string; name: string; status: string; objective: string;
  dailyBudget: number | null; lifetimeBudget: number | null; startTime: string | null; createdTime: string | null;
  metrics: AdMetrics;
};
export type ExplorerAdSet = {
  id: string; campaignId: string; name: string; status: string; optimizationGoal: string; bidStrategy: string;
  dailyBudget: number | null; lifetimeBudget: number | null; startTime: string | null; endTime: string | null;
  audience: string; metrics: AdMetrics;
};
export type ExplorerAd = {
  id: string; adsetId: string; campaignId: string; name: string; status: string; createdTime: string | null;
  creative: { id: string | null; type: string; title: string; body: string; imageUrl: string | null; thumbnailUrl: string | null; cta: string };
  metrics: AdMetrics;
};
export type ExplorerData = {
  range: { from: string; to: string };
  accounts: { id: string; name: string; store: string; currency: string; timezone: string; error?: string }[];
  campaigns: ExplorerCampaign[];
  adsets: ExplorerAdSet[];
  ads: ExplorerAd[];
  daily: ({ date: string } & AdMetrics)[];
  hourly: ({ hour: number } & AdMetrics)[];
  demographics: ({ age: string; gender: string } & AdMetrics)[];
  fetchedAt: string;
};

class GraphError extends Error {}

async function graph<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.error) throw new GraphError(json?.error?.message ?? `Meta HTTP ${res.status}`);
  return json as T;
}

/** Every page of an edge (follows paging.next, which carries the token). */
async function all<T>(path: string, params: Record<string, string>, token: string): Promise<T[]> {
  let url: string | null = `${BASE}/${path}?${new URLSearchParams({ ...params, access_token: token, limit: params.limit ?? "500" })}`;
  const out: T[] = [];
  for (let guard = 0; url && guard < 20; guard++) {
    const page: { data?: T[]; paging?: { next?: string } } = await graph(url);
    out.push(...(page.data ?? []));
    url = page.paging?.next ?? null;
  }
  return out;
}

/** Objects by id, 50 per call (the Graph limit for ?ids=). */
async function byIds<T>(ids: string[], fields: string, token: string): Promise<Map<string, T>> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  const pages = await Promise.all(chunks.map((chunk) =>
    graph<Record<string, T>>(`${BASE}/?${new URLSearchParams({ ids: chunk.join(","), fields, access_token: token })}`)));
  return new Map(pages.flatMap((p) => Object.entries(p)));
}

const money = (v: string | undefined, currency: string) => (v ? r2(toAed(Number(v) / 100, currency)) : null); // budgets are in minor units

function audienceOf(t: { age_min?: number; age_max?: number; genders?: number[]; geo_locations?: { countries?: string[]; cities?: { name: string }[] } } | undefined): string {
  if (!t) return "";
  const gender = !t.genders?.length ? "All genders" : t.genders.includes(1) && t.genders.includes(2) ? "All genders" : t.genders.includes(2) ? "Women" : "Men";
  const age = `${t.age_min ?? 18}–${t.age_max ?? 65}${(t.age_max ?? 65) >= 65 ? "+" : ""}`;
  const geo = [...(t.geo_locations?.countries ?? []), ...(t.geo_locations?.cities ?? []).map((c) => c.name)].slice(0, 4).join(", ");
  return [gender, age, geo].filter(Boolean).join(" · ");
}

const INSIGHT_FIELDS = "spend,impressions,reach,clicks,inline_link_clicks,actions,action_values";

async function fetchAccount(bareId: string, token: string, from: string, to: string) {
  // Account ids are stored bare (lib/integrations/ads/account-id.ts); Graph
  // paths need the act_ prefix. The store mapping takes the bare id.
  const accountId = `act_${bareId.replace(/^act_/, "")}`;
  const timeRange = JSON.stringify({ since: from, until: to });
  const acct = await graph<{ name: string; currency: string; timezone_name: string }>(
    `${BASE}/${accountId}?${new URLSearchParams({ fields: "name,currency,timezone_name", access_token: token })}`,
  );
  const cur = acct.currency || "AED";

  type AdRow = Row & { ad_id: string; ad_name: string; adset_id: string; campaign_id: string };
  const [adRows, activeAds, daily, hourly, demo] = await Promise.all([
    all<AdRow>(`${accountId}/insights`, { level: "ad", time_range: timeRange, fields: `ad_id,ad_name,adset_id,campaign_id,${INSIGHT_FIELDS}` }, token),
    all<{ id: string }>(`${accountId}/ads`, { fields: "id", filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]) }, token),
    all<Row & { date_start: string }>(`${accountId}/insights`, { level: "account", time_increment: "1", time_range: timeRange, fields: INSIGHT_FIELDS }, token),
    all<Row & { hourly_stats_aggregated_by_advertiser_time_zone: string }>(`${accountId}/insights`, { level: "account", breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone", time_range: timeRange, fields: INSIGHT_FIELDS }, token),
    all<Row & { age: string; gender: string }>(`${accountId}/insights`, { level: "account", breakdowns: "age,gender", time_range: timeRange, fields: INSIGHT_FIELDS }, token),
  ]);

  const adIds = [...new Set([...adRows.map((r) => r.ad_id), ...activeAds.map((a) => a.id)])];
  type AdMeta = { id: string; name: string; effective_status: string; adset_id: string; campaign_id: string; created_time?: string;
    creative?: { id: string; title?: string; body?: string; object_type?: string; image_url?: string; thumbnail_url?: string; call_to_action_type?: string } };
  const adMeta = await byIds<AdMeta>(adIds,
    "id,name,effective_status,adset_id,campaign_id,created_time,creative.thumbnail_width(480).thumbnail_height(480){id,title,body,object_type,image_url,thumbnail_url,call_to_action_type}", token);

  const adsetIds = [...new Set([...adMeta.values()].map((a) => a.adset_id))];
  const campaignIds = [...new Set([...adMeta.values()].map((a) => a.campaign_id))];
  type AdSetMeta = { id: string; name: string; effective_status: string; campaign_id: string; daily_budget?: string; lifetime_budget?: string;
    optimization_goal?: string; bid_strategy?: string; start_time?: string; end_time?: string; targeting?: Parameters<typeof audienceOf>[0] };
  type CampaignMeta = { id: string; name: string; effective_status: string; objective?: string; daily_budget?: string; lifetime_budget?: string; start_time?: string; created_time?: string };
  const [adsetMeta, campaignMeta] = await Promise.all([
    byIds<AdSetMeta>(adsetIds, "id,name,effective_status,campaign_id,daily_budget,lifetime_budget,optimization_goal,bid_strategy,start_time,end_time,targeting{age_min,age_max,genders,geo_locations{countries,cities}}", token),
    byIds<CampaignMeta>(campaignIds, "id,name,effective_status,objective,daily_budget,lifetime_budget,start_time,created_time", token),
  ]);

  const adMetrics = new Map<string, AdMetrics>();
  for (const r of adRows) adMetrics.set(r.ad_id, addMetrics(adMetrics.get(r.ad_id) ?? emptyMetrics(), metricsFrom(r, cur)));

  const ads: ExplorerAd[] = adIds.flatMap((id) => {
    const a = adMeta.get(id);
    if (!a) return [];
    const c = a.creative;
    return [{
      id, adsetId: a.adset_id, campaignId: a.campaign_id, name: a.name, status: a.effective_status, createdTime: a.created_time ?? null,
      creative: {
        id: c?.id ?? null, type: c?.object_type ?? "", title: c?.title ?? "", body: c?.body ?? "",
        imageUrl: c?.image_url ?? null, thumbnailUrl: c?.thumbnail_url ?? null, cta: c?.call_to_action_type ?? "",
      },
      metrics: withRates(adMetrics.get(id) ?? emptyMetrics()),
    }];
  });

  const sumBy = (key: (a: ExplorerAd) => string) => {
    const m = new Map<string, AdMetrics>();
    for (const a of ads) m.set(key(a), addMetrics(m.get(key(a)) ?? emptyMetrics(), a.metrics));
    return m;
  };
  const adsetSums = sumBy((a) => a.adsetId);
  const campaignSums = sumBy((a) => a.campaignId);
  const store = storeForAccount("meta", bareId);

  const adsets: ExplorerAdSet[] = adsetIds.flatMap((id) => {
    const s = adsetMeta.get(id);
    return s ? [{
      id, campaignId: s.campaign_id, name: s.name, status: s.effective_status, optimizationGoal: s.optimization_goal ?? "",
      bidStrategy: s.bid_strategy ?? "", dailyBudget: money(s.daily_budget, cur), lifetimeBudget: money(s.lifetime_budget, cur),
      startTime: s.start_time ?? null, endTime: s.end_time ?? null, audience: audienceOf(s.targeting),
      metrics: withRates(adsetSums.get(id) ?? emptyMetrics()),
    }] : [];
  });
  const campaigns: ExplorerCampaign[] = campaignIds.flatMap((id) => {
    const c = campaignMeta.get(id);
    return c ? [{
      id, accountId, store, name: c.name, status: c.effective_status, objective: c.objective ?? "",
      dailyBudget: money(c.daily_budget, cur), lifetimeBudget: money(c.lifetime_budget, cur),
      startTime: c.start_time ?? null, createdTime: c.created_time ?? null,
      metrics: withRates(campaignSums.get(id) ?? emptyMetrics()),
    }] : [];
  });

  return {
    account: { id: accountId, name: acct.name, store, currency: cur, timezone: acct.timezone_name },
    campaigns, adsets, ads,
    daily: daily.map((d) => ({ date: d.date_start, m: metricsFrom(d, cur) })),
    hourly: hourly.map((h) => ({ hour: Number(h.hourly_stats_aggregated_by_advertiser_time_zone.slice(0, 2)), m: metricsFrom(h, cur) })),
    demographics: demo.map((d) => ({ age: d.age, gender: d.gender, m: metricsFrom(d, cur) })),
  };
}

const cache = new Map<string, { at: number; value: ExplorerData }>();

export async function fetchMetaExplorer(from: string, to: string, { fresh = false } = {}): Promise<ExplorerData> {
  const key = `${from}|${to}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const out: ExplorerData = { range: { from, to }, accounts: [], campaigns: [], adsets: [], ads: [], daily: [], hourly: [], demographics: [], fetchedAt: new Date().toISOString() };
  const daily = new Map<string, AdMetrics>();
  const hourly = new Map<number, AdMetrics>();
  const demo = new Map<string, AdMetrics>();

  // Accounts in parallel; each one's failure stays its own.
  const jobs = accountGroups().flatMap((group) => group.adAccountIds.map((accountId) => ({ accountId, token: group.accessToken })));
  const results = await Promise.all(jobs.map(async ({ accountId, token }) => {
    try {
      return { ok: true as const, a: await fetchAccount(accountId, token, from, to) };
    } catch (e) {
      return { ok: false as const, accountId, error: (e as Error).message };
    }
  }));
  for (const r of results) {
    if (!r.ok) {
      out.accounts.push({ id: r.accountId, name: r.accountId, store: storeForAccount("meta", r.accountId), currency: "", timezone: "", error: r.error });
      continue;
    }
    const a = r.a;
    out.accounts.push(a.account);
    out.campaigns.push(...a.campaigns);
    out.adsets.push(...a.adsets);
    out.ads.push(...a.ads);
    for (const d of a.daily) daily.set(d.date, addMetrics(daily.get(d.date) ?? emptyMetrics(), d.m));
    for (const h of a.hourly) hourly.set(h.hour, addMetrics(hourly.get(h.hour) ?? emptyMetrics(), h.m));
    for (const d of a.demographics) { const k = `${d.age}|${d.gender}`; demo.set(k, addMetrics(demo.get(k) ?? emptyMetrics(), d.m)); }
  }
  out.daily = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, m]) => ({ date, ...withRates(m) }));
  out.hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, ...withRates(hourly.get(hour) ?? emptyMetrics()) }));
  out.demographics = [...demo.entries()].map(([k, m]) => { const [age, gender] = k.split("|"); return { age, gender, ...withRates(m) }; });
  out.campaigns.sort((a, b) => b.metrics.spend - a.metrics.spend);
  out.adsets.sort((a, b) => b.metrics.spend - a.metrics.spend);
  out.ads.sort((a, b) => b.metrics.spend - a.metrics.spend);

  // Cached even with a failed account (the KSA token can stay expired for
  // weeks); the failure travels in `accounts[].error` and shows on the page.
  cache.set(key, { at: Date.now(), value: out });
  return out;
}
