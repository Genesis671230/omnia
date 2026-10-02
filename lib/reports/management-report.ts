// Management sales report for one month — the numbers to put in front of
// management, every one traceable to an order and its evidence. Pure.
//
// Definitions (founder, 2026-10-02 — memory management_report_definitions):
//   - Refunds reduce the ORDER's month (cohort net sales); a second view
//     shows refunds by the month the money went out.
//   - The official refund is GATEWAY CASH (payout refund line / refund the app
//     booked against a payout). No gateway evidence → the Zoho credit note,
//     flagged; only in the sheet → the sheet, flagged. Mismatches are listed.
//   - Exchanges are never a sale: count, value of the orders involved, and only
//     extra money collected (exchange-row amounts in the dispatch sheet).
//   - Pending COD is a sale, shown as receivable "with the courier".
//   - Cancelled = store cancelled/voided, or the sheet says cancelled before
//     dispatch (store not updated → flagged).
//
// Waterfall:  placed → − failed/unpaid → − cancelled = gross sales
//             − refunds = net sales  → received in bank + receivable

import { isCountedSale, type SaleRuleOrder } from "@/lib/orders/sale-rule";
import { dubaiDayKey } from "@/lib/dubai-day";
import type { SheetRow } from "@/lib/integrations/dispatch-sheet-read";

export type MrStoreOrder = SaleRuleOrder & {
  order_number: string; order_date: string | null; customer_name?: string | null; country?: string | null; currency?: string | null;
};
/** The sales ledger's reconciliation of a counted order. */
export type MrLedger = { status: string; feeAed: number; receivedAed: number; payoutId: string | null; bankDate: string | null };
export type MrGatewayRefund = { order: string; amountAed: number; date: string | null; payoutId: string; gateway: string };
export type MrCreditNote = { number: string; date: string; total: number; reference: string };

export type ReceivableBucket = "cod_courier" | "no_payout_file" | "awaiting_payout" | "awaiting_bank" | "in_review";
export const BUCKET_LABEL: Record<ReceivableBucket, string> = {
  cod_courier: "COD — with the courier",
  no_payout_file: "Gateway owes — payout file not uploaded",
  awaiting_payout: "Gateway owes — not paid out yet",
  awaiting_bank: "Paid out — not in the bank yet",
  in_review: "In the bank — being matched",
};
const BUCKET_OF: Record<string, ReceivableBucket> = {
  cod: "cod_courier", no_payout_file: "no_payout_file", awaiting_payout: "awaiting_payout", awaiting_bank: "awaiting_bank", in_review: "in_review",
};

export type IssueKey =
  | "cancelled_in_sheet_only" | "refund_no_gateway" | "refund_sheet_only" | "store_refunded_no_amount" | "refund_over_order"
  | "zoho_ne_gateway" | "no_credit_note" | "sheet_ne_gateway" | "store_not_updated" | "exchange_reinvoiced";
export const ISSUE_LABEL: Record<IssueKey, string> = {
  cancelled_in_sheet_only: "Cancelled in the dispatch sheet, still a sale in the store",
  refund_no_gateway: "Refund in Zoho, no gateway refund found",
  refund_sheet_only: "Refund only in the dispatch sheet — no gateway refund or Zoho credit note",
  store_refunded_no_amount: "Store says refunded, no refund amount anywhere",
  refund_over_order: "Refund larger than the order",
  zoho_ne_gateway: "Zoho credit note ≠ gateway refund",
  no_credit_note: "Gateway refunded, no Zoho credit note",
  sheet_ne_gateway: "Sheet refund ≠ gateway refund",
  store_not_updated: "Refunded, but the store still shows it as paid / pending",
  exchange_reinvoiced: "Exchange invoiced again in Zoho — the sale is counted twice there",
};
export type Issue = { key: IssueKey; text: string };

