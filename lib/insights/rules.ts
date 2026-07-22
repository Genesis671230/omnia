/* Dashboard insight engine — deterministic layer.
   Every fact (and every number inside it) comes from these pure detectors;
   the AI layer in /api/insights only rephrases and prioritizes, it never
   computes. Keep detectors pure functions over plain inputs so they stay
   unit-testable without a database. */

export type InsightSeverity = "critical" | "warning" | "opportunity" | "info";

export type InsightEntity =
  | { type: "campaign"; id: string; label: string; platform: string; store: string }
  | { type: "product"; id: string; label: string }
  | { type: "finance"; id: string; label: string };

export type InsightFact = {
  /* stable per (kind, entity) so cards keep identity across runs */
  id: string;
  kind:
    | "campaign_paused"
    | "campaign_roas_drop"
    | "campaign_scale_opportunity"
    | "cod_aging"
    | "awaiting_payout_spike"
    | "bestseller_low_stock"
    | "exceptions_open"
    | "revenue_momentum";
  severity: InsightSeverity;
  entity: InsightEntity | null;
  /* numbers the UI renders directly — the AI never restates these */
  metrics: Record<string, number>;
  /* deterministic phrasing used verbatim when the AI layer is unavailable */
  template: { headline: string; why: string; recommendation: string };
};

export type CampaignWindow = {
  campaign_id: string;
  platform: string;
  store_id: string;
  campaign_name: string;
  campaign_status: string;
  spend: number;
  conversions: number;
  conversion_value: number;
  /* split of the window into an earlier and a later half, for trend facts */
  firstHalf: { spend: number; conversion_value: number };
  secondHalf: { spend: number; conversion_value: number };
  lastActiveDate: string | null;
};

export type RulesInput = {
  windowDays: number;
  store: string;
  revenue: number;
  previousRevenue: number | null;
  codPendingAed: number;
  codPendingCount: number;
  awaitingPayoutAed: number;
  awaitingPayoutCount: number;
  settledAed: number;
  exceptions: number;
  campaigns: CampaignWindow[];
  topProducts: { title: string; sku: string; revenue: number; qty: number }[];
  /* authoritative stock per SKU where known (Zoho), else absent */
  stockBySku: Record<string, number>;
};

const aed = (v: number) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v);

const PAUSED_STATES = new Set(["paused", "campaign_paused", "adset_paused", "disabled", "archived"]);

export function isPausedStatus(status: string): boolean {
  return PAUSED_STATES.has(status.trim().toLowerCase());
}

/* Aggregate raw daily ad-insight rows into per-campaign windows. Kept here
   (not in the route) so the halving logic is covered by the same unit tests
   as the detectors that depend on it. */
export function aggregateCampaigns(
  rows: {
    campaign_id: string; platform: string; store_id: string; campaign_name: string;
    campaign_status: string; date: string; spend: number; conversions: number; conversion_value: number;
  }[],
  from: string,
  to: string,
): CampaignWindow[] {
  const fromMs = Date.parse(from + "T00:00:00Z");
  const toMs = Date.parse(to + "T00:00:00Z");
  const midMs = fromMs + (toMs - fromMs) / 2;

  const byId = new Map<string, CampaignWindow>();
  for (const r of rows) {
    const c = byId.get(r.campaign_id) ?? {
      campaign_id: r.campaign_id, platform: r.platform, store_id: r.store_id,
      campaign_name: r.campaign_name, campaign_status: r.campaign_status,
      spend: 0, conversions: 0, conversion_value: 0,
      firstHalf: { spend: 0, conversion_value: 0 },
      secondHalf: { spend: 0, conversion_value: 0 },
      lastActiveDate: null,
    };
    c.spend += r.spend;
    c.conversions += r.conversions;
    c.conversion_value += r.conversion_value;
    const half = Date.parse(r.date + "T00:00:00Z") < midMs ? c.firstHalf : c.secondHalf;
    half.spend += r.spend;
    half.conversion_value += r.conversion_value;
    if (r.spend > 0 && (!c.lastActiveDate || r.date > c.lastActiveDate)) c.lastActiveDate = r.date;
    byId.set(r.campaign_id, c);
  }
  return [...byId.values()];
}

/* ── detectors ──────────────────────────────────────────────────────────── */

const MIN_CAMPAIGN_SPEND = 300; // AED — ignore experiments too small to matter

export function detectPausedCampaigns(input: RulesInput): InsightFact[] {
  return input.campaigns
    .filter((c) => isPausedStatus(c.campaign_status) && c.spend >= MIN_CAMPAIGN_SPEND)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 3)
    .map((c) => ({
      id: `campaign_paused:${c.campaign_id}`,
      kind: "campaign_paused" as const,
      severity: "warning" as const,
      entity: { type: "campaign" as const, id: c.campaign_id, label: c.campaign_name, platform: c.platform, store: c.store_id },
      metrics: {
        spend_aed: +c.spend.toFixed(2),
        conversions: +c.conversions.toFixed(1),
        pixel_roas: c.spend > 0 ? +(c.conversion_value / c.spend).toFixed(2) : 0,
      },
      template: {
        headline: `"${c.campaign_name}" is paused`,
        why: `It spent ${aed(c.spend)} in the last ${input.windowDays} days${c.lastActiveDate ? ` (last active ${c.lastActiveDate})` : ""} and is no longer delivering.`,
        recommendation: "Decide whether the pause is intentional — if it was performing, resume it; if not, reallocate its budget to a stronger campaign.",
      },
    }));
}

