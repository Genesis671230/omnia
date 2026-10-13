// Admin money view — one calculation behind the daily table, the day drawer,
// the gateway table, their charts and the Excel export, so a figure read in
// one place is the same figure everywhere (Shopify Payments' deduction % on
// 5 Oct is identical in the day drawer, the gateway table and the chart).
//
// Pure: fed by the sales ledger (lib/orders/sales-ledger.ts). Per order:
//
//   Sale = Deductions (fee + VAT) + Refunds + FX + Net received + Awaiting
//   Net payout = Sale − Deductions − Refunds          (what the gateway pays out)
//   Net received = Net payout − FX                    (what reached the bank)
//   Awaiting = Net payout still on its way            (not received yet)
//
// Fees are never estimated here. An order with no payout file yet has no
// deduction — its whole sale is pending until the file states the fee. A
// received order whose file stated no fee (Telr's xls) takes what reached the
// bank as the truth: deductions = sale − net received.
//
// Day, gateway and range rows are plain sums of order rows — never computed
// separately — which is what makes the cross-checks hold.

import type { LedgerOrder, LedgerStatus } from "@/lib/orders/sales-ledger";
import { dubaiDayKey } from "@/lib/dubai-day";

export type MoneyStatus = "received" | "awaiting" | "overdue" | "refunded";

export type OrderMoney = {
  uid: string;
  day: string;
  orderNumber: string;
  store: string;
  customer: string;
  gateway: string;
  sale: number;
  fee: number;
  vat: number;
  deductions: number;
  refunds: number;
  netPayout: number;
  fx: number;
  netReceived: number;
  awaiting: number;
  status: MoneyStatus;
  /** The ledger's finer status (no payout file, awaiting bank, COD…). */
  stage: LedgerStatus;
  /** Part of `awaiting` already paid out by the gateway (payout file in), not yet seen in the bank. */
  inPayout: number;
  receivedOn: string | null;
  /** Days from the order to the bank credit (received) or to today (awaiting). */
  ageDays: number;
  /** Days past the gateway's usual payout time; 0 when not late. */
  overdueDays: number;
  reason: string;
};

export type MoneyTotals = {
  orders: number;
  sale: number;
  fee: number;
  vat: number;
  deductions: number;
  refunds: number;
  netPayout: number;
  fx: number;
  netReceived: number;
  awaiting: number;
  /** Of awaiting: payout issued (file in), not in the bank yet. */
  inPayout: number;
  overdue: number;
  overdueOrders: number;
  /** Deductions as a share of sales (0–1). */
  deductionRate: number;
  /** Average days order → bank over received orders; null when none received. */
  avgDaysToBank: number | null;
};

export type DayRow = MoneyTotals & { day: string };
export type GatewayRow = MoneyTotals & {
  gateway: string;
  /** The gateway's usual order → bank time used to flag overdue money. */
  expectedDays: number;
  oldestAwaitingDays: number;
};

/** Usual order → bank days per gateway; anything older (+ grace) is overdue. */
export const DEFAULT_EXPECTED_DAYS: Record<string, number> = {
  Stripe: 7,
  "Shopify Payments": 5,
  SHOPIFY: 5,
  Tabby: 7,
  Tamara: 10,
  Telr: 7,
  Checkout: 7,
  COD: 10,
};
export const DEFAULT_EXPECTED = 7;
export const DEFAULT_GRACE_DAYS = 2;

export type Terms = { expectedDays: Record<string, number>; graceDays: number };
export const DEFAULT_TERMS: Terms = { expectedDays: DEFAULT_EXPECTED_DAYS, graceDays: DEFAULT_GRACE_DAYS };

const r2 = (n: number) => Math.round(n * 100) / 100;
const dayMs = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs));

export function expectedDaysFor(gateway: string, terms: Terms = DEFAULT_TERMS): number {
  const hit = Object.entries(terms.expectedDays).find(([k]) => k.toLowerCase() === (gateway || "").trim().toLowerCase());
  return hit ? hit[1] : DEFAULT_EXPECTED;
}

