// Read-only data tools the AI chat assistant may call. This is the ONLY
// bridge between the assistant and live data — every tool here is a scoped,
// capped, read-only query built on the same repositories the dashboard uses.
// There is no query/SQL tool and no write/mutate tool of any kind, so a
// prompt-injected or adversarial message can at most ask for data a founder
// could already see in the app; it can never change anything.

import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";
import { SyncRunsRepository } from "@/lib/repositories/sync-runs.repository";
import { runReconciliation, summarizeReconLines } from "@/lib/reconciliation/engine";
import { BankRepository } from "@/lib/repositories/bank.repository";
import { telrConfigured } from "@/lib/integrations/telr";
import { stripeConfigured } from "@/lib/integrations/stripe";
import { AdInsightsRepository } from "@/lib/repositories/ad-insights.repository";
import { buildFinancialReport } from "@/lib/reports/cfo-digest";

const STORES = ["ALL", "WA", "UAE", "KSA", "WOO"];
const cancelled = new Set(["voided", "refunded", "cancelled"]);

function windowFilter(days: number, store: string) {
  const fromIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const storeFilter = (store || "ALL").toUpperCase();
  return (o: { order_date: string | null; financial_status: string; store_id: string }) =>
    Boolean(o.order_date) && o.order_date! >= fromIso && !cancelled.has(o.financial_status) &&
    (storeFilter === "ALL" || o.store_id === storeFilter);
}

