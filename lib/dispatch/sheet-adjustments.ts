// Dispatch sheet → order adjustments the app is missing.
//
// Ops record cancellations, refunds, returns and exchanges in the month's
// dispatch sheet (tabs "SMSA Orders" and " Local orders"), but nobody marks
// them on the order, so the dashboard keeps counting them as live sales
// waiting for money. This lists every such order with the adjustment the
// sheet implies, for the founder to confirm. Pure — no I/O.
//
// Sheet conventions (dispatch_sheet_coverage):
//   kind "cancelled"       → Cancelled (not a sale)
//   kind "refunded"        → full refund; "return" in the comments → Returned
//   kind "partial_refund"  → Refunded, keeping what the sheet still shows
//   an Exchange* shipment row under the order's number → Exchanged
// Only counted sales the store dates in the month are suggested — the same
// set the Sales & receipts table shows.

import { dubaiDayKey } from "@/lib/dubai-day";
import { isCountedSale, type SaleRuleOrder } from "@/lib/orders/sale-rule";
import type { SheetRow } from "@/lib/integrations/dispatch-sheet-read";
import { norm } from "./three-way";

export type SuggestedKind = "cancelled" | "returned" | "refunded" | "exchanged";

export type SheetAdjOrder = SaleRuleOrder & {
  uid: string;
  order_number: string;
  store_id: string;
  order_date: string | null;
  customer_name: string | null;
  gateway: string;
  gross_aed: number | null;
};

export type SheetAdjustment = {
  uid: string;
  orderNumber: string;
  store: string;
  orderDay: string;
  customer: string;
  gateway: string;
  grossAed: number;
  kind: SuggestedKind;
  /** What the sheet says went back to the customer (AED). */
  refundedAed: number;
  /** Kept back from the credit — the part of a partial refund the customer kept. */
  deductAed: number;
  /** Where in the sheet, for the note on the adjustment. */
  sheetRef: string;
  sheetComment: string;
  /** Every source that says so: sheet row, Zoho credit notes, gateway refunds. */
  evidence: string[];
  /** Where the refund amount came from: "gateway" | "Zoho credit note" | "sheet". */
  amountSource: string;
  /** When it happened: gateway refund date, else credit-note date, else the sheet's day. */
  eventDate: string | null;
  /** Closed as received earlier — the refund goes on top of it. */
  wasReceived: boolean;
  /** Set when the order already carries an adjustment that blocks this one. */
  blockedBy: string | null;
  /** The sheet names a refund but no AED amount we can trust — ask for it. */
  needsAmount: boolean;
};

/** "1 Item refunded (714)", "Refund - 211.50" → 714 / 211.5. Null when the
 *  comment names another currency (SAR / KWD …) or no number at all. */
