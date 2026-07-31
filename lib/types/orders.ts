// Shared between finance-workspace.tsx (recon view) and orders-ledger.tsx
// (order ledger view) — kept in one place so neither file needs to import
// the other for a type, which would create a real circular module.

export type OrderRow = {
  uid: string;
  store_id: string;
  order_number: string;
  order_date: string | null;
  customer_name: string;
  customer_phone: string;
  city: string;
  country: string;
  currency: string;
  gross_original: number;
  gross_aed: number;
  shipping_address1: string;
  shipping_address2:string;
  shipping_state:string;
  shipping_postcode:string;
  shipping_company:string;
  billing_address1:string;
  billing_address2:string;
  billing_state:string;
  billing_postcode:string;
  billing_company:string;
  gateway: string;
  gateway_raw: string;
  financial_status: string;
  fulfillment_status: string;
  fulfillment_stage: string;
  fulfillment_stage_updated_at: string | null;
  courier: string;
  tracking_number: string;
  tracking_url: string;
  awb_number: string;
  shipped_at: string | null;
  label_url: string;
  ship_error: string;
  // line_items is deliberately absent — /api/orders strips it from the list
  // response (3700+ orders × line items is real payload weight). The order
  // ledger lazy-fetches it per-order via GET /api/orders/:uid on row expand.
  payout_id: string | null;
  payout_status: string;
  in_payout_file: boolean;
  finance_status: "SETTLED" | "AWAITING_BANK" | "MISSING_PAYOUT" | "COD_PENDING";
};

// MISSING_PAYOUT reads as "Processing" here deliberately — most rows in this
// state are simply too new for a payout file to have arrived yet, and a
// blunt "Missing payout" pill on every fresh order reads as broken at a
// glance. The underlying finance_status value is unchanged; expand a row to
// see the real settlement chain (order placed → payout file seen → bank
// settled) via the Settlement tracker in ExpandedOrder.
export const ORDER_STATUS_META: Record<OrderRow["finance_status"], { label: string; tone: string }> = {
  SETTLED: { label: "Settled", tone: "ok" },
  AWAITING_BANK: { label: "Awaiting bank", tone: "warn" },
  MISSING_PAYOUT: { label: "Processing", tone: "muted" },
  COD_PENDING: { label: "COD pending", tone: "muted" },
};