export const AI_TOOLS = [
  {
    name: "get_sales_summary",
    description: "Revenue, order count, and breakdowns by store and payment gateway for a recent window of orders. Use for questions about sales, revenue, order volume, or which store/gateway is performing.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Lookback window in days (1-365).", default: 30 },
        store: { type: "string", description: "Store code to filter to, or ALL for every store.", enum: STORES, default: "ALL" },
      },
    },
  },
  {
    name: "get_financial_report",
    description: "Revenue, COGS, and profit for a specific Dubai-calendar date range, computed from PAID orders only (financial_status=\"paid\"), plus a full order-count breakdown by status and a totalOrders figure that includes pending/cancelled/failed/refunded/voided/expired orders too. Use this for 'last week', 'last month', 'this month', a specific date, or any named date-range profit/revenue/COGS/margin question — NOT get_sales_summary, which is a rolling N-day window over all non-cancelled orders (including unpaid ones) and has no COGS/profit. Resolve the relative range to concrete YYYY-MM-DD dates yourself using today's date before calling this.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, inclusive, YYYY-MM-DD (Dubai calendar day)." },
        to: { type: "string", description: "End date, inclusive, YYYY-MM-DD (Dubai calendar day). Same as `from` for a single day." },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_reconciliation_status",
    description: "Bank-reconciliation state: how much revenue is confirmed SETTLED by a bank credit vs still AWAITING_PAYOUT, in variance, or has unresolved order refs, broken down by gateway. This is the cash-truth view — use it for 'have we been paid' / 'what's outstanding' questions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_payout_sync_status",
    description: "Whether Stripe/Telr gateway APIs are connected, and the result of the most recent automated payout-verification cycle (the persistent background sync). Use for 'is payout sync working' / 'when did we last check Stripe/Telr' questions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_orders",
    description: "Look up specific orders by order number or customer name. Returns at most 20 matching orders with order number, store, date, amount, gateway, and settlement status. Does not return phone numbers or emails.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Order number (or part of one) or customer name to search for." },
        store: { type: "string", description: "Restrict to one store code, or ALL.", enum: STORES, default: "ALL" },
        limit: { type: "integer", description: "Max rows to return (max 20).", default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "get_top_products",
    description: "Best-selling products by units sold and revenue over a recent window, optionally filtered to one store. Use for 'what's selling' / product-performance questions.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Lookback window in days (1-365).", default: 30 },
        store: { type: "string", enum: STORES, default: "ALL" },
        limit: { type: "integer", description: "Max products to return (max 20).", default: 10 },
      },
    },
  },
  {
    name: "get_low_stock_products",
    description: "Products whose stock looked low the last time they appeared in a synced order (Shopify stores only — WooCommerce doesn't carry live stock in the order feed). This is a snapshot at last order sync, NOT a live inventory poll, and only covers SKUs that have actually sold recently — say so when answering.",
    input_schema: {
      type: "object",
      properties: {
        store: { type: "string", enum: STORES, default: "ALL" },
        threshold: { type: "integer", description: "Flag products at or below this stock count.", default: 10 },
        limit: { type: "integer", description: "Max products to return (max 30).", default: 15 },
      },
    },
  },
  {
    name: "get_daily_settlement_report",
    description: "The audit-trail settlement report for one calendar day — every order whose bank credit was confirmed settled that day, grouped by gateway. Defaults to the most recent day with settlements. Use for 'what settled today/yesterday/on X date' questions.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "ISO date YYYY-MM-DD. Omit for the most recent settled day." },
      },
    },
  },
  {
    name: "get_ad_spend",
    description: "Ad spend, impressions, clicks, and platform-reported conversions from Meta, Google, TikTok, and Snapchat over a recent window, broken down by store and platform, next to actual store revenue for the same window. Platform-reported conversions and store revenue are two distinct numbers, not a blended ROAS. Use for 'how much are we spending on ads' / 'which platform is performing' / marketing-spend questions.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Lookback window in days (1-365).", default: 30 },
        store: { type: "string", description: "Store code to filter to, or ALL for every store.", enum: STORES, default: "ALL" },
      },
    },
  },
  {
    name: "get_dispatch_report",
    description: "Orders in an EXACT time window (not a rolling N-day lookback), optionally filtered by courier tier and fulfillment stage. \"SMSA\", \"DHL\", or \"international\" all mean the same thing in this business and map to courier_tier=international (every non-UAE order — this is the exact rule the dispatch sheet itself uses to route an order to the \"SMSA Orders\" tab; SMSA and DHL aren't tracked as separate carriers anywhere in this system, they're one routing bucket). \"OnTrack\" or \"local\" maps to courier_tier=local (UAE orders). Use this for anything with a specific clock-time boundary (\"from 1pm yesterday to 1pm today\", \"since 9am\") or a courier-tier/dispatch-stage question that get_sales_summary and get_financial_report can't answer (they only do rolling-day or calendar-day windows with no courier or dispatch-stage filter). Resolve relative times ('yesterday 1pm') to concrete Dubai-local (UTC+4) ISO datetimes yourself using the current date/time before calling this — pass them as UTC ISO strings (e.g. Dubai 1pm = UTC 09:00, so 'yesterday 1pm Dubai to today 1pm Dubai' becomes from=<yesterday>T09:00:00Z, to=<today>T09:00:00Z).",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Window start, inclusive, UTC ISO datetime (e.g. 2026-08-07T09:00:00Z)." },
        to: { type: "string", description: "Window end, exclusive, UTC ISO datetime." },
        date_field: { type: "string", description: "Which timestamp the window applies to: order_date (when the order came in — default) or shipped_at (when it was actually dispatched, rarely populated today — see the response note).", enum: ["order_date", "shipped_at"], default: "order_date" },
        courier_tier: { type: "string", description: "international = SMSA/DHL (any non-UAE order); local = OnTrack (UAE orders). Omit for both.", enum: ["international", "local"] },
        courier: { type: "string", description: "Advanced/rarely useful: filter by the literal checkout-time shipping-method label text (e.g. \"Express Shipping\") — NOT the same as courier_tier and NOT a real carrier name. Only use this if courier_tier doesn't fit the question." },
        fulfillment_stage: { type: "string", description: "Filter to one fulfillment stage. Omit for all stages.", enum: ["new", "processing", "packed", "shipped", "delivered"] },
        store: { type: "string", enum: STORES, default: "ALL" },
        limit: { type: "integer", description: "Max order rows to return in the sample (max 50).", default: 20 },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_campaign_performance",
    description: "Individual ad campaigns (Meta/Google/TikTok/Snap) ranked by spend over a recent window, with impressions, clicks, and platform-reported conversions per campaign. Use for 'what's our best/worst campaign' / 'what's running right now' questions.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Lookback window in days (1-365).", default: 30 },
        store: { type: "string", enum: STORES, default: "ALL" },
        limit: { type: "integer", description: "Max campaigns to return (max 20).", default: 10 },
      },
    },
  },
] as const;

