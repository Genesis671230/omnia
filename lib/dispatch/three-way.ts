// Store orders vs Zoho invoices vs the dispatch sheet, order by order. Pure.
//
//   ours      the order in the store DB (counted sale per lib/orders/sale-rule.ts)
//   verified  the Zoho invoice total — the amount backed by a document
//   sheet     the dispatch-sheet rows (month sheet, else intake): sale rows
//             compared on their ORIGINAL amount (left + refunded); exchange /
//             repair / pending rows are shipments for an earlier sale, never a
//             duplicate or a sale
//
// One status per order (worst first in ORDER):
//   missing_in_sheet   counted sale the sheet never logged
//   cancel_mismatch    one side cancelled/refunded it, the other counts a sale
//   sheet_only         sheet sale row, no counted store sale
//   amount_diff        all three present, amounts disagree
//   duplicate_in_sheet the sale logged more than once
//   no_invoice         sale + sheet row, no Zoho invoice
//   exchange           only exchange / repair shipments for it in the range
//   other_month        the store dates it in another month; this range's sheet
//                      has it (logged late, or an exchange) — never in totals
//   cancelled_refunded both sides say cancelled / fully refunded — consistent
//   ok                 sale, invoice and sheet agree
// Tolerance: the larger of AED 1 and 2% (SAR/KWD/OMR orders are converted on
// different days on each side). Timing: store order day vs sheet day.

import { isCountedSale, type SaleRuleOrder } from "@/lib/orders/sale-rule";
import { dubaiDayKey } from "@/lib/dubai-day";
import type { SheetRow, SheetTab } from "@/lib/integrations/dispatch-sheet-read";

export type TwOrder = SaleRuleOrder & {
  order_number: string; order_date: string | null; customer_name?: string | null; country?: string | null;
  currency?: string | null; gross_original?: number | null; refunded_amount?: number | null;
};
export type InvoiceIndex = Map<string, { numbers: string[]; totalAed: number; org: string }>;

export type TwStatus =
  | "missing_in_sheet" | "cancel_mismatch" | "sheet_only" | "amount_diff" | "duplicate_in_sheet"
  | "no_invoice" | "exchange" | "other_month" | "cancelled_refunded" | "ok";
export const TW_ORDER: TwStatus[] = ["missing_in_sheet", "cancel_mismatch", "sheet_only", "amount_diff", "duplicate_in_sheet", "no_invoice", "exchange", "other_month", "cancelled_refunded", "ok"];
export const TW_PROBLEMS = new Set<TwStatus>(["missing_in_sheet", "cancel_mismatch", "sheet_only", "amount_diff", "duplicate_in_sheet", "no_invoice"]);

export type TwRow = {
  order: string;
  day: string | null;
  status: TwStatus;
  reason: string;
  store: string;
  customer: string;
  country: string;
  gateway: string;
  financialStatus: string;
  /** A counted sale the store dates inside the range — the only orders in the store totals
   *  (the same set as the dashboard's sales ledger). */
  counted: boolean;
  storeDay: string | null;
  storeCurrency: string;
  storeOriginal: number | null;
  oursAed: number | null;
  storeRefundedAed: number | null;
  verifiedAed: number | null;
  invoices: string[];
  /** Original sale per the sheet (left + refunded). */
  sheetAed: number | null;
  sheetLeftAed: number | null;
  sheetRefundedAed: number | null;
  sheetKind: SheetRow["kind"] | null;
  sheetDay: string | null;
  sheetCurrency: string;
  sheetOriginal: number | null;
  /** Sheet day − store day; null when either is missing. */
  timingDays: number | null;
  sheet: SheetRow[];
  /** Exchange / repair / pending shipments for this order in the range. */
  shipments: SheetRow[];
  lane: SheetTab;
};

