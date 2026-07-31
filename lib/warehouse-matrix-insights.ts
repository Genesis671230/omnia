// Insights layer for the warehouse cockpit — per-warehouse status,
// cross-source drift detection, and per-SKU health score.
//
// Every function here is pure and takes already-fetched matrix rows.
// Deliberately separate from the repository so the panel can call it
// client-side over a filtered subset without a server round-trip, AND
// so the same logic can drive the summary badge on the KPI strip AND
// the per-row status pill AND the slice-2 insights feed — one source
// of classification truth for the whole panel.

import type { WarehouseMatrixRow } from "@/lib/repositories/warehouse-matrix.repository";

export type WarehouseStatus = "oversell_risk" | "out" | "critical" | "low" | "ok" | "not_carried";

// Thresholds are starting points. When Zoho reorder_level per SKU is synced
// (already fetched but unused today), swap CRITICAL_MAX / LOW_MAX for that
// per-SKU value so a fast-mover and a slow-mover aren't judged the same.
const CRITICAL_MAX = 3;
const LOW_MAX = 10;

// The 5 operational warehouses that don't count as "sellable" — quarantine,
// damage buckets, photoshoot, gifts. Kept explicit so a founder-visible
// dashboard doesn't count 1,197 quarantined units as "in stock, ready to
// ship." Fouad's per-warehouse dropdown will let him override this.
const OPERATIONAL_WAREHOUSE_NAMES = new Set([
  "KSA Quarantine",
  "PRMNT DMG",
  "Damage-Awaiting Repair",
  "Modeling, Photoshoot, Temporary Usage",
  "Omnia, Gifts, etc",
]);

export function isSellableWarehouse(warehouse_name: string): boolean {
  return !OPERATIONAL_WAREHOUSE_NAMES.has(warehouse_name);
}

/* ── per-warehouse cell status ─────────────────────────────────────────── */

// The single classifier that decides how each cell in the matrix renders.
// Applies to ONE (SKU, warehouse) pair. The panel calls this for every
// visible cell — it's the same rule everywhere so the panel and the
// insights feed never disagree.
export function classifyWarehouseCell(
  warehouse: WarehouseMatrixRow["warehouses"][string] | undefined,
  storefronts: WarehouseMatrixRow["storefronts"],
): WarehouseStatus {
  if (!warehouse || !warehouse.is_item_mapped) return "not_carried";

  const sellable = warehouse.actual_available_for_sale_stock ?? 0;

  // Oversell test: is a storefront listing this SKU with stock > 0 while
  // this warehouse has nothing to actually ship? Applies specifically to
  // sellable warehouses — a Quarantine cell showing 0 while a storefront
  // has 5 isn't oversell, that's just "quarantine doesn't ship."
  if (isSellableWarehouse(warehouse.warehouse_name) && sellable <= 0) {
    const anyStorefrontListing = Object.values(storefronts).some(
      (s) => typeof s.quantity === "number" && s.quantity > 0,
    );
    if (anyStorefrontListing) return "oversell_risk";
  }

  if (sellable <= 0) return "out";
  if (sellable <= CRITICAL_MAX) return "critical";
  if (sellable <= LOW_MAX) return "low";
  return "ok";
}

/* ── per-row health score ──────────────────────────────────────────────── */

// A single 0-100 number a founder can eyeball to decide "is this SKU
// healthy right now." Combines multiple signals so no single metric can
// dominate — a SKU showing 100 units at Omniastores but zero at SMSA KSA
// while KSA is actively listed is NOT a healthy SKU even though its total
// looks fine.
export type HealthSignal = {
  score: number;                       // 0..100
  reasons: string[];                   // short human-readable explanations
  worstStatus: WarehouseStatus;
};