export function detectRoasDrops(input: RulesInput): InsightFact[] {
  const facts: InsightFact[] = [];
  for (const c of input.campaigns) {
    if (isPausedStatus(c.campaign_status)) continue;
    const { firstHalf: a, secondHalf: b } = c;
    if (a.spend < MIN_CAMPAIGN_SPEND || b.spend < MIN_CAMPAIGN_SPEND) continue;
    const roasA = a.conversion_value / a.spend;
    const roasB = b.conversion_value / b.spend;
    if (roasA <= 0) continue;
    const drop = 1 - roasB / roasA;
    if (drop < 0.3) continue;
    facts.push({
      id: `campaign_roas_drop:${c.campaign_id}`,
      kind: "campaign_roas_drop",
      severity: drop >= 0.5 ? "critical" : "warning",
      entity: { type: "campaign", id: c.campaign_id, label: c.campaign_name, platform: c.platform, store: c.store_id },
      metrics: {
        roas_before: +roasA.toFixed(2),
        roas_now: +roasB.toFixed(2),
        drop_pct: +(drop * 100).toFixed(0),
        spend_aed: +c.spend.toFixed(2),
      },
      template: {
        headline: `"${c.campaign_name}" returns are sliding`,
        why: `Pixel ROAS fell ${(drop * 100).toFixed(0)}% between the first and second half of the window (${roasA.toFixed(2)}x → ${roasB.toFixed(2)}x) while it kept spending.`,
        recommendation: "Check for creative fatigue — refresh the top creative or tighten the audience before spending more.",
      },
    });
  }
  return facts.sort((a, b) => b.metrics.drop_pct - a.metrics.drop_pct).slice(0, 2);
}

export function detectScaleOpportunities(input: RulesInput): InsightFact[] {
  const active = input.campaigns.filter((c) => !isPausedStatus(c.campaign_status) && c.spend >= MIN_CAMPAIGN_SPEND);
  const totalSpend = active.reduce((s, c) => s + c.spend, 0);
  if (totalSpend <= 0 || active.length < 2) return [];
  const withRoas = active
    .map((c) => ({ c, roas: c.conversion_value / c.spend }))
    .filter((x) => x.roas > 0);
  if (withRoas.length < 2) return [];
  const avgRoas = withRoas.reduce((s, x) => s + x.roas, 0) / withRoas.length;
  return withRoas
    .filter((x) => x.roas >= avgRoas * 1.6 && x.c.spend / totalSpend < 0.2)
    .sort((a, b) => b.roas - a.roas)
    .slice(0, 1)
    .map(({ c, roas }) => ({
      id: `campaign_scale_opportunity:${c.campaign_id}`,
      kind: "campaign_scale_opportunity" as const,
      severity: "opportunity" as const,
      entity: { type: "campaign" as const, id: c.campaign_id, label: c.campaign_name, platform: c.platform, store: c.store_id },
      metrics: {
        pixel_roas: +roas.toFixed(2),
        avg_roas: +avgRoas.toFixed(2),
        spend_aed: +c.spend.toFixed(2),
        spend_share_pct: +((c.spend / totalSpend) * 100).toFixed(0),
      },
      template: {
        headline: `"${c.campaign_name}" is your quiet over-performer`,
        why: `It returns ${roas.toFixed(2)}x (pixel) against a ${avgRoas.toFixed(2)}x average, yet gets only ${((c.spend / totalSpend) * 100).toFixed(0)}% of ad spend.`,
        recommendation: "Test scaling its budget 20–30% and watch whether the ROAS holds over the next few days.",
      },
    }));
}

export function detectCodAging(input: RulesInput): InsightFact[] {
  const threshold = Math.max(input.revenue * 0.35, 100_000);
  if (input.codPendingAed < threshold) return [];
  return [{
    id: "cod_aging:all",
    kind: "cod_aging",
    severity: "warning",
    entity: { type: "finance", id: "cod", label: "COD receivables" },
    metrics: {
      outstanding_aed: +input.codPendingAed.toFixed(2),
      order_count: input.codPendingCount,
      pct_of_revenue: input.revenue > 0 ? +((input.codPendingAed / input.revenue) * 100).toFixed(0) : 0,
    },
    template: {
      headline: "A lot of cash is riding with the couriers",
      why: `${aed(input.codPendingAed)} across ${input.codPendingCount} COD orders hasn't been remitted yet.`,
      recommendation: "Chase courier remittances for the oldest batches — COD cash left with couriers is your money earning nothing.",
    },
  }];
}

