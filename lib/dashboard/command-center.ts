// The top of the founder dashboard — pure figures for the greeting banner,
// the sales funnel and the courier lanes. Network reads live in
// app/api/dashboard/command-center/route.ts.
//
// Courier lanes: UAE orders go by road (OnTrack, the "Local orders" tab of
// the dispatch sheet); everything else flies with SMSA (the "SMSA Orders"
// tab) — the same country split as tabForOrder in dispatch-sheet.ts.
// Courier fees are only what a courier's own document proves: OnTrack's
// COD vouchers (gateway "COD" payout lines). SMSA's charges aren't uploaded
// anywhere yet, so they're reported as unknown, never guessed.

import { isCountedSale, type SaleRuleOrder } from "@/lib/orders/sale-rule";
import { dubaiDayKey, dubaiDayRange } from "@/lib/dubai-day";
import type { FunnelTotals, StoreFunnel } from "@/lib/integrations/shopify-analytics";

export type CcOrder = SaleRuleOrder & { order_number: string; order_date: string | null; country: string | null };

export type Lane = "road" | "air";
export const laneOf = (country: string | null | undefined): Lane => ((country || "").toUpperCase() === "AE" ? "road" : "air");

export type LaneStats = {
  lane: Lane;
  courier: string;
  orders: number;
  salesAed: number;
  /** Orders in the dispatch sheet's tab for this lane. */
  logged: number;
  /** Courier charges proven by an uploaded courier document; null = none uploaded. */
  feesAed: number | null;
  feeOrders: number;
  daily: { day: string; orders: number }[];
  topDestinations: { country: string; orders: number }[];
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function buildCourierLanes(input: {
  orders: CcOrder[];
  fromDay: string;
  toDay: string;
  /** Order numbers in each dispatch-sheet tab; null when the sheet couldn't be read. */
  sheet: { road: Set<string> | null; air: Set<string> | null };
  /** Courier fee per order number, from OnTrack COD vouchers. */
  roadFees: Map<string, number>;
}): LaneStats[] {
  const days = dubaiDayRange(input.fromDay, input.toDay);
  const lanes: Record<Lane, LaneStats> = {
    road: { lane: "road", courier: "OnTrack", orders: 0, salesAed: 0, logged: 0, feesAed: null, feeOrders: 0, daily: days.map((day) => ({ day, orders: 0 })), topDestinations: [] },
    air: { lane: "air", courier: "SMSA", orders: 0, salesAed: 0, logged: 0, feesAed: null, feeOrders: 0, daily: days.map((day) => ({ day, orders: 0 })), topDestinations: [] },
  };
  const dest: Record<Lane, Map<string, number>> = { road: new Map(), air: new Map() };
  const idx = new Map(days.map((d, i) => [d, i]));

  for (const o of input.orders) {
    const day = dubaiDayKey(o.order_date);
    if (!day || !idx.has(day) || !isCountedSale(o)) continue;
    const lane = laneOf(o.country);
    const s = lanes[lane];
    s.orders += 1;
    s.salesAed += Number(o.gross_aed) || 0;
    s.daily[idx.get(day)!].orders += 1;
    if (input.sheet[lane]?.has(o.order_number)) s.logged += 1;
    const c = (o.country || "?").toUpperCase();
    dest[lane].set(c, (dest[lane].get(c) ?? 0) + 1);
    if (lane === "road" && input.roadFees.has(o.order_number)) {
      s.feesAed = r2((s.feesAed ?? 0) + input.roadFees.get(o.order_number)!);
      s.feeOrders += 1;
    }
  }
  for (const lane of ["road", "air"] as Lane[]) {
    lanes[lane].salesAed = r2(lanes[lane].salesAed);
    lanes[lane].topDestinations = [...dest[lane]].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([country, orders]) => ({ country, orders }));
    if (!input.sheet[lane]) lanes[lane].logged = -1; // sheet unreadable
  }
  return [lanes.road, lanes.air];
}

export type SummedFunnel = FunnelTotals & { sites: string[]; missing: { site: string; reason: string }[] };

/** Store funnels added across the sites that report one (read_reports granted). */
export function sumStoreFunnels(funnels: ReadonlyArray<readonly [string, StoreFunnel]>): SummedFunnel {
  const out: SummedFunnel = { sessions: 0, addedToCart: 0, reachedCheckout: 0, completed: 0, sites: [], missing: [] };
  for (const [site, f] of funnels) {
    if (f.status !== "ok") { out.missing.push({ site, reason: f.message }); continue; }
    out.sites.push(site);
    out.sessions += f.totals.sessions;
    out.addedToCart += f.totals.addedToCart;
    out.reachedCheckout += f.totals.reachedCheckout;
    out.completed += f.totals.completed;
  }
  return out;
}

export type Pulse = {
  today: { day: string; orders: number; salesAed: number };
  yesterday: { orders: number; salesAed: number };
  mtd: { orders: number; salesAed: number; prevSalesAed: number; change: number | null };
};

/** Today vs yesterday, and month to date vs the same days of last month. */
export function buildPulse(orders: CcOrder[], today: string, monthFrom: string, prevFrom: string, prevTo: string, yesterday: string): Pulse {
  const p: Pulse = {
    today: { day: today, orders: 0, salesAed: 0 },
    yesterday: { orders: 0, salesAed: 0 },
    mtd: { orders: 0, salesAed: 0, prevSalesAed: 0, change: null },
  };
  for (const o of orders) {
    const day = dubaiDayKey(o.order_date);
    if (!day || !isCountedSale(o)) continue;
    const g = Number(o.gross_aed) || 0;
    if (day === today) { p.today.orders += 1; p.today.salesAed += g; }
    if (day === yesterday) { p.yesterday.orders += 1; p.yesterday.salesAed += g; }
    if (day >= monthFrom && day <= today) { p.mtd.orders += 1; p.mtd.salesAed += g; }
    if (day >= prevFrom && day <= prevTo) p.mtd.prevSalesAed += g;
  }
  p.today.salesAed = r2(p.today.salesAed);
  p.yesterday.salesAed = r2(p.yesterday.salesAed);
  p.mtd.salesAed = r2(p.mtd.salesAed);
  p.mtd.prevSalesAed = r2(p.mtd.prevSalesAed);
  p.mtd.change = p.mtd.prevSalesAed > 0 ? Math.round(((p.mtd.salesAed - p.mtd.prevSalesAed) / p.mtd.prevSalesAed) * 1000) / 10 : null;
  return p;
}