export function computeRowHealth(row: WarehouseMatrixRow): HealthSignal {
  const reasons: string[] = [];
  let score = 100;
  let worst: WarehouseStatus = "ok";
  const rank: Record<WarehouseStatus, number> = {
    oversell_risk: 0, out: 1, critical: 2, low: 3, ok: 4, not_carried: 5,
  };

  // Signal 1: any oversell risk = automatic red
  const cellStatuses = Object.values(row.warehouses).map((w) =>
    classifyWarehouseCell(w, row.storefronts),
  );
  for (const s of cellStatuses) if (rank[s] < rank[worst]) worst = s;

  if (cellStatuses.includes("oversell_risk")) {
    score = Math.min(score, 15);
    reasons.push("live on a storefront while a sellable warehouse has zero");
  }

  // Signal 2: is aggregate stock high while sellable is low? That means
  // most stock is stuck in quarantine or damage — a real ops problem.
  const totalStock = Object.values(row.warehouses).reduce(
    (s, w) => s + (w.stock_on_hand ?? 0), 0,
  );
  const totalSellable = Object.values(row.warehouses).reduce(
    (s, w) => isSellableWarehouse(w.warehouse_name) ? s + (w.actual_available_for_sale_stock ?? 0) : s,
    0,
  );
  if (totalStock > 5 && totalSellable === 0) {
    score = Math.min(score, 25);
    reasons.push(`${totalStock} units on hand but 0 sellable`);
  }

  // Signal 3: storefront listing exceeds real sellable — small versions
  // of this happen constantly with the batched sync, but a gap > 3 is
  // worth surfacing.
  const totalStorefrontListing = Object.values(row.storefronts).reduce(
    (s, sf) => s + (typeof sf.quantity === "number" ? sf.quantity : 0), 0,
  );
  const gap = totalStorefrontListing - totalSellable;
  if (gap > 3) {
    score = Math.min(score, 50);
    reasons.push(`storefronts listing ${totalStorefrontListing} but only ${totalSellable} sellable (${gap}-unit gap)`);
  }

  // Signal 4: SKU below LOW threshold anywhere sellable
  const anySellableLow = Object.values(row.warehouses).some(
    (w) => isSellableWarehouse(w.warehouse_name) && w.is_item_mapped &&
           w.actual_available_for_sale_stock <= LOW_MAX && w.actual_available_for_sale_stock > 0,
  );
  if (anySellableLow && reasons.length === 0) {
    score = Math.min(score, 70);
    reasons.push("running low in at least one sellable warehouse");
  }

  return { score, reasons, worstStatus: worst };
}

/* ── slice 2: aggregate insights across a page or filtered set ─────────── */

export type AggregateInsights = {
  totalRows: number;
  oversellRiskRows: number;
  hasStockButNoneSellableRows: number;
  storefrontExceedsSellableRows: number;
  averageHealth: number;
  worstOffenders: { sku: string; name: string; score: number; reasons: string[] }[];
};

export function computeAggregateInsights(rows: WarehouseMatrixRow[]): AggregateInsights {
  const signals = rows.map((r) => ({ row: r, signal: computeRowHealth(r) }));
  const oversellRiskRows = signals.filter((s) => s.signal.reasons.some((r) => r.includes("storefront while a sellable"))).length;
  const hasStockButNoneSellableRows = signals.filter((s) => s.signal.reasons.some((r) => r.includes("on hand but 0 sellable"))).length;
  const storefrontExceedsSellableRows = signals.filter((s) => s.signal.reasons.some((r) => r.includes("unit gap"))).length;
  const averageHealth = signals.length
    ? signals.reduce((s, x) => s + x.signal.score, 0) / signals.length
    : 100;

  // Top 10 worst offenders — the "what should Fouad look at first" list.
  const worstOffenders = signals
    .filter((s) => s.signal.score < 100)
    .sort((a, b) => a.signal.score - b.signal.score)
    .slice(0, 10)
    .map((s) => ({
      sku: s.row.sku,
      name: s.row.name,
      score: s.signal.score,
      reasons: s.signal.reasons,
    }));

  return {
    totalRows: rows.length,
    oversellRiskRows,
    hasStockButNoneSellableRows,
    storefrontExceedsSellableRows,
    averageHealth: Math.round(averageHealth),
    worstOffenders,
  };
}