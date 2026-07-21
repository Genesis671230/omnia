// Shared per-customer aggregation — extracted from app/api/customers/route.ts
// so the live API and CustomersRepository.rebuildAll() compute totals/AOV/
// LTV the exact same way and can never quietly drift apart.
import { customerIdentityKey } from "@/lib/customer-identity";
import type { OrderRowRaw } from "@/lib/repositories/orders.repository";

// Exported so callers computing their own pass over orders (e.g. the
// per-store CAC calculation in app/api/customers/route.ts) use the exact
// same "valid order" definition as the totals computed here.
export const CANCELLED = new Set(["voided", "refunded", "cancelled"]);

export type CustomerAggregate = {
  id: string;
  matchedBy: "email" | "phone";
  name: string;
  email: string;
  phone: string;
  stores: string[];
  totalOrders: number;
  totalSpendAed: number;
  aov: number;
  city: string;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  expectedLtvNextYear: number;
  orders: OrderRowRaw[]; // all orders for this customer, newest-first (caller decides what to expose)
};

// Run-rate projection: (lifetime spend ÷ months active) × 12, scaled down the
// longer a customer has gone quiet. Explainable and auditable on purpose —
// no hidden model, matches the founder-approved method from the design.
export function computeExpectedLtv(totalSpend: number, firstOrderIso: string, lastOrderIso: string): number {
  const now = Date.now();
  const monthsActive = Math.max((now - new Date(firstOrderIso).getTime()) / (1000 * 60 * 60 * 24 * 30.44), 1);
  const daysSinceLast = (now - new Date(lastOrderIso).getTime()) / (1000 * 60 * 60 * 24);
  const decay = daysSinceLast <= 60 ? 1 : daysSinceLast <= 180 ? 0.5 : 0.15;
  return +((totalSpend / monthsActive) * 12 * decay).toFixed(2);
}

// Groups orders by customer_id (falling back to live identity resolution for
// any row synced before customer_id existed — covers old rows without a
// separate migration script being a hard requirement for correctness, though
// scripts/stamp-customer-ids.ts fixes them at rest too).
export function aggregateCustomers(orders: OrderRowRaw[]): {
  customers: CustomerAggregate[];
  unidentifiedCount: number;
} {
  type Group = {
    key: string;
    matchedBy: "email" | "phone";
    name: string;
    email: string;
    city:string;
    phone: string;
    stores: Set<string>;
    validOrders: OrderRowRaw[];
    allOrders: OrderRowRaw[];
  };
  const groups = new Map<string, Group>();
  let unidentifiedCount = 0;

  for (const o of orders) {
    const id = o.customer_id
      ? { key: o.customer_id, matchedBy: (o.customer_id.startsWith("email:") ? "email" : "phone") as "email" | "phone" }
      : (() => {
          const k = customerIdentityKey(o.customer_email, o.customer_phone);
          return k ? { key: k.id, matchedBy: k.matchedBy } : null;
        })();
    if (!id) {
      unidentifiedCount++;
      continue;
    }
    let g = groups.get(id.key);
    if (!g) {
      g = { key: id.key, matchedBy: id.matchedBy, name: "",city:"", email: "", phone: "", stores: new Set(), validOrders: [], allOrders: [] };
      groups.set(id.key, g);
    }
    if (!g.city && o.city) g.city = o.city;
    g.allOrders.push(o);
    g.stores.add(o.store_id);
    // Orders come in newest-first (OrdersRepository.listAll() sorts
    // order_date DESC) — the first non-empty value we hit for each field is
    // that field's most recent value.
    if (!g.name && o.customer_name) g.name = o.customer_name;
    if (!g.email && o.customer_email) g.email = o.customer_email;
    if (!g.phone && o.customer_phone) g.phone = o.customer_phone;
    if (!CANCELLED.has(o.financial_status)) g.validOrders.push(o);
  }

  const customers = [...groups.values()].map((g) => {
    const dated = g.validOrders.filter((o) => o.order_date).sort((a, b) => a.order_date!.localeCompare(b.order_date!));
    const totalSpendAed = +dated.reduce((s, o) => s + Number(o.gross_aed || 0), 0).toFixed(2);
    const totalOrders = dated.length;
    const firstOrderDate = dated[0]?.order_date ?? null;
    const lastOrderDate = dated[dated.length - 1]?.order_date ?? null;
    const aov = totalOrders > 0 ? +(totalSpendAed / totalOrders).toFixed(2) : 0;

    return {
      id: g.key,
      matchedBy: g.matchedBy,
      name: g.name || g.email || g.phone || "Unknown",
      email: g.email,
      phone: g.phone,
      stores: [...g.stores],
      totalOrders,
      totalSpendAed,
      aov,
      city: g.city || "Unknown",
      firstOrderDate,
      lastOrderDate,
      expectedLtvNextYear:
        firstOrderDate && lastOrderDate && totalOrders > 0
          ? computeExpectedLtv(totalSpendAed, firstOrderDate, lastOrderDate)
          : 0,
      orders: g.allOrders.slice().sort((a, b) => (b.order_date || "").localeCompare(a.order_date || "")),
    };
  });

  return { customers, unidentifiedCount };
}
