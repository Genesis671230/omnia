// Fetch side of the Admin money view: reads the sales ledger for every month
// the range touches and turns its orders into money rows (lib/dashboard/admin-money).
// Read-only.

import { buildSalesLedger, type SalesLedgerResponse } from "@/lib/orders/sales-ledger.service";
import { dubaiDayRange, dubaiToday } from "@/lib/dubai-day";
import { getSetting } from "@/lib/settings";
import {
  byDay, byGateway, orderMoney, overdueByGateway, sumMoney,
  DEFAULT_TERMS, type DayRow, type GatewayRow, type MoneyTotals, type OrderMoney, type OverdueGroup, type Terms,
} from "./admin-money";

/** Cancelled from the app — never a sale, listed so every view and export accounts for it. */
export type CancelledRow = { day: string; orderNumber: string; store: string; customer: string; gateway: string; amount: number; creditNote: string; cancelledOn: string };
export type CancelledSum = { orders: number; amount: number };

export type AdminMoney = {
  from: string;
  to: string;
  today: string;
  terms: Terms;
  totals: MoneyTotals & { cancelled: CancelledSum };
  days: (DayRow & { cancelled: CancelledSum })[];
  gateways: (GatewayRow & { cancelled: CancelledSum })[];
  cancelled: CancelledRow[];
  overdue: OverdueGroup[];
  orders: OrderMoney[];
  /** Gateways with sales whose payout file hasn't arrived — why money reads as awaiting. */
  missingPayoutFiles: { gateway: string; orders: number; grossAed: number }[];
};

// The ledger reads every payout; a short cache keeps the dashboard, the
// export and the Telegram chaser from rebuilding it back to back.
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; p: Promise<SalesLedgerResponse> }>();
function ledgerFor(month: string, fresh: boolean): Promise<SalesLedgerResponse> {
  const hit = cache.get(month);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = buildSalesLedger(month);
  cache.set(month, { at: Date.now(), p });
  p.catch(() => cache.delete(month));
  return p;
}

export async function loadTerms(): Promise<Terms> {
  const [expected, grace] = await Promise.all([
    getSetting<Record<string, number>>("payments.expected_days").catch(() => null),
    getSetting<number>("payments.overdue_grace_days").catch(() => null),
  ]);
  return {
    expectedDays: { ...DEFAULT_TERMS.expectedDays, ...(expected ?? {}) },
    graceDays: typeof grace === "number" ? grace : DEFAULT_TERMS.graceDays,
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function buildAdminMoney(from: string, to: string, opts: { fresh?: boolean } = {}): Promise<AdminMoney> {
  const today = dubaiToday();
  if (!DAY.test(from) || !DAY.test(to)) throw new Error("from/to must be YYYY-MM-DD");
  if (from > to) [from, to] = [to, from];
  if (to > today) to = today;
  if (from > to) from = to;
  const days = dubaiDayRange(from, to);
  if (days.length > 186) throw new Error("Pick at most six months");

  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  const [terms, ledgers] = await Promise.all([loadTerms(), Promise.all(months.map((m) => ledgerFor(m, !!opts.fresh)))]);

  const orders: OrderMoney[] = [];
  const cancelled: CancelledRow[] = [];
  const missing = new Map<string, { gateway: string; orders: number; grossAed: number }>();
  for (const l of ledgers) {
    for (const d of l.days) {
      if (d.day < from || d.day > to) continue;
      for (const c of d.cancelled.list) {
        cancelled.push({ day: d.day, orderNumber: c.orderNumber, store: c.store, customer: c.customerName, gateway: c.gateway || "Unclassified",
          amount: c.grossAed, creditNote: c.adjustment?.creditNote || "", cancelledOn: c.adjustment?.date || "" });
      }
      for (const o of d.orderList) {
        const row = orderMoney(o, today, terms);
        row.day = d.day; // the ledger's Dubai day is the source of truth
        orders.push(row);
        if (o.status === "no_payout_file") {
          const m = missing.get(o.gateway) ?? { gateway: o.gateway, orders: 0, grossAed: 0 };
          m.orders += 1;
          m.grossAed = Math.round((m.grossAed + o.grossAed) * 100) / 100;
          missing.set(o.gateway, m);
        }
      }
    }
  }
  orders.sort((a, b) => (a.day === b.day ? a.orderNumber.localeCompare(b.orderNumber) : a.day < b.day ? 1 : -1));

  return withCancelled({
    from, to, today, terms,
    totals: sumMoney(orders),
    days: byDay(orders, days).reverse(),
    gateways: byGateway(orders, terms),
    overdue: overdueByGateway(orders, terms),
    orders,
    missingPayoutFiles: [...missing.values()].sort((a, b) => b.grossAed - a.grossAed),
  }, cancelled);
}

const sumCancelled = (rows: CancelledRow[]): CancelledSum =>
  ({ orders: rows.length, amount: Math.round(rows.reduce((a, r) => a + r.amount, 0) * 100) / 100 });

/** Attach cancellations to the total, each day and each gateway (also used after a gateway filter). */
export function withCancelled(
  v: Omit<AdminMoney, "cancelled" | "totals" | "days" | "gateways"> & { totals: MoneyTotals; days: DayRow[]; gateways: GatewayRow[] },
  cancelled: CancelledRow[],
): AdminMoney {
  const gws = [...new Set([...v.gateways.map((g) => g.gateway), ...cancelled.map((c) => c.gateway)])];
  const zero = (gateway: string): GatewayRow => ({ gateway, ...sumMoney([]), expectedDays: 0, oldestAwaitingDays: 0 });
  return {
    ...v,
    cancelled: [...cancelled].sort((a, b) => (a.day < b.day ? 1 : -1)),
    totals: { ...v.totals, cancelled: sumCancelled(cancelled) },
    days: v.days.map((d) => ({ ...d, cancelled: sumCancelled(cancelled.filter((c) => c.day === d.day)) })),
    gateways: gws.map((g) => ({ ...(v.gateways.find((x) => x.gateway === g) ?? zero(g)), cancelled: sumCancelled(cancelled.filter((c) => c.gateway === g)) })),
  };
}
