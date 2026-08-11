// New order → dispatch sheet row (SMSA Orders tab for international,
// Local Orders tab for UAE). Dormant until google-sheets.ts reports
// configured() — see that file for the setup steps.
//
// Column mapping is per-tab and EXACT (not generic aliases) — read from the
// real sheet on 2026-08-07:
//   SMSA Orders:  x, S.No, Date, Order #, Total Amt, Currency, In AED, Party,
//                 Part, Exc Rate, (blank), Status / Comments,
//                 Payment Authorised - Status, Actual Payment Status,
//                 Payment Received Date, Total Amt (Same Cur), Fee Deducted,
//                 Balance Received, Cancelled / Refunded Amount, Fee%,
//                 sales person, Refund Date
//   " Local orders" (note the tab's real title has a leading space):
//                 Duplicate customer, Duplicate Check, S.No, Date, Order #,
//                 Voucher #, Type of Sale, Total, Party, Customer, contact,
//                 " Comments", Payment Status, Delivery By,
//                 COD to Other Payment, Actual Payment Status,
//                 Payment Received on, OT Invoice#, Total Amt, Fee Deducted,
//                 Amount After Deduction, Cancelled / Refunded Amount,
//                 % Charged, sales person, "Shipment Status "
//
// Only unambiguous, order-placement-time fields are filled. Anything that's
// Sinan/Yaseen/Finance's manual domain (Payment Status, Actual Payment
// Status, Fee Deducted, Amount After Deduction, Delivery By, etc.) is left
// blank on purpose — this system proposes the order, it doesn't pre-empt the
// human confirmation step. "Party" vs "Customer" both exist on Local orders
// with no way to know the intended distinction from headers alone, so only
// the unambiguous "Customer" column is filled there.

import { googleSheetsConfigured, resolveTabName, readAllValues, appendRow, updateCells } from "@/lib/integrations/google-sheets";
import type { OrderRow } from "@/lib/normalize/order";

export const SMSA_TAB = "SMSA Orders";
export const LOCAL_TAB = "Local orders";

const DUBAI_OFFSET_MINUTES = 4 * 60;

