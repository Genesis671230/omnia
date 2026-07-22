import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateCampaigns, runInsightRules, detectPausedCampaigns, detectRoasDrops,
  detectScaleOpportunities, detectCodAging, detectAwaitingPayoutSpike,
  detectBestsellerLowStock, detectExceptions, detectRevenueMomentum,
  type RulesInput, type CampaignWindow,
} from "@/lib/insights/rules";

const baseInput = (over: Partial<RulesInput> = {}): RulesInput => ({
  windowDays: 30,
  store: "All",
  revenue: 1_000_000,
  previousRevenue: null,
  codPendingAed: 0,
  codPendingCount: 0,
  awaitingPayoutAed: 0,
  awaitingPayoutCount: 0,
  settledAed: 500_000,
  exceptions: 0,
  campaigns: [],
  topProducts: [],
  stockBySku: {},
  ...over,
});

const campaign = (over: Partial<CampaignWindow> = {}): CampaignWindow => ({
  campaign_id: "meta:1",
  platform: "meta",
  store_id: "UAE",
  campaign_name: "Summer Sale",
  campaign_status: "ACTIVE",
  spend: 5000,
  conversions: 40,
  conversion_value: 10000,
  firstHalf: { spend: 2500, conversion_value: 5000 },
  secondHalf: { spend: 2500, conversion_value: 5000 },
  lastActiveDate: "2026-07-20",
  ...over,
});

test("paused campaign with real spend produces a warning; tiny experiments are ignored", () => {
  const facts = detectPausedCampaigns(baseInput({
    campaigns: [
      campaign({ campaign_id: "meta:1", campaign_status: "PAUSED", spend: 4000 }),
      campaign({ campaign_id: "meta:2", campaign_status: "PAUSED", spend: 50 }),
      campaign({ campaign_id: "meta:3", campaign_status: "ACTIVE", spend: 9000 }),
    ],
  }));
  assert.equal(facts.length, 1);
  assert.equal(facts[0].kind, "campaign_paused");
  assert.equal(facts[0].entity?.id, "meta:1");
  assert.equal(facts[0].metrics.spend_aed, 4000);
});

test("ROAS drop of 50%+ between window halves is critical; small wobble is silent", () => {
  const dropped = campaign({
    firstHalf: { spend: 2000, conversion_value: 6000 },   // 3.0x
    secondHalf: { spend: 2000, conversion_value: 2000 },  // 1.0x → 67% drop
  });
  const stable = campaign({
    campaign_id: "meta:2",
    firstHalf: { spend: 2000, conversion_value: 6000 },
    secondHalf: { spend: 2000, conversion_value: 5500 },
  });
  const facts = detectRoasDrops(baseInput({ campaigns: [dropped, stable] }));
  assert.equal(facts.length, 1);
  assert.equal(facts[0].severity, "critical");
  assert.equal(facts[0].metrics.roas_before, 3);
  assert.equal(facts[0].metrics.roas_now, 1);
});

test("paused campaigns never produce a ROAS-drop fact", () => {
  const facts = detectRoasDrops(baseInput({
    campaigns: [campaign({
      campaign_status: "PAUSED",
      firstHalf: { spend: 2000, conversion_value: 6000 },
      secondHalf: { spend: 2000, conversion_value: 1000 },
    })],
  }));
  assert.equal(facts.length, 0);
});

test("under-funded over-performer surfaces as a scale opportunity", () => {
  const star = campaign({
    campaign_id: "meta:star", spend: 1000, conversion_value: 6000,  // 6x
  });
  const whale = campaign({
    campaign_id: "meta:whale", spend: 9000, conversion_value: 9000, // 1x, 90% of spend
  });
  const facts = detectScaleOpportunities(baseInput({ campaigns: [star, whale] }));
  assert.equal(facts.length, 1);
  assert.equal(facts[0].entity?.id, "meta:star");
  assert.equal(facts[0].severity, "opportunity");
  assert.equal(facts[0].metrics.spend_share_pct, 10);
});

test("COD aging fires only past the revenue-share threshold", () => {
  assert.equal(detectCodAging(baseInput({ codPendingAed: 200_000, codPendingCount: 150 })).length, 0);
  const facts = detectCodAging(baseInput({ codPendingAed: 400_000, codPendingCount: 300 }));
  assert.equal(facts.length, 1);
  assert.equal(facts[0].metrics.pct_of_revenue, 40);
});

