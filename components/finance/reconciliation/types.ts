/* Shared client types for the reconciliation surface. Mirrors the engine's
 * ReconLine plus the two fields the API adds on top (posting state). */

import type { ReactNode } from "react";

/** Renders a payout upload control. With a bankLineId the uploaded file is
 *  attached to that credit; "dropzone" renders the large drag-and-drop area. */
export type UploadSlotFor = (provider: string, bankLineId?: string, variant?: "button" | "dropzone") => ReactNode;

export type ReconTxn = {
  ref: string;
  netShare: number;
  grossShare: number;
  feeShare: number;
  isRefund: boolean;
  quality: string | null;
  // This order's own amounts exactly as the source payout file quoted them,
  // before AED conversion — e.g. a Tabby SAR row's own Order Amount/Total
  // Deduction/Transferred amount. Null for AED-native payouts or rows
  // parsed before this was tracked; pair with ReconLine.payout.currency to
  // label the unit (only meaningful when payout.currency is set, non-AED).
  netOriginal: number | null;
  grossOriginal: number | null;
  feeOriginal: number | null;
  /** VAT charged on top of feeShare (Tamara). Null when the fee already
   *  includes VAT (Tabby) or the file doesn't itemise it. */
  vatShare?: number | null;
  vatOriginal?: number | null;
  /** Order this line resolved to (itself, prefix-free, or a manual link). */
  orderNumber?: string | null;
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

export type UnmatchedPayout = {
  id: string;
  provider: string;
  net: number;
  currency: string | null;
  netOriginal: number | null;
  source: string | null;
  orders: number;
  uploadedAt: string | null;
  pinnedTo: string | null;
};

export type ReconPayload = {
  unmatchedPayouts?: UnmatchedPayout[];
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

// Amount-then-code (e.g. "19,002.90 SAR"), not a currency-symbol format —
// the reader here is comparing this against an AED figure right next to
// it, so a plain number with the code spelled out reads faster than a
// locale-dependent symbol they may not recognize for SAR/KWD.
export const fmtOriginal = (v: number, currency: string) =>
  `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)} ${currency}`;

/** Payout foots to the bank but some lines match no order: the matched
 *  orders can be confirmed and booked now; the rest get linked on screen.
 *  Mirrors isConfirmablePartial() in lib/reconciliation/engine.ts. */
export const isConfirmablePartial = (l: Pick<ReconLine, "state" | "payout" | "resolvedOrders">) =>
  l.state === "ORDERS_UNRESOLVED" && !!l.payout && l.resolvedOrders.length > 0;

/** A cross-border credit whose only gap is the slice the remitting bank kept
 *  between its quoted rate and the AED it credited. Still a Variance on screen,
 *  but bookable: the remainder goes to Exchange Gain or Loss.
 *  Mirrors isBankFxVariance() in lib/reconciliation/engine.ts. */
export const BANK_FX_VARIANCE_LIMIT_PCT = 0.01;
export const BANK_FX_VARIANCE_CEILING_AED = 500;
export const bankFxVarianceLimit = (bankAmount: number) =>
  Math.max(1, Math.min(Math.abs(bankAmount) * BANK_FX_VARIANCE_LIMIT_PCT, BANK_FX_VARIANCE_CEILING_AED));

/** Currency is deliberately not a condition — an AED payout's small gap is the
 *  bank's cut too. See isBankFxVariance() in lib/reconciliation/engine.ts. */
export const isBankFxVariance = (
  l: Pick<ReconLine, "state" | "payout" | "resolvedOrders" | "variance" | "bankAmount">,
) =>
  l.state === "PAYOUT_VARIANCE" &&
  !!l.payout &&
  l.resolvedOrders.length > 0 &&
  Math.abs(l.variance) <= bankFxVarianceLimit(l.bankAmount);

/** Settled, a partial that can be confirmed with lines still unmatched, or a
 *  cross-border credit whose only gap is the bank's own cut. */
/** Whether a payout's `source` names a real archived file that can be
 *  downloaded, or is just a provenance marker.
 *
 *  Payouts pulled from a gateway API store source="stripe-api" — there is no
 *  document behind them. The UI used to offer a Download button whenever
 *  `source` was truthy, which sent the browser to
 *  /api/files/by-name?filename=stripe-api and returned "no such file exists"
 *  for all 68 API-synced payouts. */
export const isDownloadableSource = (source: string | null | undefined): boolean =>
  !!source && /\.(xlsx|xls|csv|pdf)$/i.test(source);

/** Confirming asserts "this credit is right", which means nothing without the
 *  payout that proves it — the API refuses it outright (NoPayoutToConfirmError).
 *  The payout check is explicit rather than implied by SETTLED so the button
 *  can never reappear on a fileless row. */
export const isConfirmable = (
  l: Pick<ReconLine, "state" | "payout" | "resolvedOrders" | "variance" | "bankAmount">,
) => !!l.payout && (l.state === "SETTLED" || isConfirmablePartial(l) || isBankFxVariance(l));

export const STATE_META = {
  SETTLED: { label: "Settled", tone: "ok" },
  PAYOUT_VARIANCE: { label: "Variance", tone: "bad" },
  ORDERS_UNRESOLVED: { label: "Orders unresolved", tone: "warn" },
  AWAITING_PAYOUT: { label: "Awaiting payout", tone: "info" },
} as const;
