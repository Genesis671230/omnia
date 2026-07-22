import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { AdInsightsRepository } from "@/lib/repositories/ad-insights.repository";
import { ZohoRepository } from "@/lib/repositories/zoho.repository";
import { aggregateCampaigns, runInsightRules, type InsightFact, type RulesInput } from "@/lib/insights/rules";

export const runtime = "nodejs";
export const maxDuration = 60;

/* GET /api/insights?days=30&store=All&refresh=0
   Hybrid insight engine behind the dashboard's insight rail. Deterministic
   rules (lib/insights/rules.ts) detect the facts — every number the UI shows
   lives in fact.metrics. One Haiku call rephrases each fact into a founder-
   friendly headline/why/recommendation; if the call fails or no API key is
   set, the deterministic templates ship instead. Runs are cached in
   insight_runs (30 min) so page loads stay instant and AI cost is bounded. */

const CACHE_MINUTES = 30;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

export type InsightCard = {
  fact_id: string;
  headline: string;
  why: string;
  recommendation: string;
};

const cancelled = new Set(["voided", "refunded", "cancelled"]);

async function gatherRulesInput(days: number, store: string): Promise<RulesInput> {
  const now = Date.now();
  const fromIso = new Date(now - days * 86_400_000).toISOString();
  const prevFromIso = new Date(now - 2 * days * 86_400_000).toISOString();
  const fromDate = fromIso.slice(0, 10);
  const toDate = new Date(now).toISOString().slice(0, 10);
  const storeParam = store === "All" ? null : store;

  const [ordersTwoWindows, counts, adRows, zohoItems, bankLinesRes, reconRes] = await Promise.all([
    OrdersRepository.listInWindow({ from: prevFromIso, store: storeParam }),
    OrdersRepository.getOrderCounts({ store: storeParam }),
    AdInsightsRepository.listInsights(fromDate, toDate),
    ZohoRepository.listItems().catch(() => []),
    supabase.from("bank_lines").select("id, amount, direction").order("statement_date", { ascending: false }).limit(1000),
    supabase.from("recon_lines").select("bank_line_id, match_status"),
  ]);

  const valid = ordersTwoWindows.filter((o) => !cancelled.has(o.financial_status));
  const current = valid.filter((o) => (o.order_date ?? "") >= fromIso);
  const previous = valid.filter((o) => (o.order_date ?? "") < fromIso);
  const revenue = current.reduce((s, o) => s + Number(o.gross_aed || 0), 0);
  const previousRevenue = previous.reduce((s, o) => s + Number(o.gross_aed || 0), 0);

  const productAgg = new Map<string, { title: string; sku: string; revenue: number; qty: number }>();
  for (const o of current) {
    for (const li of o.line_items ?? []) {
      const key = li.sku || li.title;
      const p = productAgg.get(key) ?? { title: li.title, sku: li.sku, revenue: 0, qty: 0 };
      p.revenue += Number(li.total_aed || 0);
      p.qty += Number(li.qty || 0);
      productAgg.set(key, p);
    }
  }
  const topProducts = [...productAgg.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10);

  const stockBySku: Record<string, number> = {};
  for (const item of zohoItems) {
    if (item.sku) stockBySku[item.sku] = Number(item.stock_on_hand);
  }

  const stateOf = new Map((reconRes.data ?? []).map((r) => [r.bank_line_id, r.match_status as string]));
  const credits = (bankLinesRes.data ?? []).filter((b) => b.direction === "credit");
  let settledAed = 0, awaitingAed = 0, awaitingCount = 0, exceptions = 0;
  for (const c of credits) {
    const state = stateOf.get(c.id) ?? "AWAITING_PAYOUT";
    if (state === "SETTLED") settledAed += Number(c.amount);
    else if (state === "AWAITING_PAYOUT") { awaitingAed += Number(c.amount); awaitingCount += 1; }
    else exceptions += 1;
  }

  const scopedAds = adRows.filter((r) => store === "All" || r.store_id === store);

  return {
    windowDays: days,
    store,
    revenue,
    previousRevenue: previous.length > 0 ? previousRevenue : null,
    codPendingAed: counts.codPendingAed,
    codPendingCount: counts.codPendingCount,
    awaitingPayoutAed: +awaitingAed.toFixed(2),
    awaitingPayoutCount: awaitingCount,
    settledAed: +settledAed.toFixed(2),
    exceptions,
    campaigns: aggregateCampaigns(scopedAds, fromDate, toDate),
    topProducts,
    stockBySku,
  };
}