export type MrOrderLine = {
  order: string; day: string; store: string; gateway: string; customer: string; country: string; currency: string;
  storeStatus: string;
  /** Counted by the dashboard's sale rule — to tie this report back to it. */
  dashboardSale: boolean;
  stage: "failed_unpaid" | "cancelled" | "sale";
  grossAed: number;
  cancelledBy: "store" | "sheet" | null;
  refund: {
    officialAed: number; source: "gateway" | "zoho" | "sheet" | null; paidMonth: string | null;
    gatewayAed: number; gatewayDates: string[]; zohoAed: number; zohoNotes: string[]; sheetAed: number; sheetNote: string;
  };
  exchange: { count: number; zohoNotes: string[]; sheetRows: number; extraAed: number };
  netSalesAed: number;
  feeAed: number;
  receivedAed: number;
  receivableAed: number;
  receivableBucket: ReceivableBucket | null;
  ageDays: number | null;
  issues: Issue[];
};

type Money = { orders: number; aed: number };
export type GatewayLine = {
  gateway: string; orders: number; grossAed: number; cancelled: Money; refunds: Money; exchanges: number; netSalesAed: number;
  receivedAed: number; receivableAed: number; feeAed: number; refundRatePct: number | null;
};
export type ManagementReport = {
  month: string; asOf: string;
  /** Dashboard sales → this report's gross sales, so the two never disagree silently. */
  fromDashboard: { dashboard: Money; sheetCancelled: Money; refundedInStore: Money; grossSales: Money };
  waterfall: {
    placed: Money; failedUnpaid: Money; cancelled: Money & { bySheetOnly: number }; grossSales: Money;
    refunds: Money; netSales: Money;
  };
  cash: {
    receivedAed: number; feeAed: number; receivableAed: number;
    /** Net sales = received + feesOnReceived + fxOther − refundsOnReceived + receivable (exact). */
    tie: { receivedAed: number; feesOnReceivedAed: number; fxOtherAed: number; refundsOnReceivedAed: number; receivableAed: number; netSalesAed: number; expectedFeesOnReceivableAed: number }; receivableByBucket: { bucket: ReceivableBucket; label: string; orders: number; aed: number; oldestDays: number }[]; receivableByAge: { band: string; orders: number; aed: number }[] };
  refundsByPaidMonth: { month: string; orders: number; aed: number }[];
  refundsPaidThisMonth: { orders: number; aed: number; ofEarlierMonths: number };
  exchanges: { orders: number; events: number; valueOfOrdersAed: number; extraCollectedAed: number; reinvoicedInZoho: number };
  byGateway: GatewayLine[];
  issues: { key: IssueKey; label: string; orders: string[] }[];
  lines: MrOrderLine[];
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const norm = (s: string) => s.trim().replace(/^#/, "").toUpperCase();
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.max(a, b) * 0.01);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function buildManagementReport(input: {
  month: string;                        // YYYY-MM
  today: string;                        // Dubai day the report is run
  orders: MrStoreOrder[];               // every store order (any status) dated in the month, at least
  ledger: Map<string, MrLedger>;        // order → reconciliation (counted orders)
  gatewayRefunds: MrGatewayRefund[];    // refund cash, any date, for these orders
  creditNotes: Map<string, MrCreditNote[]>;
  invoiceCounts: Map<string, number>;
  sheet: SheetRow[];                    // dispatch rows for these orders, any month
  refundsPaidInMonth: MrGatewayRefund[]; // all gateway refunds whose money went out this month (any order month)
  orderMonthOf: Map<string, string>;    // order → its month, for refundsPaidInMonth
}): ManagementReport {
  const sheetBy = new Map<string, SheetRow[]>();
  for (const s of input.sheet) sheetBy.set(norm(s.order), [...(sheetBy.get(norm(s.order)) ?? []), s]);
  const refundsBy = new Map<string, MrGatewayRefund[]>();
  for (const g of input.gatewayRefunds) refundsBy.set(norm(g.order), [...(refundsBy.get(norm(g.order)) ?? []), g]);

  const lines: MrOrderLine[] = [];
  for (const o of input.orders) {
    const day = dubaiDayKey(o.order_date);
    if (!day || !day.startsWith(input.month)) continue;
    const k = norm(o.order_number);
    const fs = (o.financial_status || "").toLowerCase();
    const gross = r2(Number(o.gross_aed) || 0);
    const rows = sheetBy.get(k) ?? [];
    const saleRows = rows.filter((r) => r.kind === "sale" || r.kind === "refunded" || r.kind === "partial_refund" || r.kind === "cancelled");
    const exchRows = rows.filter((r) => r.kind === "exchange" || r.kind === "repair");
    const cns = input.creditNotes.get(k) ?? [];
    const issues: Issue[] = [];
    const flag = (key: IssueKey, text = ISSUE_LABEL[key]) => issues.push({ key, text });

    // stage
    let stage: MrOrderLine["stage"];
    let cancelledBy: MrOrderLine["cancelledBy"] = null;
    if (fs === "cancelled" || fs === "voided") { stage = "cancelled"; cancelledBy = "store"; }
    else if (!isCountedSale(o)) stage = fs === "refunded" ? "sale" : "failed_unpaid";
    else if (saleRows.some((r) => r.kind === "cancelled")) { stage = "cancelled"; cancelledBy = "sheet"; flag("cancelled_in_sheet_only"); }
    else stage = "sale";
    // A fully refunded store order is a sale that was refunded, not a failed one.
    if (fs === "refunded" && stage !== "cancelled") stage = "sale";

    // refunds (only for sales — a cancellation already removes the order)
    const gw = refundsBy.get(k) ?? [];
    const gatewayAed = r2(gw.reduce((s, g) => s + Math.abs(g.amountAed), 0));
    const valuedCn = cns.filter((c) => c.total > 0.005);
    const zohoAed = r2(valuedCn.reduce((s, c) => s + c.total, 0));
    const sheetRefundRow = saleRows.find((r) => r.kind === "refunded" || r.kind === "partial_refund");
    const sheetAed = r2(saleRows.reduce((s, r) => s + (r.kind === "refunded" || r.kind === "partial_refund" ? r.cancelledRefundedAed ?? 0 : 0), 0));
    let official = 0;
    let source: MrOrderLine["refund"]["source"] = null;
    let paidMonth: string | null = null;
    if (stage === "sale") {
      if (gatewayAed > 0) { official = gatewayAed; source = "gateway"; paidMonth = gw.map((g) => g.date).filter(Boolean).sort()[0]?.slice(0, 7) ?? null; }
      else if (zohoAed > 0) { official = zohoAed; source = "zoho"; paidMonth = valuedCn.map((c) => c.date).sort()[0]?.slice(0, 7) ?? null; flag("refund_no_gateway"); }
      else if (sheetAed > 0) { official = sheetAed; source = "sheet"; flag("refund_sheet_only"); }
      else if (fs === "refunded" || fs === "partially_refunded") flag("store_refunded_no_amount", `Store says ${fs}, no refund amount anywhere`);
      if (official > gross + 0.5) { flag("refund_over_order", `Refund ${official} is more than the order ${gross}`); official = gross; }
      if (source === "gateway") {
        if (zohoAed > 0 && !near(zohoAed, gatewayAed)) flag("zoho_ne_gateway", `Zoho credit note ${zohoAed} ≠ gateway refund ${gatewayAed}`);
        if (zohoAed === 0) flag("no_credit_note");
        if (sheetAed > 0 && !near(sheetAed, gatewayAed)) flag("sheet_ne_gateway", `Sheet refund ${sheetAed} ≠ gateway refund ${gatewayAed}`);
      }
      if (official > 0 && (fs === "paid" || fs === "pending")) flag("store_not_updated", `Refunded, but the store still says ${fs}`);
    }

    // exchanges
    const zeroCn = cns.filter((c) => c.total <= 0.005);
    const exchCount = Math.max(zeroCn.length, exchRows.length);
    const extraAed = r2(exchRows.reduce((s, r) => s + (r.amountAed ?? 0), 0));
    if (exchCount && (input.invoiceCounts.get(k) ?? 0) > 1) flag("exchange_reinvoiced");

    const isSale = stage === "sale";
    const net = isSale ? r2(gross - official) : 0;
    const l = input.ledger.get(k);
    const received = isSale && l?.status === "received" ? r2(l.receivedAed) : 0;
    const fee = isSale && l ? r2(l.feeAed) : 0;
    const bucket = isSale && l && l.status !== "received" ? BUCKET_OF[l.status] ?? null : null;
    const receivable = bucket ? net : 0;

    lines.push({
      order: o.order_number, day, store: o.store_id, gateway: o.gateway || "Unknown", customer: o.customer_name ?? "", country: (o.country ?? "").toUpperCase(),
      currency: (o.currency ?? "AED").toUpperCase(), storeStatus: fs, dashboardSale: isCountedSale(o), stage, grossAed: gross, cancelledBy,
      refund: { officialAed: r2(official), source, paidMonth, gatewayAed, gatewayDates: gw.map((g) => g.date ?? "").filter(Boolean), zohoAed, zohoNotes: valuedCn.map((c) => c.number), sheetAed, sheetNote: sheetRefundRow?.comments ?? "" },
      exchange: { count: exchCount, zohoNotes: zeroCn.map((c) => c.number), sheetRows: exchRows.length, extraAed },
      netSalesAed: net, feeAed: fee, receivedAed: received, receivableAed: r2(receivable), receivableBucket: bucket,
      ageDays: bucket ? daysBetween(day, input.today) : null, issues,
    });
  }

  // totals
  const sum = (f: (l: MrOrderLine) => number, p: (l: MrOrderLine) => boolean = () => true) => r2(lines.filter(p).reduce((s, l) => s + f(l), 0));
  const cnt = (p: (l: MrOrderLine) => boolean) => lines.filter(p).length;
  const sale = (l: MrOrderLine) => l.stage === "sale";
  const refunded = (l: MrOrderLine) => l.refund.officialAed > 0;

  const buckets = new Map<ReceivableBucket, { orders: number; aed: number; oldest: number }>();
  const ages = [["0–7 days", 0, 7], ["8–15 days", 8, 15], ["16–30 days", 16, 30], ["31–60 days", 31, 60], ["Over 60 days", 61, 99999]] as const;
  const ageTotals = ages.map(([band]) => ({ band, orders: 0, aed: 0 }));
  for (const l of lines) {
    if (!l.receivableBucket) continue;
    const b = buckets.get(l.receivableBucket) ?? { orders: 0, aed: 0, oldest: 0 };
    b.orders += 1; b.aed += l.receivableAed; b.oldest = Math.max(b.oldest, l.ageDays ?? 0);
    buckets.set(l.receivableBucket, b);
    const i = ages.findIndex(([, lo, hi]) => (l.ageDays ?? 0) >= lo && (l.ageDays ?? 0) <= hi);
    ageTotals[i].orders += 1; ageTotals[i].aed += l.receivableAed;
  }

  const gwMap = new Map<string, GatewayLine>();
  for (const l of lines) {
    const g = gwMap.get(l.gateway) ?? { gateway: l.gateway, orders: 0, grossAed: 0, cancelled: { orders: 0, aed: 0 }, refunds: { orders: 0, aed: 0 }, exchanges: 0, netSalesAed: 0, receivedAed: 0, receivableAed: 0, feeAed: 0, refundRatePct: null };
    if (l.stage === "cancelled") { g.cancelled.orders += 1; g.cancelled.aed += l.grossAed; }
    if (sale(l)) {
      g.orders += 1; g.grossAed += l.grossAed; g.netSalesAed += l.netSalesAed; g.receivedAed += l.receivedAed; g.receivableAed += l.receivableAed; g.feeAed += l.feeAed;
      if (refunded(l)) { g.refunds.orders += 1; g.refunds.aed += l.refund.officialAed; }
    }
    if (l.exchange.count) g.exchanges += l.exchange.count;
    gwMap.set(l.gateway, g);
  }
  const byGateway = [...gwMap.values()].map((g) => ({
    ...g, grossAed: r2(g.grossAed), netSalesAed: r2(g.netSalesAed), receivedAed: r2(g.receivedAed), receivableAed: r2(g.receivableAed), feeAed: r2(g.feeAed),
    cancelled: { orders: g.cancelled.orders, aed: r2(g.cancelled.aed) }, refunds: { orders: g.refunds.orders, aed: r2(g.refunds.aed) },
    refundRatePct: g.grossAed ? r2((g.refunds.aed / g.grossAed) * 100) : null,
  })).sort((a, b) => b.grossAed - a.grossAed);

  // refunds by the month the money went out (cohort orders) + paid this month (any order month)
  const paid = new Map<string, { orders: number; aed: number }>();
  for (const l of lines.filter(refunded)) {
    const m = l.refund.paidMonth ?? "unknown";
    const p = paid.get(m) ?? { orders: 0, aed: 0 };
    p.orders += 1; p.aed += l.refund.officialAed;
    paid.set(m, p);
  }
  const paidThis = input.refundsPaidInMonth;
  const paidOrders = new Set(paidThis.map((r) => norm(r.order)));

  // issues, grouped by type
  const issueMap = new Map<IssueKey, string[]>();
  for (const l of lines) for (const i of l.issues) issueMap.set(i.key, [...(issueMap.get(i.key) ?? []), l.order]);
  const issues = [...issueMap].map(([key, orders]) => ({ key, label: ISSUE_LABEL[key], orders })).sort((a, b) => b.orders.length - a.orders.length);

  const m = (p: (l: MrOrderLine) => boolean): Money => ({ orders: cnt(p), aed: sum((l) => l.grossAed, p) });
  return {
    month: input.month, asOf: input.today,
    fromDashboard: {
      dashboard: m((l) => l.dashboardSale),
      sheetCancelled: m((l) => l.dashboardSale && l.cancelledBy === "sheet"),
      refundedInStore: m((l) => !l.dashboardSale && l.stage === "sale"),
      grossSales: m(sale),
    },
    waterfall: {
      placed: { orders: lines.length, aed: sum((l) => l.grossAed) },
      failedUnpaid: { orders: cnt((l) => l.stage === "failed_unpaid"), aed: sum((l) => l.grossAed, (l) => l.stage === "failed_unpaid") },
      cancelled: { orders: cnt((l) => l.stage === "cancelled"), aed: sum((l) => l.grossAed, (l) => l.stage === "cancelled"), bySheetOnly: cnt((l) => l.cancelledBy === "sheet") },
      grossSales: { orders: cnt(sale), aed: sum((l) => l.grossAed, sale) },
      refunds: { orders: cnt((l) => sale(l) && refunded(l)), aed: sum((l) => l.refund.officialAed, sale) },
      netSales: { orders: cnt(sale), aed: sum((l) => l.netSalesAed, sale) },
    },
    cash: {
      receivedAed: sum((l) => l.receivedAed), feeAed: sum((l) => l.feeAed, (l) => sale(l) && !l.receivableBucket), receivableAed: sum((l) => l.receivableAed),
      tie: (() => {
        const got = (l: MrOrderLine) => sale(l) && !l.receivableBucket;
        const received = sum((l) => l.receivedAed, got);
        const fees = sum((l) => l.feeAed, got);
        const refundsOnReceived = sum((l) => l.refund.officialAed, got);
        const receivable = sum((l) => l.receivableAed);
        const net = sum((l) => l.netSalesAed, sale);
        return {
          receivedAed: received, feesOnReceivedAed: fees, refundsOnReceivedAed: refundsOnReceived, receivableAed: receivable, netSalesAed: net,
          fxOtherAed: r2(net - received - fees + refundsOnReceived - receivable),
          expectedFeesOnReceivableAed: sum((l) => l.feeAed, (l) => Boolean(l.receivableBucket)),
        };
      })(),
      receivableByBucket: [...buckets].map(([bucket, v]) => ({ bucket, label: BUCKET_LABEL[bucket], orders: v.orders, aed: r2(v.aed), oldestDays: v.oldest })).sort((a, b) => b.aed - a.aed),
      receivableByAge: ageTotals.map((a) => ({ ...a, aed: r2(a.aed) })),
    },
    refundsByPaidMonth: [...paid].map(([month, v]) => ({ month, orders: v.orders, aed: r2(v.aed) })).sort((a, b) => a.month.localeCompare(b.month)),
    refundsPaidThisMonth: {
      orders: paidOrders.size,
      aed: r2(paidThis.reduce((s, r) => s + Math.abs(r.amountAed), 0)),
      ofEarlierMonths: [...paidOrders].filter((o) => (input.orderMonthOf.get(o) ?? input.month) < input.month).length,
    },
    exchanges: {
      orders: cnt((l) => l.exchange.count > 0), events: lines.reduce((s, l) => s + l.exchange.count, 0),
      valueOfOrdersAed: sum((l) => l.grossAed, (l) => l.exchange.count > 0), extraCollectedAed: sum((l) => l.exchange.extraAed),
      reinvoicedInZoho: cnt((l) => l.issues.some((i) => i.key === "exchange_reinvoiced")),
    },
    byGateway,
    issues,
    lines: lines.sort((a, b) => a.day.localeCompare(b.day) || a.order.localeCompare(b.order)),
  };
}
