import { NextResponse } from "next/server";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { AdInsightsRepository } from "@/lib/repositories/ad-insights.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { computeFinanceStatuses } from "@/lib/orders-finance-status";

// GET /api/customers — one aggregation pass over every order, grouped into
// customers by email (fallback: normalized phone), ranked by lifetime spend.
//
// No new table: order volume here is a few thousand rows, cheap to group
// in-memory (same call OrdersRepository.listAll() already makes for
// /api/orders and /api/ads/summary).
//
// Two numbers on this response are estimates, not measurements, and are
// labeled as such in the UI:
//   - expectedLtvNextYear: a recency-decayed run-rate projection, not a
//     statistical model. See computeExpectedLtv below for the method.
//   - cac (blended, per store/month): total ad spend that store/month ÷ net-new
//     customers whose first order AT THAT STORE fell in that month. There is
//     no click-to-order attribution in this data, so this is never per-customer
//     — it's a budget-accountability context number, same caveat as the Meta
//     ROAS split (docs/superpowers/specs/2026-07-17-meta-ads-correctness-design.md).

const CANCELLED = new Set(["voided", "refunded", "cancelled"]);
const AD_STORES = ["WOO", "KSA", "UAE"]; // WA has no ad spend tracked

type Order = Awaited<ReturnType<typeof OrdersRepository.listAll>>[number];

function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email || "").trim().toLowerCase();
  return e || null;
}

// Strips formatting/country-code variance (+971 / 00971 / 971 / 0) by
// comparing only the last 9 digits. Heuristic, not exact — flagged in the UI.
function normalizePhone(phone: string | null | undefined): string | null {
  const digits = (phone || "").replace(/\D/g, "");
  return digits.length >= 6 ? digits.slice(-9) : null;
}

function identityKey(o: Order): { key: string; matchedBy: "email" | "phone" } | null {
  const email = normalizeEmail(o.customer_email);
  if (email) return { key: `email:${email}`, matchedBy: "email" };
  const phone = normalizePhone(o.customer_phone);
  if (phone) return { key: `phone:${phone}`, matchedBy: "phone" };
  return null;
}

const monthKey = (iso: string) => iso.slice(0, 7); // "YYYY-MM"

// Run-rate projection: (lifetime spend ÷ months active) × 12, scaled down the
// longer a customer has gone quiet. Explainable and auditable on purpose —
// no hidden model, matches the founder-approved method from the design.
function computeExpectedLtv(totalSpend: number, firstOrderIso: string, lastOrderIso: string): number {
  const now = Date.now();
  const monthsActive = Math.max((now - new Date(firstOrderIso).getTime()) / (1000 * 60 * 60 * 24 * 30.44), 1);
  const daysSinceLast = (now - new Date(lastOrderIso).getTime()) / (1000 * 60 * 60 * 24);
  const decay = daysSinceLast <= 60 ? 1 : daysSinceLast <= 180 ? 0.5 : 0.15;
  return +((totalSpend / monthsActive) * 12 * decay).toFixed(2);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "365", 10) || 365, 30), 730);
  const to = new Date().toISOString().slice(0, 10);
  // const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  

  const fromDate = new Date();
  fromDate.setFullYear(fromDate.getFullYear() - 2);
  const from = fromDate.toISOString().slice(0, 10);


  const [orders, insights, payouts] = await Promise.all([
    OrdersRepository.listAll(),
    AdInsightsRepository.listInsights(from, to),
    PayoutsRepository.listWithRefs(),
  ]);
  const financeByUid = new Map(
    computeFinanceStatuses(orders, payouts).map((o) => [o.uid, o]),
  );

  type Group = {
    key: string;
    matchedBy: "email" | "phone";
    name: string;
    email: string;
    phone: string;
    stores: Set<string>;
    validOrders: Order[];
    allOrders: Order[];
  };
  const groups = new Map<string, Group>();
  let unidentifiedCount = 0;

  for (const o of orders) {
    const id = identityKey(o);
    if (!id) { unidentifiedCount++; continue; }
    let g = groups.get(id.key);
    if (!g) {
      g = { key: id.key, matchedBy: id.matchedBy, name: "", email: "", phone: "", stores: new Set(), validOrders: [], allOrders: [] };
      groups.set(id.key, g);
    }
    g.allOrders.push(o);
    g.stores.add(o.store_id);
    // OrdersRepository.listAll() is sorted order_date DESC, so within a
    // customer's own orders we also see newest-first — the first non-empty
    // value we hit for each field is that field's most recent value.
    if (!g.name && o.customer_name) g.name = o.customer_name;
    if (!g.email && o.customer_email) g.email = o.customer_email;
    if (!g.phone && o.customer_phone) g.phone = o.customer_phone;
    if (!CANCELLED.has(o.financial_status)) g.validOrders.push(o);
  }

  console.log("Unique customers:", groups.size);
