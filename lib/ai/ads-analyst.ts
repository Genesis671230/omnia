// AI ads analyst. Reads the whole ad account for a range (campaigns → ad sets
// → ads with creatives, daily / hourly / age × gender), the store's real sales
// for the same days (totals, top SKUs, when orders come in), the pixel check,
// and its own previous report — and writes what is happening, what to scale,
// what to fix or pause, who to target, when, and which creatives work.
//
// Every figure it may use is in the input; it recommends, it never changes a
// campaign. Each report is stored (ad_analyst_reports) so the next one can
// say what changed since.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
// The SDK helper is built on zod v4; the project pins zod 3.25, which ships v4 at this path.
import { z } from "zod/v4";
import { supabase } from "@/lib/supabase";
import type { AdMetrics, ExplorerData } from "@/lib/integrations/ads/meta-explorer";
import type { loadSalesContext } from "@/lib/orders/sales-context.server";
import type { trackingCheck } from "@/lib/integrations/ads/tracking-check";

const MODEL = "claude-opus-5";
const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

const Item = z.object({
  level: z.enum(["campaign", "adset", "ad"]),
  id: z.string(),
  name: z.string(),
  why: z.string().describe("The figures behind it, from the input."),
  action: z.string().describe("What to do in Ads Manager, concretely."),
});

export const AdsReport = z.object({
  headline: z.string().describe("One sentence: the state of the account this period."),
  status: z.enum(["healthy", "watch", "act"]),
  happening: z.array(z.object({ title: z.string(), detail: z.string() })).describe("3–5 things happening now, most important first."),
  since_last: z.string().nullable().describe("What changed since the previous report, or null when there is none."),
  scale: z.array(Item).describe("Winners worth more budget."),
  fix_or_pause: z.array(Item).describe("Spend that isn't paying back."),
  audience: z.object({ best: z.string(), detail: z.string(), suggestion: z.string() }),
  timing: z.object({ peak: z.string(), detail: z.string(), suggestion: z.string() }),
  creatives: z.object({ best: z.array(z.object({ id: z.string(), name: z.string(), why: z.string() })), pattern: z.string() }),
  products: z.object({ detail: z.string(), suggestion: z.string() }),
  tracking: z.string().nullable().describe("Only if the pixel/tag check shows a problem."),
  next_checks: z.array(z.string()),
});
export type AdsReport = z.infer<typeof AdsReport>;

const SYSTEM = `You are a senior performance marketer reviewing a Meta ad account for a UAE/GCC jewellery e-commerce brand (base currency AED). You get the account's campaigns, ad sets and ads with creatives and results for a date range, the account's day-by-day, hour-of-day (Dubai time) and age × gender results, the store's real sales for the same days (orders, sales, top products, when orders come in), the pixel/tag check, and your previous report if there is one.

Know the numbers you are reading:
- Purchases, purchase value and ROAS are what Meta's pixel attributes to ads (7-day click / 1-day view). The store's sales are every real order, ads or not. Never add them together; compare them.
- CTR here is link clicks ÷ impressions. CPA is spend ÷ pixel purchases.
- A campaign's start date tells you how long it has been learning; under ~7 days or under ~50 conversions, judge it cautiously.

Write for the founder, who acts in Ads Manager. Rules:
- Every number you state must come from the input. If you can't support a number, don't give one.
- Name campaigns, ad sets and ads exactly as given, with their ids, so they can be found.
- Scale = strong ROAS/CPA with enough spend to trust it. Fix or pause = meaningful spend with weak results; say whether to pause, cut budget, refresh the creative or narrow the audience.
- Audience: say which gender and ages click and buy best and at what cost, and how to target (e.g. a women 25–44 ad set).
- Timing: compare the ads' best hours with the hours real orders arrive; suggest scheduling or budget pacing only if the data supports it.
- Creatives: what the best ones have in common (format, hook, copy language, offer).
- Products: relate top-selling products to what the ads push; suggest creatives for strong sellers that lack ads.
- If there is a previous report, say what changed since it in since_last.
- Plain, short sentences. No marketing jargon beyond the metric names.`;

const pick = (m: AdMetrics) => ({
  spend: m.spend, impressions: m.impressions, linkClicks: m.linkClicks, ctr: m.ctr, cpc: m.cpc,
  addToCart: m.addToCart, checkout: m.checkout, purchases: m.purchases, value: m.value, roas: m.roas, cpa: m.cpa,
});

