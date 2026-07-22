/* Shared types for the founder dashboard v2. Dash mirrors /api/dashboard's
   payload; Insight* mirrors /api/insights. */

export type Dash = {
  window: { days: number; from: string; store: string };
  kpis: {
    revenue: number; orders: number; aov: number;
    bankCredits: number; bankDebits: number; settled: number; awaitingPayout: number;
    exceptions: number; codPendingAed: number; codPendingCount: number;
    settledOrders: number; totalOrders: number;
  };
  previous: { revenue: number; orders: number; aov: number };
  trend: { date: string; byStore: Record<string, number>; total: number }[];
  stores: { store: string; revenue: number; orders: number }[];
  gateways: { gateway: string; revenue: number; orders: number; share: number }[];
  payouts: {
    byProvider: { provider: string; total: number; count: number; lastDate: string | null }[];
    recent: { id: string; date: string | null; provider: string; amount: number; reference: string; state: string; confirmed: boolean }[];
    uploadedBatches: number;
  };
  topProducts: { title: string; sku: string; qty: number; revenue: number; orders: number; stores: string[]; image_url?: string }[];
  recentOrders: { uid: string; store_id: string; order_number: string; order_date: string | null; customer_name: string; gross_aed: number; gateway: string; payout_status: string }[];
  documents: { bankStatement: boolean; lastStatementDate: string | null };
  spotlight: SpotlightOrder | null;
};

export type SpotlightOrder = {
  uid: string; order_number: string; store_id: string; order_date: string | null;
  gross_aed: number; gateway: string;
  finance_status: "SETTLED" | "AWAITING_BANK" | "MISSING_PAYOUT" | "COD_PENDING";
  fulfillment_status: string;
  inventory: "in_stock" | "out_of_stock" | "unknown";
  courier: string | null; tracking_number: string | null; tracking_url: string | null;
  eta_date: string;
  customer: { name: string; email: string; phone: string; city: string; country: string };
  line_items: { title: string; sku: string; qty: number; total_aed: number; image_url?: string }[];
  draft_message: string;
};

export type InsightSeverity = "critical" | "warning" | "opportunity" | "info";

export type InsightFact = {
  id: string;
  kind: string;
  severity: InsightSeverity;
  entity:
    | { type: "campaign"; id: string; label: string; platform: string; store: string }
    | { type: "product"; id: string; label: string }
    | { type: "finance"; id: string; label: string }
    | null;
  metrics: Record<string, number>;
  template: { headline: string; why: string; recommendation: string };
};

export type InsightCard = { fact_id: string; headline: string; why: string; recommendation: string };

export type InsightsPayload = {
  generatedAt: string;
  windowDays: number;
  store: string;
  facts: InsightFact[];
  cards: InsightCard[];
  aiUsed: boolean;
  cached: boolean;
  error?: string;
};

export type MoneyDrawerKind = "revenue" | "cash" | "awaiting" | "cod" | null;

export const STORE_COLOR: Record<string, string> = {
  WA: "#38bdf8", UAE: "#34d399", KSA: "#fbbf24", WOO: "#a78bfa",
};
export const GATEWAY_COLOR: Record<string, string> = {
  Stripe: "#818cf8", Telr: "#34d399", Checkout: "#fbbf24", Tabby: "#4ade80",
  Tamara: "#a78bfa", "Shopify Payments": "#f87171", COD: "#f472b6", Unclassified: "#94a3b8",
};

export const aed = (v: number) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v || 0);
export const aed2 = (v: number) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", minimumFractionDigits: 2 }).format(v || 0);
export const compact = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}m` : v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : String(Math.round(v));
export const shortDate = (iso: string) =>
  new Date(iso.slice(0, 10) + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