/* One Haiku pass over all facts. The prompt forbids numbers — figures render
   client-side from fact.metrics — and the response must be a JSON array. Any
   failure (no key, HTTP error, malformed JSON) falls back to templates. */
async function phraseWithAI(facts: InsightFact[]): Promise<{ cards: InsightCard[]; model: string }> {
  const fallback = {
    cards: facts.map((f) => ({ fact_id: f.id, ...f.template })),
    model: "",
  };
  if (!process.env.ANTHROPIC_API_KEY || facts.length === 0) return fallback;

  const prompt = `You are writing insight cards for a busy e-commerce founder's dashboard (Omnia — perfume stores in UAE/KSA). Below are machine-detected facts as JSON. For EACH fact, write:
- "headline": punchy, plain English, max 9 words, no jargon
- "why": one sentence on why it matters to the business
- "recommendation": one concrete next action the founder or their team can take today

Rules:
- Do NOT include any numbers, amounts, or percentages in your text — the dashboard renders the exact figures separately from the fact's metrics. Refer to quantities qualitatively ("a large share", "several days").
- Keep campaign/product names exactly as given, in quotes.
- Encouraging but honest tone; no filler, no exclamation marks.
- Reply with ONLY a JSON array: [{"fact_id": "...", "headline": "...", "why": "...", "recommendation": "..."}] — one entry per fact, same fact ids.

Facts:
${JSON.stringify(facts.map((f) => ({ id: f.id, kind: f.kind, severity: f.severity, entity: f.entity, metrics: f.metrics })))}`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return fallback;
    const json = await res.json();
    const text: string = (json.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("");
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]) as InsightCard[];
    const byId = new Map(parsed.map((c) => [c.fact_id, c]));
    // every fact must end up with a card — AI misses fall back per-fact
    const cards = facts.map((f) => {
      const c = byId.get(f.id);
      return c && c.headline && c.why && c.recommendation
        ? { fact_id: f.id, headline: c.headline, why: c.why, recommendation: c.recommendation }
        : { fact_id: f.id, ...f.template };
    });
    return { cards, model: MODEL };
  } catch {
    return fallback;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1), 365);
  const store = url.searchParams.get("store") || "All";
  const refresh = url.searchParams.get("refresh") === "1";

  try {
    if (!refresh) {
      const cutoff = new Date(Date.now() - CACHE_MINUTES * 60_000).toISOString();
      const { data: cached } = await supabase
        .from("insight_runs")
        .select("generated_at, facts, cards, model")
        .eq("window_days", days)
        .eq("store", store)
        .gte("generated_at", cutoff)
        .order("generated_at", { ascending: false })
        .limit(1);
      if (cached && cached.length > 0) {
        return NextResponse.json({
          generatedAt: cached[0].generated_at,
          windowDays: days,
          store,
          facts: cached[0].facts,
          cards: cached[0].cards,
          aiUsed: Boolean(cached[0].model),
          cached: true,
        });
      }
    }

    const input = await gatherRulesInput(days, store);
    const facts = runInsightRules(input);
    const { cards, model } = await phraseWithAI(facts);

    const generatedAt = new Date().toISOString();
    await supabase.from("insight_runs").insert({
      generated_at: generatedAt,
      window_days: days,
      store,
      facts,
      cards,
      model,
    });

    return NextResponse.json({
      generatedAt, windowDays: days, store, facts, cards,
      aiUsed: Boolean(model), cached: false,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
