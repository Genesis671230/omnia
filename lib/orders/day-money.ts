// Per-day money view for the dashboard overview: of what each Dubai day sold,
// how much is already in the bank, how much is still on its way, and roughly
// what the gateways keep. Pure — fed by the sales ledger (lib/orders/sales-ledger.ts),
// so every figure here traces to the same orders the day drawer lists.
//
// Received and pending are both on the GROSS basis (received + pending = sold),
// so the two bars of a day always stack to the day's sales. What actually
// landed after fees is carried separately as `landedNetAed`.

type DayIn = {
  day: string;
  grossAed: number;
  orders: number;
  feeAed: number;
  receivedAed: number;
  receivedGrossAed: number;
  headline: string;
  reason: string;
  orderList: { feeAed: number; feeBasis: "measured" | "allocated" | "estimated"; status: string; grossAed: number; gateway?: string }[];
};

/** One gateway's share of a day (or of a range, via sumGateways). */
export type GatewayMoney = { gateway: string; orders: number; soldAed: number; receivedAed: number; pendingAed: number; feeAed: number };

export type DayMoney = {
  day: string;
  orders: number;
  soldAed: number;
  receivedAed: number;
  pendingAed: number;
  /** Cash that hit the bank for this day's orders, after gateway fees. */
  landedNetAed: number;
  /** Gateway fee, measured where a payout line exists, estimated otherwise. */
  feeAed: number;
  /** Share of feeAed (0–1) that is an estimate rather than read off a payout file. */
  feeEstimatedShare: number;
  /** Fee as a share of sales (0–1); 0 on a day with no sales. */
  feeRate: number;
  /** COD orders never pass through a gateway payout — part of pending, reported apart. */
  codAed: number;
  /** The day split by gateway, largest first. An order counts as received
   *  here only once its own status is "received". */
  byGateway: GatewayMoney[];
  headline: string;
  reason: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function toDayMoney(d: DayIn): DayMoney {
  const sold = r2(d.grossAed);
  const received = r2(Math.min(d.receivedGrossAed, sold));
  const estimatedFee = d.orderList.filter((o) => o.feeBasis === "estimated").reduce((s, o) => s + o.feeAed, 0);
  const cod = d.orderList.filter((o) => o.status === "cod").reduce((s, o) => s + o.grossAed, 0);
  return {
    day: d.day,
    orders: d.orders,
    soldAed: sold,
    receivedAed: received,
    pendingAed: r2(Math.max(sold - received, 0)),
    landedNetAed: r2(d.receivedAed),
    feeAed: r2(d.feeAed),
    feeEstimatedShare: d.feeAed > 0 ? Math.min(estimatedFee / d.feeAed, 1) : 0,
    feeRate: sold > 0 ? d.feeAed / sold : 0,
    codAed: r2(cod),
    byGateway: splitByGateway(d.orderList),
    headline: d.headline,
    reason: d.reason,
  };
}

function splitByGateway(orders: DayIn["orderList"]): GatewayMoney[] {
  const by = new Map<string, GatewayMoney>();
  for (const o of orders) {
    const name = o.gateway?.trim() || "Unclassified";
    const g = by.get(name) ?? { gateway: name, orders: 0, soldAed: 0, receivedAed: 0, pendingAed: 0, feeAed: 0 };
    g.orders += 1;
    g.soldAed += o.grossAed;
    if (o.status === "received") g.receivedAed += o.grossAed;
    else g.pendingAed += o.grossAed;
    g.feeAed += o.feeAed;
    by.set(name, g);
  }
  return [...by.values()]
    .map((g) => ({ ...g, soldAed: r2(g.soldAed), receivedAed: r2(g.receivedAed), pendingAed: r2(g.pendingAed), feeAed: r2(g.feeAed) }))
    .sort((a, b) => b.soldAed - a.soldAed);
}

/** Gateway split summed over several days, largest first. */
export function sumGateways(days: DayMoney[]): GatewayMoney[] {
  const by = new Map<string, GatewayMoney>();
  for (const d of days) {
    for (const g of d.byGateway) {
      const t = by.get(g.gateway) ?? { gateway: g.gateway, orders: 0, soldAed: 0, receivedAed: 0, pendingAed: 0, feeAed: 0 };
      t.orders += g.orders; t.soldAed += g.soldAed; t.receivedAed += g.receivedAed; t.pendingAed += g.pendingAed; t.feeAed += g.feeAed;
      by.set(g.gateway, t);
    }
  }
  return [...by.values()]
    .map((g) => ({ ...g, soldAed: r2(g.soldAed), receivedAed: r2(g.receivedAed), pendingAed: r2(g.pendingAed), feeAed: r2(g.feeAed) }))
    .sort((a, b) => b.soldAed - a.soldAed);
}

export type MoneyTotals = Omit<DayMoney, "day" | "headline" | "reason" | "byGateway">;

export function sumDays(days: DayMoney[]): MoneyTotals {
  const t = days.reduce(
    (a, d) => ({
      orders: a.orders + d.orders,
      soldAed: a.soldAed + d.soldAed,
      receivedAed: a.receivedAed + d.receivedAed,
      pendingAed: a.pendingAed + d.pendingAed,
      landedNetAed: a.landedNetAed + d.landedNetAed,
      feeAed: a.feeAed + d.feeAed,
      estFee: a.estFee + d.feeAed * d.feeEstimatedShare,
      codAed: a.codAed + d.codAed,
    }),
    { orders: 0, soldAed: 0, receivedAed: 0, pendingAed: 0, landedNetAed: 0, feeAed: 0, estFee: 0, codAed: 0 },
  );
  return {
    orders: t.orders,
    soldAed: r2(t.soldAed),
    receivedAed: r2(t.receivedAed),
    pendingAed: r2(t.pendingAed),
    landedNetAed: r2(t.landedNetAed),
    feeAed: r2(t.feeAed),
    feeEstimatedShare: t.feeAed > 0 ? t.estFee / t.feeAed : 0,
    feeRate: t.soldAed > 0 ? t.feeAed / t.soldAed : 0,
    codAed: r2(t.codAed),
  };
}