export function detectAwaitingPayoutSpike(input: RulesInput): InsightFact[] {
  const explained = input.settledAed + input.awaitingPayoutAed;
  if (explained <= 0) return [];
  const share = input.awaitingPayoutAed / explained;
  if (share < 0.4 || input.awaitingPayoutAed < 50_000) return [];
  return [{
    id: "awaiting_payout_spike:all",
    kind: "awaiting_payout_spike",
    severity: "warning",
    entity: { type: "finance", id: "awaiting", label: "Awaiting payout files" },
    metrics: {
      awaiting_aed: +input.awaitingPayoutAed.toFixed(2),
      awaiting_count: input.awaitingPayoutCount,
      share_pct: +(share * 100).toFixed(0),
    },
    template: {
      headline: "Bank credits are piling up unexplained",
      why: `${aed(input.awaitingPayoutAed)} of bank credits (${(share * 100).toFixed(0)}% of the explained+waiting total) still has no payout file behind it.`,
      recommendation: "Upload the missing gateway payout files so these credits can be reconciled and counted as settled.",
    },
  }];
}

export function detectBestsellerLowStock(input: RulesInput): InsightFact[] {
  const LOW = 5;
  return input.topProducts
    .slice(0, 5)
    .filter((p) => p.sku && input.stockBySku[p.sku] != null && input.stockBySku[p.sku] <= LOW)
    .slice(0, 2)
    .map((p) => ({
      id: `bestseller_low_stock:${p.sku}`,
      kind: "bestseller_low_stock" as const,
      severity: "critical" as const,
      entity: { type: "product" as const, id: p.sku, label: p.title },
      metrics: {
        stock_left: input.stockBySku[p.sku],
        sold_qty: p.qty,
        revenue_aed: +p.revenue.toFixed(2),
      },
      template: {
        headline: `Best-seller "${p.title}" is nearly out of stock`,
        why: `It sold ${p.qty} units (${aed(p.revenue)}) in the window but only ${input.stockBySku[p.sku]} remain in Zoho.`,
        recommendation: "Reorder now — running a best-seller to zero turns your strongest revenue line off overnight.",
      },
    }));
}

export function detectExceptions(input: RulesInput): InsightFact[] {
  if (input.exceptions <= 0) return [];
  return [{
    id: "exceptions_open:all",
    kind: "exceptions_open",
    severity: input.exceptions >= 4 ? "critical" : "warning",
    entity: { type: "finance", id: "exceptions", label: "Reconciliation exceptions" },
    metrics: { count: input.exceptions },
    template: {
      headline: `${input.exceptions} settlement exception${input.exceptions === 1 ? "" : "s"} need${input.exceptions === 1 ? "s" : ""} a decision`,
      why: "These bank credits have a variance against their payout file or contain orders we can't find — money that can't be called settled.",
      recommendation: "Open Reconciliation and resolve them; most are an FX rounding to accept or a missing sync to run.",
    },
  }];
}

export function detectRevenueMomentum(input: RulesInput): InsightFact[] {
  if (input.previousRevenue == null || input.previousRevenue <= 0) return [];
  const delta = (input.revenue - input.previousRevenue) / input.previousRevenue;
  if (Math.abs(delta) < 0.15) return [];
  const up = delta > 0;
  return [{
    id: "revenue_momentum:all",
    kind: "revenue_momentum",
    severity: up ? "opportunity" : "warning",
    entity: { type: "finance", id: "revenue", label: "Revenue" },
    metrics: {
      revenue_aed: +input.revenue.toFixed(2),
      previous_aed: +input.previousRevenue.toFixed(2),
      delta_pct: +(delta * 100).toFixed(0),
    },
    template: {
      headline: up
        ? `Revenue is up ${(delta * 100).toFixed(0)}% on the previous ${input.windowDays} days`
        : `Revenue is down ${Math.abs(delta * 100).toFixed(0)}% on the previous ${input.windowDays} days`,
      why: `${aed(input.revenue)} this window vs ${aed(input.previousRevenue)} in the ${input.windowDays} days before.`,
      recommendation: up
        ? "Find what drove it — the store, product, or campaign behind the jump is where the next dirham goes."
        : "Check the store split and campaign cards below to see where the drop is coming from before it compounds.",
    },
  }];
}

/* ── composition ────────────────────────────────────────────────────────── */

const SEVERITY_RANK: Record<InsightSeverity, number> = { critical: 0, warning: 1, opportunity: 2, info: 3 };

export function runInsightRules(input: RulesInput): InsightFact[] {
  return [
    ...detectBestsellerLowStock(input),
    ...detectExceptions(input),
    ...detectRoasDrops(input),
    ...detectPausedCampaigns(input),
    ...detectAwaitingPayoutSpike(input),
    ...detectCodAging(input),
    ...detectScaleOpportunities(input),
    ...detectRevenueMomentum(input),
  ]
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, 6);
}