console.log("Orders without identity:", unidentifiedCount);
  const customers = [...groups.values()].map((g) => {
    const dated = g.validOrders.filter((o) => o.order_date).sort((a, b) => a.order_date!.localeCompare(b.order_date!));
    const totalSpendAed = +dated.reduce((s, o) => s + Number(o.gross_aed || 0), 0).toFixed(2);
    const totalOrders = dated.length;
    const firstOrderDate = dated[0]?.order_date ?? null;
    const lastOrderDate = dated[dated.length - 1]?.order_date ?? null;
    const aov = totalOrders > 0 ? +(totalSpendAed / totalOrders).toFixed(2) : 0;

    return {
      key: g.key,
      matchedBy: g.matchedBy,
      name: g.name || g.email || g.phone || "Unknown",
      email: g.email,
      phone: g.phone,
      stores: [...g.stores],
      totalOrders,
      totalSpendAed,
      aov,
      firstOrderDate,
      lastOrderDate,
      expectedLtvNextYear: firstOrderDate && lastOrderDate && totalOrders > 0
        ? computeExpectedLtv(totalSpendAed, firstOrderDate, lastOrderDate)
        : 0,
      orders: g.allOrders
        .slice()
        .sort((a, b) => (b.order_date || "").localeCompare(a.order_date || ""))
        .map((o) => ({
          uid: o.uid, order_number: o.order_number, store_id: o.store_id, order_date: o.order_date,
          gross_aed: o.gross_aed, currency: o.currency, gateway: o.gateway,
          financial_status: o.financial_status, fulfillment_status: o.fulfillment_status,
          finance_status: financeByUid.get(o.uid)?.finance_status ?? "MISSING_PAYOUT",
          fulfillment_stage: o.fulfillment_stage || "processing",
        })),
    };
  });

  customers.sort((a, b) => b.totalSpendAed - a.totalSpendAed);
  // VIP tier fixed to the default LTV ranking, independent of how the client
  // later re-sorts the table — a badge shouldn't flicker when you sort by AOV.
  const ranked = customers.map((c, i) => ({ ...c, rank: i + 1, tier: i < 10 ? "VIP" as const : i < 50 ? "Loyal" as const : null }));

  // Blended CAC: net-new customers per store+month = customers whose FIRST
  // valid order at that specific store falls in that month (a multi-store
  // customer can be "new" at store B without being new to the business —
  // this matches spend accountability to the store whose budget paid for it).
  const newByStoreMonth = new Map<string, number>();
  for (const g of groups.values()) {
    const byStore = new Map<string, string>(); // store -> earliest valid order date at that store
    for (const o of g.validOrders) {
      if (!o.order_date) continue;
      const cur = byStore.get(o.store_id);
      if (!cur || o.order_date < cur) byStore.set(o.store_id, o.order_date);
    }
    for (const [store, date] of byStore) {
      const mk = `${store}:${monthKey(date)}`;
      newByStoreMonth.set(mk, (newByStoreMonth.get(mk) ?? 0) + 1);
    }
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
