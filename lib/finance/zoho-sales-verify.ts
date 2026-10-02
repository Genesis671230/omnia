// Does Zoho agree with the stores about a month's sales? Pure.
//
// How the team books (read off live Zoho, Sep 2026):
//   - a sales order numbered with the order number (OS3977, WA55936), then an
//     invoice whose reference is the order number; the customer name starts
//     with it too ("OS3992 نجلاء الحويطي") — House of Omnia's invoices carry it
//     only there.
//   - a REFUND is a credit note with a value, usually referenced
//     "<bank ref>/<order>/RFN".
//   - an EXCHANGE is a zero-value credit note: the items come back at rate 0
//     and a replacement goes out.
//
// Our side: counted sales follow lib/orders/sale-rule.ts; cancellations are
// orders cancelled / voided in the store.

import { isCountedSale, type SaleRuleOrder } from "@/lib/orders/sale-rule";
import { dubaiDayKey } from "@/lib/dubai-day";

export type ZohoDoc = {
  kind: "salesorder" | "invoice" | "creditnote";
  org: string;
  id: string;
  number: string;
  reference: string;
  customer: string;
  date: string;
  status: string;
  total: number;
  balance: number;
};

export type VerifyOrder = SaleRuleOrder & {
  order_number: string; order_date: string | null; customer_name?: string | null; refunded_amount?: number | null;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const norm = (s: string) => s.trim().replace(/^#/, "").toUpperCase();
const ORDER_TOKEN = /^(?:OS|WA|SA|UAE|KSA)?\d{3,}$/i;

/** The order number a Zoho document is for: reference / SO number first,
 *  else the token before the customer's name. "" when it names none. */
export function orderNumberOf(d: Pick<ZohoDoc, "kind" | "number" | "reference" | "customer">): string {
  if (d.kind === "salesorder" && ORDER_TOKEN.test(d.number.trim())) return norm(d.number);
  for (const part of d.reference.split(/[/\s|,]+/)) if (ORDER_TOKEN.test(part.trim())) return norm(part);
  const first = d.customer.trim().split(/\s+/)[0] ?? "";
  return ORDER_TOKEN.test(first) ? norm(first) : "";
}

/** An order is found under its own number, or — for a prefixed order — the
 *  bare number staff sometimes type in Zoho (SA3905 → 3905). Never the other
 *  way: a bare order number is its own order, not OS/WA/SA anything. */
const keysFor = (n: string) => [...new Set([norm(n), norm(n).replace(/^(OS|WA|SA|UAE|KSA)/, "")])];

export type Flag =
  | { type: "not_in_zoho"; order: string; day: string; amountAed: number; store: string }
  | { type: "zoho_without_order"; order: string; invoice: string; org: string; date: string; amountAed: number }
  | {
      type: "amount_mismatch"; order: string; invoice: string; orderAed: number; zohoAed: number;
      /** exchange_reinvoiced: a zero-value credit note took the item back and the
       *  replacement was invoiced again — Zoho counts the sale twice.
       *  duplicate_invoice: two invoices, no exchange. amount_differs: one invoice. */
      reason: "exchange_reinvoiced" | "duplicate_invoice" | "amount_differs";
    }
  | { type: "cancelled_but_invoiced"; order: string; invoice: string; zohoAed: number; status: string }
  | { type: "draft_invoice"; order: string; invoice: string; zohoAed: number };

export type DocLine = { order: string; number: string; org: string; date: string; amountAed: number; status: string; customer: string };

export type SalesVerification = {
  month: { fromDay: string; toDay: string };
  ours: { orders: number; salesAed: number };
  zoho: {
    invoices: number; invoicedAed: number; salesOrders: number;
    refundsAed: number; netAed: number; byOrg: { org: string; invoices: number; invoicedAed: number }[];
  };
  matched: number;
  differenceAed: number;
  refunds: { count: number; totalAed: number; list: DocLine[] };
  exchanges: { count: number; list: DocLine[] };
  cancellations: { count: number; totalAed: number; list: { order: string; day: string; amountAed: number; status: string; store: string }[] };
  flags: Flag[];
};

export function verifyMonthSales(input: {
  fromDay: string;
  toDay: string;
  orders: VerifyOrder[];
  docs: ZohoDoc[];
}): SalesVerification {
  const inMonth = (day: string | null) => Boolean(day && day >= input.fromDay && day <= input.toDay);

  // Our month: counted sales + cancellations, by order number.
  const ours = new Map<string, { o: VerifyOrder; day: string }>();
  const cancelled: SalesVerification["cancellations"]["list"] = [];
  const allOrders = new Map<string, VerifyOrder>();
  for (const o of input.orders) {
    for (const k of keysFor(o.order_number)) if (!allOrders.has(k) || k === norm(o.order_number)) allOrders.set(k, o);
    const day = dubaiDayKey(o.order_date);
    if (!inMonth(day)) continue;
    const s = (o.financial_status || "").toLowerCase();
    if (s === "cancelled" || s === "voided") {
      cancelled.push({ order: o.order_number, day: day!, amountAed: r2(Number(o.gross_aed) || 0), status: s, store: o.store_id });
    } else if (isCountedSale(o)) ours.set(norm(o.order_number), { o, day: day! });
  }

  // Zoho: invoices per order (non-void), plus everything else by kind.
  const invByOrder = new Map<string, ZohoDoc[]>();
  const soOrders = new Set<string>();
  const refunds: DocLine[] = [];
  const exchanges: DocLine[] = [];
  const flags: Flag[] = [];
  const byOrg = new Map<string, { invoices: number; invoicedAed: number }>();
  let invoices = 0, invoicedAed = 0, salesOrders = 0;

  for (const d of input.docs) {
    const order = orderNumberOf(d);
    const line: DocLine = { order, number: d.number, org: d.org, date: d.date, amountAed: r2(d.total), status: d.status, customer: d.customer };
    if (d.kind === "salesorder") {
      if (d.status === "void") continue;
      if (order) soOrders.add(order);
      if (inMonth(d.date)) salesOrders += 1;
      continue;
    }
    if (d.kind === "creditnote") {
      if (d.status === "void" || !inMonth(d.date)) continue;
      if (d.total > 0.005) refunds.push(line);
      else exchanges.push(line);
      continue;
    }
    if (d.status === "void") continue;
    if (order) invByOrder.set(order, [...(invByOrder.get(order) ?? []), d]);
    if (!inMonth(d.date)) continue;
    if (d.status === "draft") { flags.push({ type: "draft_invoice", order, invoice: d.number, zohoAed: r2(d.total) }); continue; }
    invoices += 1;
    invoicedAed += d.total;
    const o = byOrg.get(d.org) ?? { invoices: 0, invoicedAed: 0 };
    o.invoices += 1; o.invoicedAed += d.total;
    byOrg.set(d.org, o);
  }

  const exchangedOrders = new Set(exchanges.map((x) => x.order).filter(Boolean));
  const invFor = (n: string) => {
    const seen = new Set<string>();
    return keysFor(n).flatMap((k) => invByOrder.get(k) ?? []).filter((d) => d.status !== "draft" && !seen.has(d.id) && seen.add(d.id));
  };

  // Our sales → Zoho.
  let matched = 0;
  for (const [n, { o, day }] of ours) {
    const inv = invFor(n);
    const gross = r2(Number(o.gross_aed) || 0);
    if (!inv.length) {
      if (!keysFor(n).some((k) => soOrders.has(k))) flags.push({ type: "not_in_zoho", order: o.order_number, day, amountAed: gross, store: o.store_id });
      else matched += 1; // sales order exists, invoice still to raise — not a missing sale
      continue;
    }
    matched += 1;
    const zohoAed = r2(inv.reduce((s, d) => s + d.total, 0));
    // KSA orders are invoiced in AED at the day's rate — allow 1.5% for FX.
    if (Math.abs(zohoAed - gross) > Math.max(1, gross * 0.015)) {
      const reason = inv.length < 2 ? "amount_differs" : keysFor(n).some((k) => exchangedOrders.has(k)) ? "exchange_reinvoiced" : "duplicate_invoice";
      flags.push({ type: "amount_mismatch", order: o.order_number, invoice: inv.map((d) => d.number).join(", "), orderAed: gross, zohoAed, reason });
    }
  }

  // Zoho invoices in the month with no counted sale behind them.
  for (const [order, docs] of invByOrder) {
    const monthDocs = docs.filter((d) => inMonth(d.date) && d.status !== "draft");
    if (!monthDocs.length) continue;
    const o = keysFor(order).map((k) => allOrders.get(k)).find(Boolean);
    const s = (o?.financial_status || "").toLowerCase();
    for (const d of monthDocs) {
      if (o && (s === "cancelled" || s === "voided")) {
        flags.push({ type: "cancelled_but_invoiced", order: o.order_number, invoice: d.number, zohoAed: r2(d.total), status: s });
      } else if (!o) {
        flags.push({ type: "zoho_without_order", order, invoice: d.number, org: d.org, date: d.date, amountAed: r2(d.total) });
      }
    }
  }
  // Invoices that name no order at all.
  for (const d of input.docs) {
    if (d.kind === "invoice" && d.status !== "void" && d.status !== "draft" && inMonth(d.date) && !orderNumberOf(d)) {
      flags.push({ type: "zoho_without_order", order: "", invoice: d.number, org: d.org, date: d.date, amountAed: r2(d.total) });
    }
  }

  const salesAed = r2([...ours.values()].reduce((s, x) => s + (Number(x.o.gross_aed) || 0), 0));
  const refundsAed = r2(refunds.reduce((s, x) => s + x.amountAed, 0));
  return {
    month: { fromDay: input.fromDay, toDay: input.toDay },
    ours: { orders: ours.size, salesAed },
    zoho: {
      invoices, invoicedAed: r2(invoicedAed), salesOrders, refundsAed, netAed: r2(invoicedAed - refundsAed),
      byOrg: [...byOrg].map(([org, v]) => ({ org, invoices: v.invoices, invoicedAed: r2(v.invoicedAed) })),
    },
    matched,
    differenceAed: r2(invoicedAed - salesAed),
    refunds: { count: refunds.length, totalAed: refundsAed, list: refunds.sort((a, b) => b.date.localeCompare(a.date)) },
    exchanges: { count: exchanges.length, list: exchanges.sort((a, b) => b.date.localeCompare(a.date)) },
    cancellations: {
      count: cancelled.length,
      totalAed: r2(cancelled.reduce((s, c) => s + c.amountAed, 0)),
      list: cancelled.sort((a, b) => b.day.localeCompare(a.day)),
    },
    flags,
  };
}
