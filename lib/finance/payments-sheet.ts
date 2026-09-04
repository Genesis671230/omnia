// Payments-tracking Google Sheet ("SMSA Orders" / "Local orders" tabs) —
// the I/O half. Read-only. Ops confirms payment receipt manually in the
// sheet; this reads that confirmation for (a) matching against Zoho
// invoices still marked unpaid, and (b) standalone insights (see
// lib/finance/payments-sheet-insights.ts for the pure computation over the
// rows this file reads — deliberately split out so the client can reuse
// that exact aggregation code for instant local filtering).
//
// Column layout is read from row 1 at request time (name -> index), not
// hardcoded — the whole team edits this sheet and column order isn't
// guaranteed stable. Confirmed live on 2026-09-03:
//   SMSA Orders:   ... Date, Order #, ... Currency, In AED, Party, Part,
//                  ... Payment Authorised - Status, Actual Payment Status,
//                  Payment Received Date, ... Cancelled / Refunded Amount, ...
//   " Local orders": ... Date, Order #, ... Type of Sale, Total, Party, ...
//                  Actual Payment Status, Payment Received on, ...
//                  Cancelled / Refunded Amount, ...
//
// Two columns are easy to conflate and MUST be read separately:
//   - "Party" (both tabs) — the payment gateway (telr, stripe, tabby,
//     tamara, checkout, shopify, COD). On SMSA this is "NA" for exchange
//     rows; on Local it can itself say "Exchange"/"Exchange/COD".
//   - "Part" (SMSA) / "Type of Sale" (Local) — the actual sale-type flag:
//     "Paid", "COD", "Exchange", "Exchange/Paid", "Exchange/COD", "Repair".
//     THIS is the authoritative exchange signal for both tabs — verified
//     live: 9 of 11 SMSA exchange rows have a real gateway in Party (e.g.
//     "stripe") alongside "Exchange/Paid" in Part, i.e. an exchange can
//     still be gateway-paid, so exchange status and gateway are independent
//     facts, not mutually exclusive. Using Party text alone (the old
//     approach) undercounted Local exchanges by 12 rows (37 vs the real 49).
//
// "Actual Payment Status" is the real paid/unpaid flag ("Payment Received"
// or blank) — "Payment Received Date"/"Payment Received on" is NOT a clean
// date cell, it's a narrative string like
// "Payment Received on 03.08.2026 (25,794.83)" (settlement date + the
// whole payout batch's total, shared across every order in that batch).
// The sheet's own "Date" column is a display string like "01.Aug.2026"
// (DD.Mon.YYYY), not a real date value. SMSA's "Currency" column carries
// the order's original currency (SAR/KWD/OMR/QAR/BHD/AED, with case typos
// like "SaR" seen live) — Local orders has no currency column, it's UAE/AED
// only by definition of that tab.
//
// Cross-checked against this sheet's own manually-maintained " Summary "
// tab on 2026-09-03: this module's tab-count split (SMSA 500 / Local 688)
// and amount split (SMSA AED 626,687.37 / Local AED 789,636.20) matched the
// Summary tab's numbers to within a few cents, as did the cancelled total
// (AED 55,299.15 here vs their 55,299.16).

import { resolveTabName, readAllValues } from "@/lib/integrations/google-sheets";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import type { PartyInfo, PaymentSheetRow, SheetTabKey } from "@/lib/finance/payments-sheet-insights";

export * from "@/lib/finance/payments-sheet-insights";

const DEFAULT_PAYMENTS_SPREADSHEET_ID = process.env.GOOGLE_SHEETS_PAYMENTS_SPREADSHEET_ID;

export function paymentsSheetConfigured(): boolean {
  return Boolean(
    DEFAULT_PAYMENTS_SPREADSHEET_ID &&
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  );
}

// Accepts either a bare spreadsheet id or a full Google Sheets URL (any of
// the URL shapes Sheets actually produces) — this is what a pasted URL goes
// through before hitting the Sheets API.
export function extractSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = /\/d\/([a-zA-Z0-9-_]+)/.exec(trimmed);
  if (m) return m[1];
  // Looks like a bare id already (Sheets ids are long alnum/-/_ strings).
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

const SHEET_TABS = { smsa: "SMSA Orders", local: "Local orders" } as const;

// Canonical gateway names, matching what deriveGateway()/WorkbenchInvoice
// already use elsewhere (lib/finance/derive-gateway.ts, the Payouts nav).
// These stay plain (no country suffix) — Zoho's own gateway field doesn't
// carry one, and lib/finance/build-workbench-invoices.ts / the
// sheet-matches gateway-mismatch check compares against this plain form.
const GATEWAY_ALIASES: Record<string, string> = {
  cod: "COD",
  telr: "Telr",
  stripe: "Stripe",
  tabby: "Tabby",
  tamara: "Tamara",
  checkout: "Checkout",
  shopify: "Shopify",
};
// Tokens that show up in "Party" but aren't a payment gateway at all.
const NON_GATEWAY_TOKENS = new Set(["exchange", "na", "n/a", "-", ""]);