// "Exact timing" per the ask — neither tab has a separate Time column, so
// the Date cell itself carries a full Dubai-local date+time rather than a
// bare date, sourced from the store's own order timestamp (Shopify/Woo),
// not the dispatch sheet or Zoho (neither of which carries placement time).
function dubaiDateTime(orderDateIso: string): string {
  const dubai = new Date(new Date(orderDateIso).getTime() + DUBAI_OFFSET_MINUTES * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dubai.getUTCFullYear()}-${pad(dubai.getUTCMonth() + 1)}-${pad(dubai.getUTCDate())} ${pad(dubai.getUTCHours())}:${pad(dubai.getUTCMinutes())}`;
}

function comment(order: OrderRow): string {
  return `Gateway: ${order.gateway} — needs payment confirmation — Sinan`;
}

// Header text (trimmed, lowercased) -> value, per tab. A header with no
// entry here is left blank — never guessed.
function smsaRowValues(order: OrderRow): Record<string, string> {
  return {
    "date": dubaiDateTime(order.order_date),
    "order #": order.order_number,
    "total amt": order.gross_original.toFixed(2),
    "currency": order.currency,
    "in aed": order.gross_aed.toFixed(2),
    "party": order.customer_name,
    "status / comments": comment(order),
  };
}

function localRowValues(order: OrderRow): Record<string, string> {
  return {
    "date": dubaiDateTime(order.order_date),
    "order #": order.order_number,
    "total": order.gross_original.toFixed(2),
    "customer": order.customer_name,
    "contact": order.customer_phone,
    "comments": comment(order),
  };
}

export function buildRowFromHeaders(tab: string, headers: string[], order: OrderRow): string[] {
  const values = tab.trim().toLowerCase() === LOCAL_TAB.toLowerCase() ? localRowValues(order) : smsaRowValues(order);
  return headers.map((header) => values[header.trim().toLowerCase()] ?? "");
}

// Local (UAE) → Local Orders tab / OnTrack; everything else → SMSA Orders
// tab / SMSA-DHL — same country-based split as the courier-cutoff logic in
// lib/alerts/order-alerts.ts.
export function tabForOrder(order: Pick<OrderRow, "country">): string {
  return order.country === "AE" ? LOCAL_TAB : SMSA_TAB;
}

// The header row's POSITION isn't trustworthy — observed live, repeatedly:
// someone sorting the shared sheet (by Date, without excluding row 1) drags
// the header into the data range and puts a data row in its place, sometimes
// within minutes of being restored. Freezing row 1 (a one-time spreadsheet
// setting) helps but doesn't fully stop a manual range-selected sort from
// including it. A row-level sort never scrambles a row's OWN cells, only
// which row it ends up as — so instead of assuming "row 1 is the header,"
// search for whichever row actually contains "Order #" and work relative to
// that. Bounded to the first 50 rows: a header that's fallen further than
// that means something worse happened and failing loudly is correct.
const HEADER_SEARCH_LIMIT = 50;

export function findHeaderRowIndex(rows: string[][]): number {
  const limit = Math.min(rows.length, HEADER_SEARCH_LIMIT);
  for (let i = 0; i < limit; i++) {
    if (rows[i].some((cell) => cell.trim().toLowerCase() === "order #")) return i;
  }
  return -1;
}

const headerCache = new Map<string, { resolvedTab: string; headerRowIndex: number; headers: string[]; orderNumberCol: number }>();

async function loadTabInfo(logicalTab: string) {
  const cached = headerCache.get(logicalTab);
  if (cached) return cached;

  const resolvedTab = await resolveTabName(logicalTab);
  const rows = await readAllValues(resolvedTab);
  const headerRowIndex = findHeaderRowIndex(rows);
  const headers = headerRowIndex === -1 ? [] : rows[headerRowIndex];
  const orderNumberCol = headers.findIndex((h) => h.trim().toLowerCase() === "order #");
  const info = { resolvedTab, headerRowIndex, headers, orderNumberCol };
  headerCache.set(logicalTab, info);
  return info;
}

// Existing order numbers already in the sheet — checked before every append
// so a restart, a re-sync, or Sinan manually adding a row first never
// produces a duplicate. Re-read fresh each call (not cached across calls)
// since the whole point is catching rows added since we last looked.
export async function getExistingOrderNumbers(logicalTab: string): Promise<Set<string>> {
  const { resolvedTab, headerRowIndex, orderNumberCol } = await loadTabInfo(logicalTab);
  if (orderNumberCol === -1) return new Set();
  const rows = await readAllValues(resolvedTab);
  const set = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    if (i === headerRowIndex) continue;
    const value = (rows[i][orderNumberCol] ?? "").trim();
    if (value) set.add(value);
  }
  return set;
}

export async function appendOrderToDispatchSheet(order: OrderRow): Promise<void> {
  if (!googleSheetsConfigured()) return;

  const logicalTab = tabForOrder(order);
  const { resolvedTab, headers, orderNumberCol } = await loadTabInfo(logicalTab);
  // Guard against a missing/unfindable header (see the note above
  // findHeaderRowIndex) — refuse to write rather than silently produce
  // garbage; this surfaces through the same "dispatch sheet write failed"
  // path as any other append failure.
  if (orderNumberCol === -1) {
    throw new Error(`"${resolvedTab}" has no "Order #" column anywhere in its first ${HEADER_SEARCH_LIMIT} rows — header row may be missing or corrupted`);
  }
  const row = buildRowFromHeaders(logicalTab, headers, order);
  await appendRow(resolvedTab, row);
}

export type MarkPaidResult = "updated" | "not-in-sheet" | null;
export type CellUpdate = { row: number; col: number; value: string };

// Pure: given the tab's live headers + all rows, work out which cells (if
// any) to write for a payment confirmation, without touching the network.
// Kept separate from markOrderPaidInSheet below so the row/column-finding
// logic is unit-testable the same way buildRowFromHeaders is.
export function computePaidCellUpdates(
  logicalTab: string,
  headers: string[],
  rows: string[][],
  orderNumber: string,
  paidAtIso: string,
  source: string,
  headerRowIndex = 0,
): { updates: CellUpdate[] } | "not-in-sheet" | null {
  const isLocal = logicalTab.trim().toLowerCase() === LOCAL_TAB.toLowerCase();
  const orderNumberCol = headers.findIndex((h) => h.trim().toLowerCase() === "order #");
  const statusCol = headers.findIndex((h) => h.trim().toLowerCase() === "actual payment status");
  const dateCol = headers.findIndex((h) => h.trim().toLowerCase() === (isLocal ? "payment received on" : "payment received date"));
  if (orderNumberCol === -1 || (statusCol === -1 && dateCol === -1)) return null;

  const rowIndex = rows.findIndex((r, i) => i !== headerRowIndex && (r[orderNumberCol] ?? "").trim() === orderNumber);
  if (rowIndex === -1) return "not-in-sheet"; // order was never appended (or is off the sheet's window) — nothing to update

  const sheetRow = rowIndex + 1; // rows[] is 0-indexed, so rows[k] is always sheet row k+1 — independent of where the header row landed
  const updates: CellUpdate[] = [];
  // "Paid - <source>" rather than a bare "Paid" — Sinan/Yaseen asked to see
  // which gateway auto-confirmed it (Stripe vs Telr) at a glance, not just
  // that automation touched the row.
  if (statusCol !== -1) updates.push({ row: sheetRow, col: statusCol, value: `Paid - ${source}` });
  if (dateCol !== -1) updates.push({ row: sheetRow, col: dateCol, value: dubaiDateTime(paidAtIso) });
  return { updates };
}

// "Actual Payment Status" / "Payment Received Date(-on)" are Sinan/Yaseen's
// manual columns everywhere else in this file (see the header comment) — the
// one exception is here: a live gateway-API confirmation (Stripe or Telr —
// see lib/sync/stripe-payment-confirm.ts / telr-payment-confirm.ts) is
// evidence this system trusts, so those flows are allowed to fill them.
// Only ever touches a row that already exists (appended at order-placement
// time) — never appends, and never touches any other column, so a human's
// own edits on that row are left alone.
export async function markOrderPaidInSheet(
  order: Pick<OrderRow, "order_number" | "country">,
  paidAtIso: string,
  source: string,
): Promise<MarkPaidResult> {
  if (!googleSheetsConfigured()) return null;

  const logicalTab = tabForOrder(order);
  const { resolvedTab, headers, headerRowIndex } = await loadTabInfo(logicalTab);
  const rows = await readAllValues(resolvedTab);

  const result = computePaidCellUpdates(logicalTab, headers, rows, order.order_number, paidAtIso, source, headerRowIndex);
  if (result === null || result === "not-in-sheet") return result;

  await updateCells(resolvedTab, result.updates);
  return "updated";
}