/** The compact input: large enough to reason over, small enough to stay cheap. */
export function analystInput(
  x: ExplorerData,
  sales: Awaited<ReturnType<typeof loadSalesContext>>,
  tracking: Awaited<ReturnType<typeof trackingCheck>>,
  previous: { created_at: string; report: AdsReport } | null,
) {
  const total = x.daily.reduce(
    (t, d) => ({ spend: t.spend + d.spend, purchases: t.purchases + d.purchases, value: t.value + d.value, linkClicks: t.linkClicks + d.linkClicks, impressions: t.impressions + d.impressions, addToCart: t.addToCart + d.addToCart }),
    { spend: 0, purchases: 0, value: 0, linkClicks: 0, impressions: 0, addToCart: 0 },
  );
  const adsWithSpend = x.ads.filter((a) => a.metrics.spend > 0);
  const creativeOf = (a: ExplorerData["ads"][number]) => ({ type: a.creative.type, title: a.creative.title, body: a.creative.body.slice(0, 160), cta: a.creative.cta });
  return {
    range: x.range,
    accounts: x.accounts.map((a) => ({ name: a.name, store: a.store, error: a.error ?? null })),
    totals: { ...total, roas: total.spend ? +(total.value / total.spend).toFixed(2) : null, cpa: total.purchases ? +(total.spend / total.purchases).toFixed(2) : null },
    daily: x.daily.map((d) => ({ date: d.date, spend: d.spend, purchases: d.purchases, value: d.value, roas: d.roas, ctr: d.ctr })),
    hourly: x.hourly.map((h) => ({ hour: h.hour, spend: h.spend, linkClicks: h.linkClicks, purchases: h.purchases, value: h.value })),
    audience: x.demographics.filter((d) => d.spend > 0).map((d) => ({ age: d.age, gender: d.gender, ...pick(d) })),
    campaigns: x.campaigns.slice(0, 20).map((c) => ({ id: c.id, name: c.name, status: c.status, objective: c.objective, started: c.startTime, dailyBudget: c.dailyBudget, ...pick(c.metrics) })),
    adsets: x.adsets.slice(0, 30).map((s) => ({ id: s.id, campaignId: s.campaignId, name: s.name, status: s.status, audience: s.audience, goal: s.optimizationGoal, dailyBudget: s.dailyBudget, started: s.startTime, ...pick(s.metrics) })),
    topAdsBySpend: adsWithSpend.slice(0, 15).map((a) => ({ id: a.id, name: a.name, status: a.status, adsetId: a.adsetId, created: a.createdTime, creative: creativeOf(a), ...pick(a.metrics) })),
    bestAdsByRoas: [...adsWithSpend].filter((a) => a.metrics.spend >= 150).sort((a, b) => (b.metrics.roas ?? 0) - (a.metrics.roas ?? 0)).slice(0, 8)
      .map((a) => ({ id: a.id, name: a.name, creative: creativeOf(a), ...pick(a.metrics) })),
    weakAds: adsWithSpend.filter((a) => a.metrics.spend >= 300 && (a.metrics.roas ?? 0) < 1).slice(0, 8).map((a) => ({ id: a.id, name: a.name, status: a.status, ...pick(a.metrics) })),
    runningAds: x.ads.filter((a) => a.status === "ACTIVE").length,
    store: {
      totals: sales.totals, sites: sales.sites,
      topProducts: sales.topSkus.map((s) => ({ title: s.title, units: s.units, revenue: s.revenue, trend: s.trend, stock: s.stock })),
      ordersPeak: sales.timeOfDay.peak,
    },
    tracking: {
      pixels: tracking.pixels.map((p) => ({ name: p.name, hoursSinceFired: p.hoursSinceFired })),
      siteTags: tracking.sites.map((s) => ({ site: s.site, tags: s.tags, error: s.error ?? null })),
    },
    previousReport: previous ? { at: previous.created_at, headline: previous.report.headline, happening: previous.report.happening, scale: previous.report.scale, fix_or_pause: previous.report.fix_or_pause } : null,
  };
}

export async function latestReports(limit = 5) {
  const { data, error } = await supabase
    .from("ad_analyst_reports")
    .select("id, created_at, range_from, range_to, model, report, snapshot")
    .eq("tenant_id", TENANT)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`ad_analyst_reports read failed: ${error.message}`);
  return (data ?? []) as { id: string; created_at: string; range_from: string; range_to: string; model: string; report: AdsReport; snapshot: Record<string, unknown> }[];
}

export class AnalystError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function runAdsAnalyst(input: ReturnType<typeof analystInput>) {
  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(AdsReport) },
    system: SYSTEM,
    messages: [{ role: "user", content: `Ad account review input:\n${JSON.stringify(input)}` }],
  });
  if (response.stop_reason === "refusal") throw new AnalystError("The model declined to review this account.", 422);
  if (!response.parsed_output) throw new AnalystError(`No review returned (stop reason: ${response.stop_reason}).`, 502);

  const report = response.parsed_output;
  const snapshot = { totals: input.totals, store: input.store.totals, runningAds: input.runningAds };
  const { data, error } = await supabase
    .from("ad_analyst_reports")
    .insert({ tenant_id: TENANT, range_from: input.range.from, range_to: input.range.to, model: response.model, report, snapshot })
    .select("id, created_at")
    .single();
  if (error) throw new Error(`ad_analyst_reports insert failed: ${error.message}`);
  return { id: data.id as string, created_at: data.created_at as string, model: response.model, report };
}