export type ToolName = (typeof AI_TOOLS)[number]["name"];

async function get_sales_summary(input: { days?: number; store?: string }) {
  const days = Math.min(Math.max(input.days ?? 30, 1), 365);
  const store = (input.store ?? "ALL").toUpperCase();
  const orders = await OrdersRepository.listAll();
  const inWindow = orders.filter(windowFilter(days, store));

  const revenue = inWindow.reduce((s, o) => s + Number(o.gross_aed || 0), 0);
  const byStore = new Map<string, { revenue: number; orders: number }>();
  const byGateway = new Map<string, { revenue: number; orders: number }>();
  for (const o of inWindow) {
    const s = byStore.get(o.store_id) || { revenue: 0, orders: 0 };
    s.revenue += Number(o.gross_aed || 0); s.orders += 1;
    byStore.set(o.store_id, s);
    const g = byGateway.get(o.gateway || "Unclassified") || { revenue: 0, orders: 0 };
    g.revenue += Number(o.gross_aed || 0); g.orders += 1;
    byGateway.set(o.gateway || "Unclassified", g);
  }

  return {
    window: { days, store },
    revenue_aed: +revenue.toFixed(2),
    orders: inWindow.length,
    aov_aed: inWindow.length ? +(revenue / inWindow.length).toFixed(2) : 0,
    by_store: [...byStore.entries()].map(([s, v]) => ({ store: s, revenue_aed: +v.revenue.toFixed(2), orders: v.orders })).sort((a, b) => b.revenue_aed - a.revenue_aed),
    by_gateway: [...byGateway.entries()].map(([g, v]) => ({ gateway: g, revenue_aed: +v.revenue.toFixed(2), orders: v.orders })).sort((a, b) => b.revenue_aed - a.revenue_aed),
  };
}

async function get_financial_report(input: { from: string; to: string }) {
  return buildFinancialReport(input.from, input.to);
}

async function get_reconciliation_status() {
  const lines = await runReconciliation();
  const summary = summarizeReconLines(lines);
  const [credits, payouts] = await Promise.all([BankRepository.listCredits(), PayoutsRepository.listWithRefs()]);
  const uploadedProviders = new Set(payouts.map((p) => p.gateway));
  const missingDocs = [...new Set(
    lines.filter((l) => l.state === "AWAITING_PAYOUT" && l.provider !== "Unclassified").map((l) => l.provider),
  )].map((provider) => ({
    provider,
    has_any_payout_data: uploadedProviders.has(provider),
    awaiting_aed: +lines.filter((l) => l.state === "AWAITING_PAYOUT" && l.provider === provider).reduce((s, l) => s + l.bankAmount, 0).toFixed(2),
  }));

  return {
    bank_lines_total: summary.total,
    settled_aed: summary.settled,
    awaiting_payout_aed: summary.awaitingPayout,
    payout_variance_aed: summary.payoutVariance,
    orders_unresolved_aed: summary.ordersUnresolved,
    missing_payout_docs: missingDocs,
    bank_statement_on_file: credits.length > 0,
    computed_at: new Date().toISOString(),
  };
}

async function get_payout_sync_status() {
  const lastRun = await SyncRunsRepository.getLatest();
  return {
    telr_api_connected: telrConfigured(),
    stripe_api_connected: stripeConfigured(),
    last_run: lastRun,
  };
}

