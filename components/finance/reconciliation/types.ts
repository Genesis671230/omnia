/* Shared client types for the reconciliation surface. Mirrors the engine's
 * ReconLine plus the two fields the API adds on top (posting state). */

export type ReconTxn = {
  ref: string;
  netShare: number;
  grossShare: number;
  feeShare: number;
  isRefund: boolean;
  quality: string | null;
};

export type ReconLine = {
  id: string;
  date: string | null;
  narration: string;
  reference: string;
  provider: string;
  confidence: string;
  bankAmount: number;
  payout: {
    id: string;
    net: number;
    source: string | null;
    currency: string | null;
    fxRate: number | null;
    fxSource: "bank" | "estimate" | null;
  } | null;
  variance: number;
  resolvedOrders: string[];
  unresolvedRefs: string[];
  refundedOrders: string[];
  qualityIssues: { ref: string; quality: string }[];
  transactions: ReconTxn[];
  rateDriftAed: number | null;
  fxFeeAed: number | null;
  state: "AWAITING_PAYOUT" | "PAYOUT_VARIANCE" | "ORDERS_UNRESOLVED" | "SETTLED";
  confirmedBy: string | null;
  reviewFlag: boolean;
  reviewNote: string;
};

export type ZohoPostingState = {
  status: string;
  postedAt: string;
  reference: string;
  result: unknown;
};

export type ReconPayload = {
  lines: ReconLine[];
  settledOrders: number;
  totalOrders: number;
  zohoPostings: Record<string, ZohoPostingState>;
  documents: {
    bankStatement: boolean;
    missingPayouts: { provider: string; awaitingAmount: number }[];
    range: { from: string | null; to: string | null; noStatementForRange: boolean } | null;
  };
};

/** The shape actually stored on orders.line_items by the store sync — verified
 *  against live data, not assumed. There is no unit-price field; unit is
 *  derived from total_aed ÷ qty. The legacy aliases are kept because older
 *  synced rows predate the current normalizer. */
export type LineItem = {
  sku?: string;
  title?: string;
  qty?: number;
  total_aed?: number;
  image_url?: string;
  stock?: number;
  // legacy aliases
  name?: string;
  quantity?: number;
  price?: number | string;
  total?: number | string;
};

export type OrderDetail = {
  uid: string;
  order_number: string;
  store_id: string;
  order_date: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  city: string;
  country: string;
  currency: string;
  gross_original: number;
  gross_aed: number;
  gateway: string;
  financial_status: string;
  fulfillment_status: string;
  fulfillment_stage: string;
  payout_status: string;
  line_items: LineItem[];
  courier: string;
  tracking_number: string;
  awb_number: string;
  shipped_at: string | null;
};

export const aed2 = (v: number) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", minimumFractionDigits: 2 }).format(v);

export const aed0 = (v: number) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(v);

export const STATE_META = {
  SETTLED: { label: "Settled", tone: "ok" },
  PAYOUT_VARIANCE: { label: "Variance", tone: "bad" },
  ORDERS_UNRESOLVED: { label: "Orders unresolved", tone: "warn" },
  AWAITING_PAYOUT: { label: "Awaiting payout", tone: "info" },
} as const;
