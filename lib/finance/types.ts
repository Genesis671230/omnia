export type ZohoInvoiceStatus =
  | "unpaid" | "overdue" | "partially_paid" | "paid"
  | "sent" | "draft" | "viewed" | "void";

export type ResidualCategory =
  | "truly_unpaid"      // balance ≈ total, nothing paid
  | "fee_residual"      // balance < total, ratio < 10% — likely Aug 11 broken
  | "partial_payment";  // balance < total, ratio ≥ 10% — legit partial

export type WorkbenchInvoice = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  status: ZohoInvoiceStatus;
  total: number;
  balance: number;
  currency: string;
  customerName: string;
  orderNumber: string | null;
  gateway: string;
  country: string | null;
  gatewaySource: "settlement" | "order" | "cod" | "unknown";
  settlementId: string | null;
  hasBankCredit: boolean;
  residualCategory: ResidualCategory;
  isExchange: boolean;
  exchangeSiblings: {
    invoiceId: string;
    invoiceNumber: string;
    status: ZohoInvoiceStatus;
    balance: number;
    total: number;
  }[];
};

export type WorkbenchResponse = {
  invoices: WorkbenchInvoice[];
  totalCount: number;
  gatewayCounts: Record<string, number>;
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  exchangeCount?: number;
};

/** A reason a sheet-matched row needs a manual look before auto-closing.
 *  "gateway-mismatch" (comparing the sheet's Party against the invoice's
 *  deriveGateway() output) was dropped — that comparison was noisy (Zoho's
 *  own gateway derivation frequently resolves to "Unknown" for reasons
 *  unrelated to the sheet being wrong) and comparing two different naming
 *  schemes doesn't tell you what you actually need to know. What matters is
 *  whether the sheet row resolves to a real Zoho clearing account — see
 *  "account-unresolved", computed client-side in sheet-match-panel.tsx
 *  against the already-loaded Zoho account list (lib/finance/gateway-account-map.ts). */
export type SheetMatchFlag =
  | "split-payment"      // Party names more than one gateway (e.g. "telr + COD")
  | "exchange-party"     // The sheet's sale-type column names this an exchange
  | "exchange-invoice"   // The Zoho invoice itself is part of an exchange pair
  | "duplicate-flagged"  // Ops already flagged this sheet row as a duplicate
  | "no-payment-date"    // Couldn't parse a date out of the payment-received note
  | "account-unresolved" // No matching Zoho clearing account found — closing will fall back to the default deposit account
  | "multiple-sheet-rows"; // More than one sheet row points at this order number

export type SheetInvoiceMatch = {
  invoiceId: string;
  invoiceNumber: string;
  orderNumber: string;
  customerName: string;
  balance: number;
  currency: string;
  invoiceGateway: string;
  invoiceIsExchange: boolean;
  sheetTab: "smsa" | "local";
  sheetRow: number;
  sheetPartyRaw: string;
  sheetGateway: string | null;
  /** "KSA" | "UAE" | "KWD" | "QAR" | "OMR" | "BHD" | "" — feeds the Zoho
   *  account resolver (lib/finance/gateway-account-map.ts), same value the
   *  insights panel uses for its gateway breakdown labels. */
  region: string;
  paymentDate: string | null;
  paymentMode: string;
  flags: SheetMatchFlag[];
};

export type UnmatchedSheetRow = {
  tab: "smsa" | "local";
  rowNumber: number;
  orderNumber: string;
};

export type SheetMatchesResponse = {
  matches: SheetInvoiceMatch[];
  unmatchedSheetRows: UnmatchedSheetRow[];
  from: string;
  to: string;
  /** True when the Zoho half of this route failed (e.g. rate limited) —
   *  matches/flags are unavailable, but the raw sheet rows below still are. */
  zohoUnavailable: boolean;
  zohoError: string | null;
  /** Raw sheet rows, always present — this is what stays visible when
   *  zohoUnavailable is true and there's nothing to match against. */
  sheetRows: {
    tab: "smsa" | "local";
    rowNumber: number;
    orderNumber: string;
    partyRaw: string;
    paymentDate: string | null;
  }[];
};