/** One ledger order → its money row. `today` is a Dubai YYYY-MM-DD. */
export function orderMoney(o: LedgerOrder, today: string, terms: Terms = DEFAULT_TERMS): OrderMoney {
  const day = dubaiDayKey(o.orderDate) ?? today;
  const sale = r2(o.grossAed);
  const base = {
    uid: o.uid, day, orderNumber: o.orderNumber, store: o.store, customer: o.customerName,
    gateway: o.gateway || "Unclassified", sale, stage: o.status, reason: o.reason,
  };
  const estimated = o.feeBasis === "estimated";

  if (o.status === "adjusted") {
    return { ...base, fee: 0, vat: 0, deductions: 0, refunds: sale, netPayout: 0, fx: 0, netReceived: 0, awaiting: 0, inPayout: 0,
      status: "refunded", receivedOn: null, ageDays: 0, overdueDays: 0 };
  }

  if (o.status === "received" && estimated) {
    // No fee in the file: the bank credit is the fact, the gap is the deduction.
    const netReceived = r2(Math.min(o.receivedAed - (o.fxAed || 0), sale));
    const receivedOn = o.bank?.date ?? null;
    return { ...base, fee: r2(sale - netReceived), vat: 0, deductions: r2(sale - netReceived), refunds: 0, netPayout: netReceived, fx: 0,
      netReceived, awaiting: 0, inPayout: 0, status: "received", receivedOn, ageDays: receivedOn ? daysBetween(day, receivedOn) : 0, overdueDays: 0 };
  }

  // COD with no courier voucher yet, or no payout file yet: the whole sale is
  // still to come — the charge isn't known, so nothing is deducted until it is.
  const netPayout = r2(o.status === "cod" || estimated ? sale : Math.min(o.status === "received" ? o.receivedAed : o.payoutNetAed, sale));
  const deductions = r2(Math.max(sale - netPayout, 0));
  const vat = r2(Math.min(Math.max(o.vatAed ?? 0, 0), deductions));
  const fee = r2(deductions - vat);

  if (o.status === "received") {
    const fx = r2(o.fxAed || 0);
    const receivedOn = o.bank?.date ?? null;
    return { ...base, fee, vat, deductions, refunds: 0, netPayout, fx, netReceived: r2(netPayout - fx), awaiting: 0, inPayout: 0,
      status: "received", receivedOn, ageDays: receivedOn ? daysBetween(day, receivedOn) : 0, overdueDays: 0 };
  }

  const ageDays = daysBetween(day, today);
  const late = ageDays - expectedDaysFor(base.gateway, terms) - terms.graceDays;
  const inPayout = o.status === "awaiting_bank" || o.status === "in_review" ? netPayout : 0;
  return { ...base, fee, vat, deductions, refunds: 0, netPayout, fx: 0, netReceived: 0, awaiting: netPayout, inPayout,
    status: late > 0 ? "overdue" : "awaiting", receivedOn: null, ageDays, overdueDays: Math.max(late, 0) };
}

export function sumMoney(rows: OrderMoney[]): MoneyTotals {
  const t = { orders: 0, sale: 0, fee: 0, vat: 0, deductions: 0, refunds: 0, netPayout: 0, fx: 0, netReceived: 0, awaiting: 0, inPayout: 0, overdue: 0, overdueOrders: 0 };
  let bankDays = 0, bankOrders = 0;
  for (const r of rows) {
    t.orders += 1;
    t.sale += r.sale; t.fee += r.fee; t.vat += r.vat; t.deductions += r.deductions; t.refunds += r.refunds;
    t.netPayout += r.netPayout; t.fx += r.fx; t.netReceived += r.netReceived; t.awaiting += r.awaiting; t.inPayout += r.inPayout;
    if (r.status === "overdue") { t.overdue += r.awaiting; t.overdueOrders += 1; }
    if (r.status === "received" && r.receivedOn) { bankDays += r.ageDays; bankOrders += 1; }
  }
  return {
    orders: t.orders,
    sale: r2(t.sale), fee: r2(t.fee), vat: r2(t.vat), deductions: r2(t.deductions), refunds: r2(t.refunds),
    netPayout: r2(t.netPayout), fx: r2(t.fx), netReceived: r2(t.netReceived), awaiting: r2(t.awaiting), inPayout: r2(t.inPayout),
    overdue: r2(t.overdue), overdueOrders: t.overdueOrders,
    deductionRate: t.sale > 0 ? t.deductions / t.sale : 0,
    avgDaysToBank: bankOrders ? Math.round((bankDays / bankOrders) * 10) / 10 : null,
  };
}

export function byDay(rows: OrderMoney[], days: string[]): DayRow[] {
  const m = new Map<string, OrderMoney[]>(days.map((d) => [d, []]));
  for (const r of rows) m.get(r.day)?.push(r);
  return days.map((d) => ({ day: d, ...sumMoney(m.get(d) ?? []) }));
}

export function byGateway(rows: OrderMoney[], terms: Terms = DEFAULT_TERMS): GatewayRow[] {
  const m = new Map<string, OrderMoney[]>();
  for (const r of rows) m.set(r.gateway, [...(m.get(r.gateway) ?? []), r]);
  return [...m.entries()]
    .map(([gateway, list]) => ({
      gateway,
      ...sumMoney(list),
      expectedDays: expectedDaysFor(gateway, terms),
      oldestAwaitingDays: list.reduce((a, r) => (r.awaiting > 0 ? Math.max(a, r.ageDays) : a), 0),
    }))
    .sort((a, b) => b.sale - a.sale);
}

/** Overdue money grouped by gateway, worst first — the Telegram follow-up list. */
export type OverdueGroup = { gateway: string; amount: number; orders: number; oldestDays: number; oldestOrder: string; oldestDay: string; expectedDays: number };
export function overdueByGateway(rows: OrderMoney[], terms: Terms = DEFAULT_TERMS): OverdueGroup[] {
  const m = new Map<string, OverdueGroup>();
  for (const r of rows) {
    if (r.status !== "overdue") continue;
    const g = m.get(r.gateway) ?? { gateway: r.gateway, amount: 0, orders: 0, oldestDays: 0, oldestOrder: "", oldestDay: "", expectedDays: expectedDaysFor(r.gateway, terms) };
    g.amount += r.awaiting;
    g.orders += 1;
    if (r.ageDays > g.oldestDays) { g.oldestDays = r.ageDays; g.oldestOrder = r.orderNumber; g.oldestDay = r.day; }
    m.set(r.gateway, g);
  }
  return [...m.values()].map((g) => ({ ...g, amount: r2(g.amount) })).sort((a, b) => b.amount - a.amount);
}