// "checkout+stripe", "telr + COD" — split on the separators actually seen
// in this sheet, normalize each token, then classify. Party's job is
// purely gateway extraction — exchange detection lives in the "Part"/
// "Type of Sale" column instead (see readTab below).
export function normalizeParty(raw: string | undefined | null): PartyInfo {
  const original = (raw ?? "").trim();
  const tokens = original
    .split(/[+/]|(?:\s+and\s+)/i)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const gatewayTokens = tokens.filter((t) => !NON_GATEWAY_TOKENS.has(t));
  const resolved = gatewayTokens.map((t) => GATEWAY_ALIASES[t] ?? null);
  const uniqueResolved = [...new Set(resolved)];

  if (uniqueResolved.length === 1 && uniqueResolved[0]) {
    return { raw: original, canonical: uniqueResolved[0], isSplit: false };
  }
  return { raw: original, canonical: null, isSplit: gatewayTokens.length > 1 };
}

// "Payment Received on 03.08.2026 (25,794.83)" -> "2026-08-03". The parens
// amount is the whole payout batch's total, not this order's own amount —
// intentionally discarded here, it's not useful per-row.
const PAYMENT_NOTE_RE = /(\d{2})\.(\d{2})\.(\d{4})/;

export function parsePaymentReceivedNote(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const m = PAYMENT_NOTE_RE.exec(raw);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const SHEET_DATE_RE = /^(\d{1,2})\.([A-Za-z]{3,9})\.(\d{4})$/;

// "01.Aug.2026" -> "2026-08-01". Returns null for blank/unparseable cells
// (this sheet has trailing blank rows, and manual entry isn't perfectly
// consistent) rather than throwing — a bad date on one row shouldn't sink
// the whole insights computation.
export function parseSheetDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const m = SHEET_DATE_RE.exec(raw.trim());
  if (!m) return null;
  const [, dd, monStr, yyyy] = m;
  const mi = MONTHS.indexOf(monStr.slice(0, 3).toLowerCase());
  if (mi === -1) return null;
  const day = Number(dd), month = mi + 1, year = Number(yyyy);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseAmount(raw: string | undefined | null): number {
  if (!raw) return 0;
  const n = Number(raw.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

// Live values seen in SMSA's Currency column: SAR, OMR, QAR, AED, KWD, plus
// case typos (SaR, saR) and "NA" for blank days — normalize case/whitespace
// only, don't guess at typo'd currency codes beyond casing.
function normalizeCurrency(raw: string | undefined | null): string | null {
  const v = (raw ?? "").trim().toUpperCase();
  if (!v || v === "NA" || v === "N/A") return null;
  return v;
}

// Region tag for the gateway breakdown, per the business's own convention
// (order-number prefixes already use "SA"/"KSA" for Saudi elsewhere — see
// lib/finance/extract-order-number.ts). SAR maps to the "KSA" label
// explicitly; every other currency is used as its own region tag (KWD,
// OMR, QAR, BHD) since this business has no separate country word for
// those the way it does for Saudi. AED orders on the SMSA (international)
// tab are the rare case of a UAE customer routed through that tab.
function regionForCurrency(currency: string | null): string {
  if (!currency) return "";
  if (currency === "SAR") return "KSA";
  if (currency === "AED") return "UAE";
  return currency;
}

function headerIndex(headers: string[], name: string): number {
  return headers.findIndex((h) => h.trim().toLowerCase() === name.trim().toLowerCase());
}

const TAB_COLUMNS: Record<SheetTabKey, {
  order: string; party: string; saleType: string; status: string; received: string;
  date: string; amount: string; cancelled: string; currency: string | null;
}> = {
  smsa: {
    order: "Order #", party: "Party", saleType: "Part", status: "Actual Payment Status",
    received: "Payment Received Date", date: "Date", amount: "In AED",
    cancelled: "Cancelled / Refunded Amount", currency: "Currency",
  },
  // Local orders is UAE-only (single currency) — "Total" is its order-total
  // column, there's no separate original/AED split like SMSA has, and no
  // currency column since it's always AED.
  local: {
    order: "Order #", party: "Party", saleType: "Type of Sale", status: "Actual Payment Status",
    received: "Payment Received on", date: "Date", amount: "Total",
    cancelled: "Cancelled / Refunded Amount", currency: null,
  },
};

async function readTab(key: SheetTabKey, spreadsheetId: string): Promise<PaymentSheetRow[]> {
  const cols = TAB_COLUMNS[key];
  const tabName = await resolveTabName(SHEET_TABS[key], spreadsheetId);
  const values = await readAllValues(tabName, spreadsheetId);
  if (values.length === 0) return [];

  const headers = values[0];
  const idx = {
    order: headerIndex(headers, cols.order),
    party: headerIndex(headers, cols.party),
    saleType: headerIndex(headers, cols.saleType),
    status: headerIndex(headers, cols.status),
    received: headerIndex(headers, cols.received),
    date: headerIndex(headers, cols.date),
    amount: headerIndex(headers, cols.amount),
    cancelled: headerIndex(headers, cols.cancelled),
    currency: cols.currency ? headerIndex(headers, cols.currency) : -1,
    dup1: headerIndex(headers, "Duplicate customer"),
    dup2: headerIndex(headers, "Duplicate Check"),
  };
  if (idx.order === -1 || idx.party === -1 || idx.status === -1 || idx.received === -1) {
    throw new Error(`${SHEET_TABS[key]}: expected columns not found in header row (${headers.join(" | ")})`);
  }

  const rows: PaymentSheetRow[] = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const orderNumber = (row[idx.order] ?? "").trim() || null;
    if (!orderNumber) continue;

    const party = normalizeParty(row[idx.party] ?? "");
    const saleType = idx.saleType !== -1 ? (row[idx.saleType] ?? "").trim() : "";
    const isExchange = /exchange/i.test(saleType);
    const currency = idx.currency !== -1 ? normalizeCurrency(row[idx.currency]) : null;
    const region = key === "local" ? "UAE" : regionForCurrency(currency);
    const gatewayLabel = party.canonical ? (region ? `${party.canonical} ${region}` : party.canonical) : null;
    const receivedRaw = row[idx.received] ?? "";

    rows.push({
      tab: key,
      rowNumber: i + 1,
      orderNumber,
      date: idx.date !== -1 ? parseSheetDate(row[idx.date]) : null,
      party,
      saleType,
      isExchange,
      currency,
      region,
      gatewayLabel,
      actualPaymentStatus: (row[idx.status] ?? "").trim(),
      paymentReceivedRaw: receivedRaw,
      paymentReceivedDate: parsePaymentReceivedNote(receivedRaw),
      amountAed: idx.amount !== -1 ? parseAmount(row[idx.amount]) : 0,
      cancelledAmount: idx.cancelled !== -1 ? parseAmount(row[idx.cancelled]) : 0,
      isDuplicateFlagged: Boolean((idx.dup1 !== -1 && row[idx.dup1]?.trim()) || (idx.dup2 !== -1 && row[idx.dup2]?.trim())),
    });
  }
  return rows;
}

function resolveId(spreadsheetId?: string): string {
  const id = spreadsheetId || DEFAULT_PAYMENTS_SPREADSHEET_ID;
  if (!id) throw new Error("No spreadsheetId given and GOOGLE_SHEETS_PAYMENTS_SPREADSHEET_ID is not set");
  return id;
}

// Every row from both tabs, unfiltered — the basis for insights. Doesn't
// touch Zoho at all, so it stays available when Zoho is rate limited.
export async function readAllPaymentRows(spreadsheetId?: string): Promise<PaymentSheetRow[]> {
  const id = resolveId(spreadsheetId);
  const [smsa, local] = await Promise.all([readTab("smsa", id), readTab("local", id)]);
  return [...smsa, ...local];
}

// Rows where ops has confirmed payment receipt — candidates for the sheet
// -> Zoho invoice matching flow. A row with no confirmed payment has
// nothing to reconcile against Zoho.
export async function readConfirmedPaymentRows(spreadsheetId?: string): Promise<PaymentSheetRow[]> {
  const rows = await readAllPaymentRows(spreadsheetId);
  return rows.filter((r) => r.actualPaymentStatus.toLowerCase() === "payment received");
}

export type ExchangeLineItem = { sku: string; title: string; qty: number; totalAed: number };
export type ExchangeWithOrder = {
  tab: SheetTabKey;
  rowNumber: number;
  orderNumber: string;
  date: string | null;
  saleType: string;
  gatewayLabel: string | null;
  lineItems: ExchangeLineItem[] | null; // null when the order wasn't found in Supabase
};

// Joins exchange sheet rows to their order's line_items — "pull out the
// corresponding order and the corresponding SKUs used" for each exchange.
// Order lookup is Supabase-only (no Zoho), so this stays available even
// when Zoho is rate limited, same as the rest of this module.
export async function joinExchangeLineItems(
  exchanges: { tab: SheetTabKey; rowNumber: number; orderNumber: string; date: string | null; saleType: string; gatewayLabel: string | null }[],
): Promise<ExchangeWithOrder[]> {
  const orderNumbers = [...new Set(exchanges.map((e) => e.orderNumber))];
  const orders = await OrdersRepository.getDetailsByOrderNumbers(orderNumbers);
  const byOrderNumber = new Map(orders.map((o: any) => [String(o.order_number), o]));

  return exchanges.map((e) => {
    const order = byOrderNumber.get(e.orderNumber);
    const lineItems: ExchangeLineItem[] | null = order?.line_items
      ? (order.line_items as any[]).map((li) => ({
          sku: li.sku ?? "",
          title: li.title ?? li.name ?? "",
          qty: Number(li.qty ?? li.quantity ?? 0),
          totalAed: Number(li.total_aed ?? li.total ?? 0),
        }))
      : null;
    return { ...e, lineItems };
  });
}