async function search_orders(input: { query: string; store?: string; limit?: number }) {
  const q = (input.query || "").trim().toLowerCase();
  if (!q) return { count: 0, orders: [] };
  const store = (input.store ?? "ALL").toUpperCase();
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 20);

  const orders = await OrdersRepository.listAll();
  const matches = orders.filter((o) =>
    (store === "ALL" || o.store_id === store) &&
    (o.order_number.toLowerCase().includes(q) || o.customer_name.toLowerCase().includes(q)),
  );

  return {
    count: matches.length,
    orders: matches.slice(0, limit).map((o) => ({
      order_number: o.order_number,
      store: o.store_id,
      order_date: o.order_date,
      customer_name: o.customer_name,
      gross_aed: Number(o.gross_aed || 0),
      gateway: o.gateway,
      financial_status: o.financial_status,
      payout_status: o.payout_status,
    })),
  };
}

async function get_top_products(input: { days?: number; store?: string; limit?: number }) {
  const days = Math.min(Math.max(input.days ?? 30, 1), 365);
  const store = (input.store ?? "ALL").toUpperCase();
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 20);

  const orders = await OrdersRepository.listAll();
  const inWindow = orders.filter(windowFilter(days, store));

  const agg = new Map<string, { title: string; sku: string; qty: number; revenue: number }>();
  for (const o of inWindow) {
    for (const li of o.line_items ?? []) {
      const key = li.sku || li.title;
      const p = agg.get(key) || { title: li.title, sku: li.sku, qty: 0, revenue: 0 };
      p.qty += Number(li.qty || 0);
      p.revenue += Number(li.total_aed || 0);
      agg.set(key, p);
    }
  }

  return {
    window: { days, store },
    products: [...agg.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit)
      .map((p) => ({ title: p.title, sku: p.sku, units_sold: p.qty, revenue_aed: +p.revenue.toFixed(2) })),
  };
}

async function get_low_stock_products(input: { store?: string; threshold?: number; limit?: number }) {
  const store = (input.store ?? "ALL").toUpperCase();
  const threshold = input.threshold ?? 10;
  const limit = Math.min(Math.max(input.limit ?? 15, 1), 30);

  const orders = await OrdersRepository.listAll(); // already ordered by order_date desc
  const latestBySku = new Map<string, { title: string; sku: string; store: string; stock: number; as_of: string | null }>();
  for (const o of orders) {
    if (store !== "ALL" && o.store_id !== store) continue;
    for (const li of o.line_items ?? []) {
      if (li.stock == null) continue;
      const key = `${o.store_id}::${li.sku || li.title}`;
      if (latestBySku.has(key)) continue; // orders are newest-first; first hit is most recent
      latestBySku.set(key, { title: li.title, sku: li.sku, store: o.store_id, stock: li.stock, as_of: o.order_date });
    }
  }

  return {
    note: "Stock reflects the value captured the last time each SKU appeared in a synced order — not a live poll. WooCommerce orders don't carry stock data.",
    threshold,
    products: [...latestBySku.values()]
      .filter((p) => p.stock <= threshold)
      .sort((a, b) => a.stock - b.stock)
      .slice(0, limit),
  };
}

async function get_daily_settlement_report(input: { date?: string }) {
  const dates = await SettlementsRepository.listDatesWithCounts();
  const date = input.date || dates[0]?.date || new Date().toISOString().slice(0, 10);
  const records = await SettlementsRepository.listByDate(date);

  const byGateway = new Map<string, { count: number; gross: number }>();
  for (const r of records) {
    const g = byGateway.get(r.gateway) ?? { count: 0, gross: 0 };
    g.count += 1;
    g.gross += Number(r.gross_aed || 0);
    byGateway.set(r.gateway, g);
  }

  return {
    date,
    settled_orders: records.length,
    total_aed: +records.reduce((s, r) => s + Number(r.gross_aed || 0), 0).toFixed(2),
    by_gateway: [...byGateway.entries()].map(([gateway, v]) => ({ gateway, count: v.count, gross_aed: +v.gross.toFixed(2) })),
    sample_orders: records.slice(0, 10).map((r) => ({ order_number: r.order_number, store: r.store_id, gateway: r.gateway, gross_aed: Number(r.gross_aed || 0) })),
  };
}

