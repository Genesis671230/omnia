// From the dashboard's sales to the dispatch sheet's "Overall Sales", order by
// order, so every dirham of the difference has a reason. Pure.
//
// The sheet's Summary tab (Sep 2026 sheet):
//   International = SUM('SMSA Orders'!G)  ("In AED" — what's left after refunds)
//   Local         = SUM(' Local orders'!H) ("Total")
//   Cancelations  = SUM of both tabs' "Cancelled / Refunded Amount"
//   Overall Sales = International + Local + Cancelations
// So per row the sheet counts  left + cancelled/refunded  — for EVERY row,
// including exchange / repair shipments, cancelled-before-dispatch orders,
// fully refunded orders and duplicates. The dashboard counts only counted
// sales the store dates in the month, at the store's own AED amount.

import type { TwRow } from "./three-way";

export type BridgeReason =
  | "missing_in_sheet"     // a sale the sheet never logged (−)
  | "cancelled_refunded"   // cancelled / fully refunded in the store, the sheet adds it back (+)
  | "cancelled_in_sheet"   // the sheet cancelled / refunded it, the store still counts the sale (±)
  | "not_a_store_sale"     // pending / unpaid / voided in the store, logged as a sale (+)
  | "other_month"          // the store dates it in another month (+)
  | "no_store_order"       // sheet order number with no store order (+)
  | "exchange_rows"        // exchange / repair / pending shipments counted as sales (+)
  | "duplicate_rows"       // the same sale logged twice (+)
  | "fx_rate"              // foreign-currency order: the sheet's flat rate vs the store's rate (±)
  | "amount_edit";         // AED order whose amount differs (discount, shipping, manual edit) (±)

export const BRIDGE_LABEL: Record<BridgeReason, string> = {
  missing_in_sheet: "Sales missing from the sheet",
  cancelled_refunded: "Cancelled / fully refunded — sheet adds them back",
  cancelled_in_sheet: "Cancelled / refunded in the sheet, still a sale in the store",
  not_a_store_sale: "Pending / unpaid / voided in the store",
  other_month: "Store order dated in another month",
  no_store_order: "No store order with that number",
  exchange_rows: "Exchange / repair rows counted as sales",
  duplicate_rows: "Duplicate rows",
  fx_rate: "Currency conversion (sheet's flat rate vs actual)",
  amount_edit: "Amount differs on AED orders",
};