export function refundFromComment(comment: string): number | null {
  if (/\b(SAR|KWD|QAR|BHD|OMR|USD)\b/i.test(comment)) return null;
  const m = comment.match(/refund[^\d]{0,20}?(\d[\d,]*(?:\.\d+)?)|\((\d[\d,]*(?:\.\d+)?)\)|(\d[\d,]*(?:\.\d+)?)\s*AED/i);
  const v = m ? Number((m[1] ?? m[2] ?? m[3]).replace(/,/g, "")) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** A Zoho credit note on the order (zoho_creditnote_index). Valued = a
 *  refund / return; zero = an exchange (management_report_definitions). */
export type EvidenceCreditNote = { number: string; total: number; date: string; reference: string };
/** Money the gateway gave back: a payout refund line or a booked refund. */
export type EvidenceGatewayRefund = { amountAed: number; gateway: string; date: string | null };

export function suggestSheetAdjustments(input: {
  fromDay: string;
  toDay: string;
  orders: SheetAdjOrder[];
  sheet: SheetRow[];
  /** Posted adjustments by order uid: kind. */
  posted: Map<string, string>;
  /** By normalised order number. */
  creditNotes?: Map<string, EvidenceCreditNote[]>;
  gatewayRefunds?: Map<string, EvidenceGatewayRefund[]>;
}): SheetAdjustment[] {
  const sheetBy = new Map<string, SheetRow[]>();
  for (const s of input.sheet) {
    const k = norm(s.order);
    if (!k || k === "-") continue;
    sheetBy.set(k, [...(sheetBy.get(k) ?? []), s]);
  }

  const out: SheetAdjustment[] = [];
  for (const o of input.orders) {
    const day = dubaiDayKey(o.order_date);
    if (!day || day < input.fromDay || day > input.toDay) continue;
    if (!isCountedSale(o)) continue;
    // already marked cancelled / returned / refunded / exchanged → done. A
    // "received" close is not: money can come in and then go back out.
    const prior = input.posted.get(o.uid);
    if (prior && prior !== "received") continue;

    const key = norm(o.order_number);
    const rows = sheetBy.get(key) ?? [];
    // our own adjustment documents (ADJ/<order>/CN) are not outside evidence
    const cns = (input.creditNotes?.get(key) ?? []).filter((c) => !/^ADJ\//i.test(c.reference));
    const gw = input.gatewayRefunds?.get(key) ?? [];
    const gross = r2(Number(o.gross_aed) || 0);

    const cancel = rows.find((r) => r.kind === "cancelled");
    const full = rows.find((r) => r.kind === "refunded");
    const partial = rows.find((r) => r.kind === "partial_refund");
    const exchangeRow = rows.find((r) => r.kind === "exchange");
    const valuedCns = cns.filter((c) => c.total > 0.5);
    const zeroCns = cns.filter((c) => c.total <= 0.5);
    const gwAed = r2(gw.reduce((t, g) => t + g.amountAed, 0));
    const cnAed = r2(valuedCns.reduce((t, c) => t + c.total, 0));
    const sheetRow = full ?? partial;
    const sheetAed = sheetRow ? r2(sheetRow.cancelledRefundedAed || refundFromComment(sheetRow.comments) || (full ? gross : 0)) : 0;
    if (!cancel && !sheetRow && !exchangeRow && !gwAed && !cnAed && !zeroCns.length) continue;

    // Refund truth (founder, 2026-10-02): gateway cash first, then the Zoho
    // credit note, then the sheet.
    let kind: SuggestedKind;
    let refunded = 0;
    let source = "";
    if (cancel) { kind = "cancelled"; refunded = gross; source = "sheet"; }
    // an exchange re-invoiced in Zoho also leaves a valued credit note — with
    // the sheet saying Exchange and no gateway cash back, it stays an exchange
    else if (gwAed > 0 || sheetRow || (cnAed > 0 && !exchangeRow)) {
      kind = sheetRow && /return/i.test(sheetRow.comments) ? "returned" : "refunded";
      [refunded, source] = gwAed > 0 ? [gwAed, "gateway"] : cnAed > 0 ? [cnAed, "Zoho credit note"] : [sheetAed, "sheet"];
    } else kind = "exchanged";
    refunded = r2(Math.min(refunded, gross));
    const needsAmount = (kind === "returned" || kind === "refunded") && !(refunded > 0);

    // A full refund can leave a few dirhams (WA55598) — credit the whole order
    // then; otherwise keep back exactly what wasn't refunded.
    const deduct = kind === "cancelled" || kind === "exchanged" ? 0
      : refunded >= gross * 0.97 ? 0 : r2(Math.max(gross - refunded, 0));

    const evidence: string[] = [];
    const hit = cancel ?? sheetRow ?? exchangeRow;
    if (hit) evidence.push(`Sheet ${hit.tab === "Local" ? "Local" : "SMSA"} row ${hit.row}: ${[hit.saleType, hit.comments].filter(Boolean).join(" — ") || hit.kind}`);
    for (const c of valuedCns) evidence.push(`Zoho credit note ${c.number} · AED ${c.total.toLocaleString("en-US")} (${c.date})`);
    for (const c of zeroCns) evidence.push(`Zoho credit note ${c.number} · zero value (exchange)`);
    for (const g of gw) evidence.push(`${g.gateway || "Gateway"} refund · AED ${g.amountAed.toLocaleString("en-US")}${g.date ? ` (${g.date})` : ""}`);

    out.push({
      uid: o.uid, orderNumber: o.order_number, store: o.store_id, orderDay: day, customer: o.customer_name || hit?.party || "",
      gateway: o.gateway, grossAed: gross, kind, refundedAed: kind === "exchanged" ? 0 : refunded, deductAed: deduct,
      sheetRef: hit ? `${hit.source} · ${hit.tab === "Local" ? "Local orders" : "SMSA Orders"} row ${hit.row}` : "Not in the dispatch sheet",
      sheetComment: evidence.join(" · "),
      evidence, amountSource: source,
      eventDate: gw.find((g) => g.date)?.date ?? valuedCns.find((c) => c.date)?.date ?? zeroCns.find((c) => c.date)?.date ?? hit?.day ?? null,
      wasReceived: prior === "received",
      blockedBy: null,
      needsAmount,
    });
  }
  return out.sort((a, b) => a.orderDay.localeCompare(b.orderDay) || a.orderNumber.localeCompare(b.orderNumber));
}