test("awaiting-payout spike needs both a large share and a large amount", () => {
  assert.equal(detectAwaitingPayoutSpike(baseInput({ awaitingPayoutAed: 40_000, settledAed: 10_000 })).length, 0);
  const facts = detectAwaitingPayoutSpike(baseInput({ awaitingPayoutAed: 600_000, awaitingPayoutCount: 12, settledAed: 400_000 }));
  assert.equal(facts.length, 1);
  assert.equal(facts[0].metrics.share_pct, 60);
});

test("best-seller low stock uses known Zoho stock only", () => {
  const facts = detectBestsellerLowStock(baseInput({
    topProducts: [
      { title: "Oud Royale", sku: "OUD-1", revenue: 90_000, qty: 220 },
      { title: "No SKU product", sku: "", revenue: 80_000, qty: 100 },
      { title: "Unknown stock", sku: "MYST-9", revenue: 70_000, qty: 90 },
    ],
    stockBySku: { "OUD-1": 3 },
  }));
  assert.equal(facts.length, 1);
  assert.equal(facts[0].severity, "critical");
  assert.equal(facts[0].metrics.stock_left, 3);
});

test("exceptions escalate to critical at 4+", () => {
  assert.equal(detectExceptions(baseInput({ exceptions: 2 }))[0].severity, "warning");
  assert.equal(detectExceptions(baseInput({ exceptions: 5 }))[0].severity, "critical");
});

test("revenue momentum reports both directions and ignores noise", () => {
  assert.equal(detectRevenueMomentum(baseInput({ revenue: 1_050_000, previousRevenue: 1_000_000 })).length, 0);
  const up = detectRevenueMomentum(baseInput({ revenue: 1_300_000, previousRevenue: 1_000_000 }));
  assert.equal(up[0].severity, "opportunity");
  assert.equal(up[0].metrics.delta_pct, 30);
  const down = detectRevenueMomentum(baseInput({ revenue: 700_000, previousRevenue: 1_000_000 }));
  assert.equal(down[0].severity, "warning");
});

test("runInsightRules ranks critical first and caps at 6 cards", () => {
  const facts = runInsightRules(baseInput({
    exceptions: 6,
    codPendingAed: 900_000, codPendingCount: 500,
    awaitingPayoutAed: 700_000, awaitingPayoutCount: 9, settledAed: 100_000,
    revenue: 1_000_000, previousRevenue: 500_000,
    campaigns: [
      campaign({ campaign_id: "meta:p1", campaign_status: "PAUSED", spend: 4000 }),
      campaign({ campaign_id: "meta:p2", campaign_status: "PAUSED", spend: 3000 }),
      campaign({
        campaign_id: "meta:d1",
        firstHalf: { spend: 2000, conversion_value: 8000 },
        secondHalf: { spend: 2000, conversion_value: 2000 },
      }),
    ],
    topProducts: [{ title: "Oud Royale", sku: "OUD-1", revenue: 90_000, qty: 220 }],
    stockBySku: { "OUD-1": 2 },
  }));
  assert.equal(facts.length, 6);
  assert.equal(facts[0].severity, "critical");
  const ranks = facts.map((f) => ({ critical: 0, warning: 1, opportunity: 2, info: 3 }[f.severity]));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

test("aggregateCampaigns splits halves at the window midpoint and tracks last active day", () => {
  const row = (date: string, spend: number, value: number) => ({
    campaign_id: "meta:1", platform: "meta", store_id: "UAE",
    campaign_name: "Summer Sale", campaign_status: "ACTIVE",
    date, spend, conversions: 1, conversion_value: value,
  });
  const [c] = aggregateCampaigns(
    [row("2026-07-02", 100, 300), row("2026-07-20", 200, 200), row("2026-07-28", 50, 50)],
    "2026-07-01", "2026-07-31",
  );
  assert.equal(c.firstHalf.spend, 100);
  assert.equal(c.secondHalf.spend, 250);
  assert.equal(c.spend, 350);
  assert.equal(c.lastActiveDate, "2026-07-28");
});