export type BridgeLine = { reason: BridgeReason; order: string; gateway: string; store: string; dashboardAed: number; sheetAed: number; diffAed: number; note: string };
export type Bridge = {
  dashboardAed: number;
  sheetAed: number;
  diffAed: number;
  diffPct: number;
  byReason: { reason: BridgeReason; label: string; orders: number; diffAed: number }[];
  byGateway: { gateway: string; dashboardAed: number; sheetAed: number; diffAed: number; diffPct: number | null; topReason: BridgeReason | null }[];
  lines: BridgeLine[];
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** One name per gateway across the store and the sheet's "Party" column. */
export function gatewayName(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return "Unknown";
  if (s.includes("exchange")) return "Exchange";
  if (s.includes("cod") || s.includes("cash")) return "COD";
  if (s.includes("shopify")) return "Shopify Payments";
  for (const g of ["stripe", "tabby", "tamara", "telr", "checkout", "network", "paypal", "apple"]) if (s.includes(g)) return g[0].toUpperCase() + g.slice(1);
  return raw.trim();
}

export function buildBridge(rows: TwRow[], fromDay: string, toDay: string): Bridge {
  const inRange = (d: string | null) => Boolean(d && d >= fromDay && d <= toDay);
  const gross = (r: { amountAed: number | null; cancelledRefundedAed: number | null }) => (r.amountAed ?? 0) + (r.cancelledRefundedAed ?? 0);
  const lines: BridgeLine[] = [];
  let dashboardAed = 0, sheetAed = 0;

  for (const r of rows) {
    const sales = r.sheet.filter((s) => inRange(s.day));
    const ships = r.shipments.filter((s) => inRange(s.day));
    const dash = r.counted ? r.oursAed ?? 0 : 0;
    const salesGross = sales.reduce((s, x) => s + gross(x), 0);
    const shipsGross = ships.reduce((s, x) => s + gross(x), 0);
    dashboardAed += dash;
    sheetAed += salesGross + shipsGross;
    const gw = gatewayName(r.gateway || sales[0]?.gateway || ships[0]?.gateway || "");
    const base = { order: r.order, gateway: gw, store: r.store };
    const fs = r.financialStatus.toLowerCase();

    if (r.counted && !sales.length && !ships.length) {
      lines.push({ ...base, reason: "missing_in_sheet", dashboardAed: dash, sheetAed: 0, diffAed: -dash, note: "Not in the sheet" });
      continue;
    }
    if (ships.length) {
      lines.push({ ...base, reason: "exchange_rows", dashboardAed: 0, sheetAed: shipsGross, diffAed: shipsGross, note: ships.map((s) => `${s.saleType || s.kind} row ${s.row}`).join(", ") });
    }
    if (!sales.length) {
      if (r.counted) lines.push({ ...base, reason: "missing_in_sheet", dashboardAed: dash, sheetAed: 0, diffAed: -dash, note: "Only an exchange row in the sheet, not the sale" });
      continue;
    }
    if (!r.counted) {
      const reason: BridgeReason = r.status === "other_month" ? "other_month"
        : !r.store ? "no_store_order"
        : fs === "cancelled" || fs === "voided" || fs === "refunded" || sales.some((s) => s.kind === "cancelled" || s.kind === "refunded") ? "cancelled_refunded"
        : "not_a_store_sale";
      lines.push({ ...base, reason, dashboardAed: 0, sheetAed: salesGross, diffAed: salesGross, note: r.reason });
      continue;
    }
    // A counted sale with sheet rows: extra copies, then the amount itself.
    if (sales.length > 1) {
      const extra = sales.slice(1).reduce((s, x) => s + gross(x), 0);
      lines.push({ ...base, reason: "duplicate_rows", dashboardAed: 0, sheetAed: extra, diffAed: extra, note: `Rows ${sales.map((s) => s.row).join(", ")}` });
    }
    const first = gross(sales[0]);
    const d = first - dash;
    if (Math.abs(d) >= 0.005 && (sales[0].kind === "cancelled" || sales[0].kind === "refunded")) {
      lines.push({ ...base, reason: "cancelled_in_sheet", dashboardAed: dash, sheetAed: first, diffAed: d, note: sales[0].comments || sales[0].kind });
    } else if (Math.abs(d) >= 0.005) {
      const fx = r.storeCurrency !== "AED" || (sales[0].currency || "AED").toUpperCase() !== "AED";
      lines.push({
        ...base, reason: fx ? "fx_rate" : "amount_edit", dashboardAed: dash, sheetAed: first, diffAed: d,
        note: fx ? `${sales[0].currency} ${sales[0].amountOriginal ?? ""} @ ${sales[0].exchangeRate ?? "?"} in the sheet` : sales[0].comments || "Amount differs",
      });
    }
  }

  const byReasonMap = new Map<BridgeReason, { orders: Set<string>; diff: number }>();
  for (const l of lines) {
    const b = byReasonMap.get(l.reason) ?? { orders: new Set(), diff: 0 };
    b.orders.add(l.order); b.diff += l.diffAed;
    byReasonMap.set(l.reason, b);
  }
  // Per gateway: the dashboard side from counted sales, the sheet side from rows.
  const gw = new Map<string, { dash: number; sheet: number; reasons: Map<BridgeReason, number> }>();
  const gwOf = (g: string) => gw.get(g) ?? (gw.set(g, { dash: 0, sheet: 0, reasons: new Map() }), gw.get(g)!);
  for (const r of rows) {
    if (!r.counted) continue;
    gwOf(gatewayName(r.gateway)).dash += r.oursAed ?? 0;
  }
  for (const r of rows) {
    for (const s of [...r.sheet, ...r.shipments]) {
      if (!inRange(s.day)) continue;
      // A counted order's sheet rows go to the store's gateway; the rest to the sheet's party.
      gwOf(r.counted ? gatewayName(r.gateway) : gatewayName(s.gateway || r.gateway)).sheet += gross(s);
    }
  }
  for (const l of lines) { const g = gwOf(l.gateway); g.reasons.set(l.reason, (g.reasons.get(l.reason) ?? 0) + Math.abs(l.diffAed)); }

  const diffAed = r2(sheetAed - dashboardAed);
  return {
    dashboardAed: r2(dashboardAed), sheetAed: r2(sheetAed), diffAed,
    diffPct: dashboardAed ? r2((diffAed / dashboardAed) * 100) : 0,
    byReason: [...byReasonMap].map(([reason, v]) => ({ reason, label: BRIDGE_LABEL[reason], orders: v.orders.size, diffAed: r2(v.diff) }))
      .sort((a, b) => Math.abs(b.diffAed) - Math.abs(a.diffAed)),
    byGateway: [...gw].map(([gateway, v]) => {
      const d = r2(v.sheet - v.dash);
      const top = [...v.reasons].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return { gateway, dashboardAed: r2(v.dash), sheetAed: r2(v.sheet), diffAed: d, diffPct: v.dash ? r2((d / v.dash) * 100) : null, topReason: Math.abs(d) >= 0.01 ? top : null };
    }).filter((g) => g.dashboardAed || g.sheetAed).sort((a, b) => b.dashboardAed - a.dashboardAed),
    lines: lines.sort((a, b) => Math.abs(b.diffAed) - Math.abs(a.diffAed)),
  };
}