async function get_ad_spend(input: { days?: number; store?: string }) {
  const days = Math.min(Math.max(input.days ?? 30, 1), 365);
  const store = (input.store ?? "ALL").toUpperCase();

  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const fromIso = new Date(from + "T00:00:00Z").toISOString();

  const [insightRows, orders] = await Promise.all([
    AdInsightsRepository.listInsights(from, to),
    OrdersRepository.listAll(),
  ]);
  const scopedInsights = insightRows.filter((r) => store === "ALL" || r.store_id === store);
  const scopedOrders = orders.filter((o) =>
    Boolean(o.order_date) && o.order_date! >= fromIso && !cancelled.has(o.financial_status) &&
    (store === "ALL" || o.store_id === store),
  );

  const byPlatform = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number; conversion_value: number }>();
  for (const r of scopedInsights) {
    const p = byPlatform.get(r.platform) ?? { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0 };
    p.spend += r.spend; p.impressions += r.impressions; p.clicks += r.clicks;
    p.conversions += r.conversions; p.conversion_value += r.conversion_value;
    byPlatform.set(r.platform, p);
  }

  return {
    window: { days, store },
    total_spend_aed: +scopedInsights.reduce((s, r) => s + r.spend, 0).toFixed(2),
    total_conversions: +scopedInsights.reduce((s, r) => s + r.conversions, 0).toFixed(2),
    total_conversion_value_aed: +scopedInsights.reduce((s, r) => s + r.conversion_value, 0).toFixed(2),
    actual_store_revenue_aed: +scopedOrders.reduce((s, o) => s + Number(o.gross_aed || 0), 0).toFixed(2),
    by_platform: [...byPlatform.entries()]
      .map(([platform, v]) => ({
        platform, spend_aed: +v.spend.toFixed(2), impressions: v.impressions, clicks: v.clicks,
        conversions: +v.conversions.toFixed(2), conversion_value_aed: +v.conversion_value.toFixed(2),
      }))
      .sort((a, b) => b.spend_aed - a.spend_aed),
    note: "Platform-reported conversions and actual store revenue are two distinct sources shown side by side — not a blended attribution/ROAS figure.",
  };
}

