import { NextResponse } from "next/server";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { AdInsightsRepository } from "@/lib/repositories/ad-insights.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { computeFinanceStatuses } from "@/lib/orders-finance-status";
import { aggregateCustomers, CANCELLED } from "@/lib/customers/aggregate";
import { customerIdentityKey } from "@/lib/customer-identity";

// GET /api/customers — one aggregation pass over every order, grouped into
// customers by email (fallback: normalized phone), ranked by lifetime spend.
// The grouping/totals math lives in lib/customers/aggregate.ts, shared with
// CustomersRepository.rebuildAll() (the persisted `customers` table) so the
// two can never quietly compute different numbers for the same customer.
//
// Two numbers on this response are estimates, not measurements, and are
// labeled as such in the UI:
//   - expectedLtvNextYear: a recency-decayed run-rate projection, not a
//     statistical model. See computeExpectedLtv in lib/customers/aggregate.ts.
//   - cac (blended, per store/month): total ad spend that store/month ÷ net-new
//     customers whose first order AT THAT STORE fell in that month. There is
//     no click-to-order attribution in this data, so this is never per-customer
//     — it's a budget-accountability context number, same caveat as the Meta
//     ROAS split (docs/superpowers/specs/2026-07-17-meta-ads-correctness-design.md).

const AD_STORES = ["WOO", "KSA", "UAE"]; // WA has no ad spend tracked

const monthKey = (iso: string) => iso.slice(0, 7); // "YYYY-MM"

export async function GET() {
  const to = new Date().toISOString().slice(0, 10);

  const fromDate = new Date();
  fromDate.setFullYear(fromDate.getFullYear() - 2);
  const from = fromDate.toISOString().slice(0, 10);

  const [orders, insights, payouts] = await Promise.all([
    OrdersRepository.listAll(),
    AdInsightsRepository.listInsights(from, to),
    PayoutsRepository.listWithRefs(),
  ]);
  const financeByUid = new Map(computeFinanceStatuses(orders, payouts).map((o) => [o.uid, o]));

  const { customers: aggregated, unidentifiedCount } = aggregateCustomers(orders);

  const customers = aggregated.map((c) => ({
    key: c.id,
    matchedBy: c.matchedBy,
    name: c.name,
    email: c.email,
    phone: c.phone,
    city:c.city,
    stores: c.stores,
    totalOrders: c.totalOrders,
    totalSpendAed: c.totalSpendAed,
    aov: c.aov,
    firstOrderDate: c.firstOrderDate,
    lastOrderDate: c.lastOrderDate,
    expectedLtvNextYear: c.expectedLtvNextYear,
    orders: c.orders.map((o) => ({
      uid: o.uid, order_number: o.order_number, store_id: o.store_id, order_date: o.order_date,
      gross_aed: o.gross_aed, currency: o.currency, gateway: o.gateway,
      financial_status: o.financial_status, fulfillment_status: o.fulfillment_status,
      finance_status: financeByUid.get(o.uid)?.finance_status ?? "MISSING_PAYOUT",
      fulfillment_stage: o.fulfillment_stage || "processing",
    })),
  }));

  customers.sort((a, b) => b.totalSpendAed - a.totalSpendAed);
  // VIP tier fixed to the default LTV ranking, independent of how the client
  // later re-sorts the table — a badge shouldn't flicker when you sort by AOV.
  const ranked = customers.map((c, i) => ({ ...c,city: c.city, rank: i + 1, tier: i < 10 ? "VIP" as const : i < 50 ? "Loyal" as const : null }));

  // Blended CAC: net-new customers per store+month = customers whose FIRST
  // valid order at that specific store falls in that month (a multi-store
  // customer can be "new" at store B without being new to the business —
  // this matches spend accountability to the store whose budget paid for
  // it). Needs per-store first-valid-order-date granularity that doesn't
  // belong in the top-level customer aggregate, so this stays its own pass
  // over the order list rather than reusing aggregateCustomers()'s output.
  const firstValidByCustomerStore = new Map<string, string>(); // "customerId:store" -> earliest valid order date
  for (const o of orders) {
    if (CANCELLED.has(o.financial_status) || !o.order_date) continue;
    const id = o.customer_id ?? customerIdentityKey(o.customer_email, o.customer_phone)?.id;
    if (!id) continue;
    const key = `${id}:${o.store_id}`;
    const cur = firstValidByCustomerStore.get(key);
    if (!cur || o.order_date < cur) firstValidByCustomerStore.set(key, o.order_date);
  }
  const newByStoreMonth = new Map<string, number>();
  for (const [key, date] of firstValidByCustomerStore) {
    const store = key.slice(key.lastIndexOf(":") + 1);
    const mk = `${store}:${monthKey(date)}`;
    newByStoreMonth.set(mk, (newByStoreMonth.get(mk) ?? 0) + 1);
  }

  const spendByStoreMonth = new Map<string, number>();
  for (const row of insights) {
    if (!AD_STORES.includes(row.store_id)) continue;
    const mk = `${row.store_id}:${monthKey(row.date)}`;
    spendByStoreMonth.set(mk, (spendByStoreMonth.get(mk) ?? 0) + row.spend);
  }

  const cacByStoreMonth = [...spendByStoreMonth.keys()]
    .map((mk) => {
      const [store, month] = mk.split(":");
      const spend = +spendByStoreMonth.get(mk)!.toFixed(2);
      const newCustomers = newByStoreMonth.get(mk) ?? 0;
      return { store, month, spend, newCustomers, cac: newCustomers > 0 ? +(spend / newCustomers).toFixed(2) : null };
    })
    .sort((a, b) => (a.month === b.month ? a.store.localeCompare(b.store) : b.month.localeCompare(a.month)));

  const currentMonth = to.slice(0, 7);
  const currentMonthCac = AD_STORES.map((store) => cacByStoreMonth.find((r) => r.store === store && r.month === currentMonth) ?? { store, month: currentMonth, spend: 0, newCustomers: 0, cac: null });

  return NextResponse.json({
    customers: ranked,
    unidentifiedCount,
    cac: { currentMonth: currentMonthCac, history: cacByStoreMonth.slice(0, 24) },
  });
}