type Bucket = { orders: number; oursAed: number; sheetAed: number };
export type TwSummary = {
  orders: number;
  ours: { orders: number; aed: number };
  verified: { orders: number; aed: number };
  sheet: { orders: number; aed: number; leftAed: number; refundedAed: number };
  byStatus: Record<TwStatus, Bucket>;
  byLane: Record<SheetTab, { orders: number; inSheet: number; oursAed: number; sheetAed: number }>;
  timing: { differentDay: number; differentMonth: number };
  foreignCurrency: number;
  shipments: number;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const norm = (s: string) => s.trim().replace(/^#/, "").toUpperCase();
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.max(Math.abs(a), Math.abs(b)) * 0.02);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const SALE_KINDS = new Set(["sale", "refunded", "partial_refund", "cancelled"]);

export function compareThreeWay(input: {
  fromDay: string;
  toDay: string;
  orders: TwOrder[];
  invoices: InvoiceIndex;
  sheet: SheetRow[];
}): { rows: TwRow[]; summary: TwSummary } {
  const inRange = (d: string | null) => Boolean(d && d >= input.fromDay && d <= input.toDay);

  const orderBy = new Map<string, TwOrder>();
  for (const o of input.orders) orderBy.set(norm(o.order_number), o);
  const sheetBy = new Map<string, SheetRow[]>();
  for (const s of input.sheet) sheetBy.set(norm(s.order), [...(sheetBy.get(norm(s.order)) ?? []), s]);

  const keys = new Set<string>();
  for (const o of input.orders) if (inRange(dubaiDayKey(o.order_date))) keys.add(norm(o.order_number));
  for (const s of input.sheet) if (inRange(s.day)) keys.add(norm(s.order));

  const rows: TwRow[] = [];
  for (const k of keys) {
    const o = orderBy.get(k);
    const all = sheetBy.get(k) ?? [];
    const saleRows = all.filter((s) => SALE_KINDS.has(s.kind));
    const shipments = all.filter((s) => !SALE_KINDS.has(s.kind));
    const sale = saleRows[0] ?? null;
    const inv = input.invoices.get(k) ?? null;
    const storeDay = o ? dubaiDayKey(o.order_date) : null;
    // Same set as the dashboard: a counted sale the store dates in this range.
    const countedAny = o ? isCountedSale(o) : false;
    const counted = countedAny && inRange(storeDay);
    const fs = (o?.financial_status || "").toLowerCase();
    const storeGone = fs === "cancelled" || fs === "voided" || fs === "refunded";
    const oursAed = o ? r2(Number(o.gross_aed) || 0) : null;
    const sheetAed = sale?.grossAed ?? null;
    const sheetGone = sale ? sale.kind === "cancelled" || sale.kind === "refunded" : false;
    const verifiedAed = inv ? r2(inv.totalAed) : null;
    const lane: SheetTab = (sale ?? all[0])?.tab ?? ((o?.country || "").toUpperCase() === "AE" ? "Local" : "SMSA");
    const sheetDay = sale?.day ?? all[0]?.day ?? null;

    let status: TwStatus;
    let reason: string;
    if (!sale && shipments.length && !counted) {
      status = "exchange";
      reason = `${shipments.map((s) => s.saleType || s.kind).join(", ")} shipment for an earlier order`;
    } else if (countedAny && !counted) {
      status = "other_month";
      reason = `Store order dated ${storeDay}; the sheet logged it ${sale?.day ?? sheetDay} — counted in ${storeDay?.slice(0, 7)}, not here`;
    } else if (!sale && !counted) {
      continue; // cancelled / unpaid store order nobody logged — nothing to reconcile
    } else if (!sale) {
      status = "missing_in_sheet";
      reason = `Not logged in the ${lane === "Local" ? "Local orders" : "SMSA Orders"} tab`;
    } else if (sheetGone && (storeGone || !counted)) {
      status = "cancelled_refunded";
      reason = `Sheet: ${sale.comments || sale.kind} · store: ${fs || "not a sale"}`;
    } else if (sheetGone && counted) {
      status = "cancel_mismatch";
      reason = `Sheet says ${sale.kind === "cancelled" ? "cancelled" : "fully refunded"} (${sale.comments || "—"}) but the store still counts it as a ${fs} sale`;
    } else if (!counted && storeGone) {
      status = "cancel_mismatch";
      reason = `Store says ${fs}, the sheet still shows it as a sale`;
    } else if (!counted) {
      status = "sheet_only";
      reason = !o ? "In the sheet, but no store order with this number"
        : !inRange(storeDay) ? `Store order is dated ${storeDay}, outside this range`
        : `In the sheet, but the store order is ${fs || "not a counted sale"}`;
    } else if (saleRows.length > 1) {
      status = "duplicate_in_sheet";
      reason = `Logged ${saleRows.length} times (${saleRows.map((s) => `${s.source} row ${s.row}`).join(", ")})`;
    } else if (!inv) {
      status = "no_invoice";
      reason = "No Zoho invoice for this order yet";
    } else {
      const diffs: string[] = [];
      if (sheetAed != null && oursAed != null && !close(sheetAed, oursAed)) diffs.push(`sheet ${sheetAed} vs store ${oursAed}`);
      if (verifiedAed != null && oursAed != null && !close(verifiedAed, oursAed)) diffs.push(`Zoho ${verifiedAed} vs store ${oursAed}`);
      status = diffs.length ? "amount_diff" : "ok";
      reason = diffs.length ? diffs.join(" · ") : sale.kind === "partial_refund" ? `Agree · partly refunded AED ${sale.cancelledRefundedAed ?? 0}` : "Store, Zoho and sheet agree";
    }

    rows.push({
      order: o?.order_number ?? (sale ?? all[0]).order, day: storeDay ?? sheetDay, status, reason,
      store: o?.store_id ?? "", customer: o?.customer_name || sale?.party || all[0]?.party || "", country: (o?.country || "").toUpperCase(),
      gateway: o?.gateway ?? sale?.gateway ?? "", financialStatus: o?.financial_status ?? "", counted,
      storeDay, storeCurrency: (o?.currency || "AED").toUpperCase(), storeOriginal: o?.gross_original != null ? Number(o.gross_original) : null,
      oursAed, storeRefundedAed: o?.refunded_amount != null ? Number(o.refunded_amount) : null,
      verifiedAed, invoices: inv?.numbers ?? [],
      sheetAed, sheetLeftAed: sale?.amountAed ?? null, sheetRefundedAed: sale?.cancelledRefundedAed ?? null,
      sheetKind: sale?.kind ?? all[0]?.kind ?? null, sheetDay,
      sheetCurrency: (sale?.currency || "AED").toUpperCase(), sheetOriginal: sale?.amountOriginal ?? null,
      timingDays: storeDay && sheetDay ? dayDiff(sheetDay, storeDay) : null,
      sheet: saleRows, shipments, lane,
    });
  }
  rows.sort((a, b) => (b.day ?? "").localeCompare(a.day ?? "") || a.order.localeCompare(b.order));

  const empty = (): Bucket => ({ orders: 0, oursAed: 0, sheetAed: 0 });
  const summary: TwSummary = {
    orders: rows.length,
    ours: { orders: 0, aed: 0 }, verified: { orders: 0, aed: 0 }, sheet: { orders: 0, aed: 0, leftAed: 0, refundedAed: 0 },
    byStatus: Object.fromEntries(TW_ORDER.map((s) => [s, empty()])) as Record<TwStatus, Bucket>,
    byLane: { SMSA: { orders: 0, inSheet: 0, oursAed: 0, sheetAed: 0 }, Local: { orders: 0, inSheet: 0, oursAed: 0, sheetAed: 0 } },
    timing: { differentDay: 0, differentMonth: 0 },
    foreignCurrency: 0,
    shipments: 0,
  };
  for (const r of rows) {
    if (r.counted) { summary.ours.orders += 1; summary.ours.aed += r.oursAed ?? 0; }
    if (r.counted && r.verifiedAed != null) { summary.verified.orders += 1; summary.verified.aed += r.verifiedAed; }
    if (r.sheet.length) {
      summary.sheet.orders += 1; summary.sheet.aed += r.sheetAed ?? 0;
      summary.sheet.leftAed += r.sheetLeftAed ?? 0; summary.sheet.refundedAed += r.sheetRefundedAed ?? 0;
    }
    const b = summary.byStatus[r.status];
    b.orders += 1; b.oursAed += r.oursAed ?? 0; b.sheetAed += r.sheetAed ?? 0;
    const l = summary.byLane[r.lane];
    if (r.counted) { l.orders += 1; l.oursAed += r.oursAed ?? 0; }
    if (r.counted && r.sheet.length) l.inSheet += 1;
    if (r.sheet.length) l.sheetAed += r.sheetAed ?? 0;
    if (r.timingDays) {
      summary.timing.differentDay += 1;
      if (r.storeDay && r.sheetDay && r.storeDay.slice(0, 7) !== r.sheetDay.slice(0, 7)) summary.timing.differentMonth += 1;
    }
    if (r.storeCurrency !== "AED" || r.sheetCurrency !== "AED") summary.foreignCurrency += 1;
    summary.shipments += r.shipments.length;
  }
  for (const k of ["ours", "verified"] as const) summary[k].aed = r2(summary[k].aed);
  summary.sheet.aed = r2(summary.sheet.aed); summary.sheet.leftAed = r2(summary.sheet.leftAed); summary.sheet.refundedAed = r2(summary.sheet.refundedAed);
  for (const b of Object.values(summary.byStatus)) { b.oursAed = r2(b.oursAed); b.sheetAed = r2(b.sheetAed); }
  for (const l of Object.values(summary.byLane)) { l.oursAed = r2(l.oursAed); l.sheetAed = r2(l.sheetAed); }
  return { rows, summary };
}