async function get_dispatch_report(input: {
  from: string; to: string; date_field?: "order_date" | "shipped_at";
  courier_tier?: "international" | "local"; courier?: string;
  fulfillment_stage?: string; store?: string; limit?: number;
}) {
  const dateField = input.date_field ?? "order_date";
  const store = (input.store ?? "ALL").toUpperCase();
  const courier = (input.courier ?? "").trim().toLowerCase();
  const stage = (input.fulfillment_stage ?? "").trim().toLowerCase();
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);

  const orders = await OrdersRepository.listAll();
  const matches = orders.filter((o) => {
    const ts = dateField === "shipped_at" ? o.shipped_at : o.order_date;
    if (!ts || ts < input.from || ts >= input.to) return false;
    if (store !== "ALL" && o.store_id !== store) return false;
    // Same country-based routing rule the dispatch sheet itself uses
    // (tabForOrder in lib/integrations/dispatch-sheet.ts): UAE = local /
    // OnTrack, everything else = international / SMSA-DHL. This is the
    // correct way to answer "how many SMSA orders" — the `courier` column
    // never contains a carrier name at all (see the note below).
    if (input.courier_tier === "local" && o.country !== "AE") return false;
    if (input.courier_tier === "international" && o.country === "AE") return false;
    if (courier && !(o.courier || "").toLowerCase().includes(courier)) return false;
    if (stage && (o.fulfillment_stage || "new").toLowerCase() !== stage) return false;
    return true;
  });

  const byStage = new Map<string, number>();
  for (const o of matches) {
    const s = o.fulfillment_stage || "new";
    byStage.set(s, (byStage.get(s) ?? 0) + 1);
  }
  const withAwb = matches.filter((o) => o.awb_number).length;

  return {
    window: { from: input.from, to: input.to, date_field: dateField },
    filters: {
      store, courier_tier: input.courier_tier ?? null, courier: input.courier ?? null,
      fulfillment_stage: input.fulfillment_stage ?? null,
    },
    count: matches.length,
    dispatched_with_live_awb: withAwb,
    by_fulfillment_stage: [...byStage.entries()].map(([fulfillment_stage, count]) => ({ fulfillment_stage, count })),
    note:
      "`count` is orders in the window matching the filters (received, not necessarily confirmed dispatched). `dispatched_with_live_awb` is how many of those have an actual courier API tracking number on file — as of now that's almost always 0, because dispatch confirmation through this system's own fulfillment flow / SMSA API integration is barely used yet (fulfillment_stage sits at \"processing\" for nearly every order). So `count` answers 'how many orders came in for this courier tier' reliably; `dispatched_with_live_awb` UNDER-counts real-world dispatches — for the actual dispatched/not question, say `count` plus this caveat, and point to the physical dispatch sheet (Google Sheets) for what Sinan/Yaseen have actually confirmed shipped.",
    sample_orders: matches.slice(0, limit).map((o) => ({
      order_number: o.order_number, store: o.store_id, order_date: o.order_date, country: o.country,
      fulfillment_stage: o.fulfillment_stage || "new", awb_number: o.awb_number || null, shipped_at: o.shipped_at,
    })),
  };
}

async function get_campaign_performance(input: { days?: number; store?: string; limit?: number }) {
  const days = Math.min(Math.max(input.days ?? 30, 1), 365);
  const store = (input.store ?? "ALL").toUpperCase();
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 20);

  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const insightRows = await AdInsightsRepository.listInsights(from, to);
  const scoped = insightRows.filter((r) => store === "ALL" || r.store_id === store);

  const byCampaign = new Map<string, {
    campaign_id: string; platform: string; store_id: string; campaign_name: string;
    campaign_status: string; spend: number; impressions: number; clicks: number; conversions: number;
  }>();
  for (const r of scoped) {
    const c = byCampaign.get(r.campaign_id) ?? {
      campaign_id: r.campaign_id, platform: r.platform, store_id: r.store_id,
      campaign_name: r.campaign_name, campaign_status: r.campaign_status,
      spend: 0, impressions: 0, clicks: 0, conversions: 0,
    };
    c.spend += r.spend; c.impressions += r.impressions; c.clicks += r.clicks; c.conversions += r.conversions;
    byCampaign.set(r.campaign_id, c);
  }

  return {
    window: { days, store },
    campaigns: [...byCampaign.values()]
      .sort((a, b) => b.spend - a.spend)
      .slice(0, limit)
      .map((c) => ({
        campaign_id: c.campaign_id, platform: c.platform, store_id: c.store_id,
        campaign_name: c.campaign_name, campaign_status: c.campaign_status,
        spend_aed: +c.spend.toFixed(2), impressions: c.impressions, clicks: c.clicks,
        conversions: +c.conversions.toFixed(2),
      })),
  };
}

const EXECUTORS: Record<ToolName, (input: any) => Promise<unknown>> = {
  get_sales_summary,
  get_financial_report,
  get_reconciliation_status,
  get_payout_sync_status,
  search_orders,
  get_top_products,
  get_low_stock_products,
  get_daily_settlement_report,
  get_dispatch_report,
  get_ad_spend,
  get_campaign_performance,
};

export async function runTool(name: string, input: unknown): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const executor = EXECUTORS[name as ToolName];
  if (!executor) return { ok: false, error: `Unknown tool: ${name}` };
  try {
    const result = await executor((input ?? {}) as any);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
