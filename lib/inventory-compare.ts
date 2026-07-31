// Comparison logic for the inventory panel — diffs Zoho's authoritative
// stock_on_hand against live Shopify/WooCommerce quantities (keyed on SKU),
// and flags recent store orders with no matching Zoho sales order/reference.
// Pure functions over already-fetched rows so the API route stays thin.

// export type StockMismatch = {
//   sku: string;
//   name: string;
//   zohoStock: number;
//   storeStock: { storeId: string; quantity: number | null }[];
//   maxDiff: number;
// };

// Flags a SKU whenever ANY store's live quantity differs from Zoho's
// stock_on_hand — the founder decides which side is stale.
// export function findStockMismatches(zohoItems: ZohoItemRow[], storeInventory: StoreInventoryRowDb[]): StockMismatch[] {
//   const zohoBySku = new Map(zohoItems.map((i) => [i.sku, i]));
//   const storeBySku = new Map<string, { storeId: string; quantity: number | null }[]>();
//   for (const row of storeInventory) {
//     const list = storeBySku.get(row.sku) ?? [];
//     list.push({ storeId: row.store_id, quantity: row.quantity });
//     storeBySku.set(row.sku, list);
//   }

//   const mismatches: StockMismatch[] = [];
//   for (const [sku, stores] of storeBySku) {
//     const zoho = zohoBySku.get(sku);
//     if (!zoho) continue; // SKU not in Zoho at all — a different exception, not a stock mismatch
//     let maxDiff = 0;
//     for (const s of stores) {
//       if (s.quantity === null) continue;
//       maxDiff = Math.max(maxDiff, Math.abs(s.quantity - zoho.stock_on_hand));
//     }
//     if (maxDiff > 0) {
//       mismatches.push({ sku, name: zoho.name, zohoStock: zoho.stock_on_hand, storeStock: stores, maxDiff });
//     }
//   }
//   return mismatches.sort((a, b) => b.maxDiff - a.maxDiff);
// }


export type ZohoItemRow = {
  sku: string;
  name: string;
  stock_on_hand: number;
  available_stock: number;
  status: string;
  unit_cost_aed?: number;   // optional — enables dead-cash quantification
};

export type StoreInventoryRow = {
  store_id: string;
  sku: string;
  quantity: number | null;
  product_title: string;
  product_status: string;
};

// Alias kept for anything still importing the old name.
export type StoreInventoryRowDb = StoreInventoryRow;

export type ZohoOrderRow = {
  salesorder_number: string;
  reference_number: string;
  order_status: string;
};

export type OrderRow = {
  uid: string;
  order_number: string;
  store_id: string;
  order_date: string | null;
  gross_aed: number;
};

/* ── output types the panel & API share ─────────────────────────────────── */
export type InvStatus =
  | "oversell_risk"     // store selling stock Zoho says isn't there
  | "unlisted"          // Zoho has stock, listed on ZERO stores — dead cash
  | "stock_mismatch"    // listed, but store qty diverges from Zoho beyond tolerance
  | "out"               // Zoho at 0, no store carries it either
  | "critical"          // Zoho 1..3
  | "low"               // Zoho 4..10
  | "ok";

export type CoverageBucket =
  | "everywhere"        // on Zoho AND every store we track
  | "zoho_only"         // in Zoho, on zero stores — DEAD CASH
  | "stores_only"       // on stores, not in Zoho — catalog gap
  | "missing_channels"  // on Zoho + some stores, absent from ≥1
  | "single_store"      // on exactly one store (± Zoho)
  | "nowhere";          // shouldn't happen — data bug

export interface StoreQty {
  storeId: string;
  quantity: number | null;
  listed: boolean;
}

export type InventoryItem = {
  sku: string;
  name: string;
  zohoStock: number;              // stock_on_hand — authoritative
  available: number;              // available_stock — governs oversell (on_hand − committed)
  zohoExists: boolean;            // does the Zoho catalog have this SKU at all?
  stores: StoreQty[];             // one entry per configured store, SAME ORDER every row
  totalStoreQty: number;
  maxDiff: number;                // max |zohoStock − storeQty| across LISTED stores only
  status: InvStatus;

  // coverage fields (Phase 1)
  presentOn: string[];            // e.g. ["zoho", "UAE", "KSA"]
  absentFrom: string[];           // e.g. ["WA", "WOO"]
  coverageBucket: CoverageBucket;
  deadCashAed: number;            // qty × unit_cost when coverageBucket === "zoho_only"
};

export type StockMismatch = {
  sku: string;
  name: string;
  zohoStock: number;
  storeStock: { storeId: string; quantity: number | null }[];
  maxDiff: number;
};

/* ── thresholds ─────────────────────────────────────────────────────────── */
// Kept as named constants so there's one place to change. When Zoho ever
// exposes a per-SKU reorder level, swap these for that field so a fast-mover
// and a slow-mover aren't judged the same.
const CRITICAL_MAX = 3;   // 1..3  → critical
const LOW_MAX = 10;       // 4..10 → low

// stock_mismatch tolerance: max(absolute floor, percentage) — so a 5 AED hair
// tie and a 1,500 AED pendant aren't held to the same absolute drift.
const MISMATCH_ABS = 2;
const MISMATCH_PCT = 0.10;

/* ── store ordering ─────────────────────────────────────────────────────── */
// Order stores deterministically so every row's stores[] lines up with the
// route's storeIds[] column order. Known stores first in a sensible reading
// order; any unexpected store_id falls to the end alphabetically rather than
// being dropped.
const STORE_ORDER = ["UAE", "KSA", "WA", "WOO"];
export function orderStoreIds(ids: Iterable<string>): string[] {
  const seen = [...new Set(ids)];
  return seen.sort((a, b) => {
    const ia = STORE_ORDER.indexOf(a), ib = STORE_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/* ── utilities ──────────────────────────────────────────────────────────── */
// Exported for reuse anywhere Zoho reference-number formatting drift needs
// absorbing (e.g. the Customer Payment publish invoice lookup).
export function normalizeRef(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* ── status classifier — single source of truth ─────────────────────────── */
// Priority order matters: highest-cost signal wins when a SKU trips multiple
// rules. Oversell tops the list because refunds cost money; unlisted follows
// because dead stock is unearned revenue.
function classify(zohoStock: number, available: number, storeQ: StoreQty[]): InvStatus {
  const listed = storeQ.filter((s) => s.listed);
  const liveOnAStore = listed.some((s) => (s.quantity ?? 0) > 0);

  // 1. Oversell: nothing available in Zoho, store still listing with stock.
  //    Uses `available` (not stock_on_hand) — committed-but-unshipped units
  //    are already spoken for and don't rescue this.
  if (available <= 0 && liveOnAStore) return "oversell_risk";

  // 2. Unlisted: Zoho has real stock, but no store carries this SKU.
  //    Dead-cash bucket — Fouad's #1 sales-gap signal.
  if (zohoStock > 0 && listed.length === 0) return "unlisted";

  // 3. Out: Zoho at zero, no store carrying it either.
  if (zohoStock <= 0) return "out";

  // 4. Mismatch: listed on ≥1 store, max per-store drift exceeds tolerance.
  const tol = Math.max(MISMATCH_ABS, Math.floor(zohoStock * MISMATCH_PCT));
  const maxDiff = listed.length
    ? Math.max(...listed.map((s) => Math.abs(zohoStock - (s.quantity ?? 0))))
    : 0;
  if (maxDiff > tol) return "stock_mismatch";

  if (zohoStock <= CRITICAL_MAX) return "critical";
  if (zohoStock <= LOW_MAX) return "low";
  return "ok";
}

/* ── coverage classifier — which channels carry this SKU ────────────────── */
function classifyCoverage(
  zohoExists: boolean,
  stores: StoreQty[],
  allStoreIds: string[],
): Pick<InventoryItem, "presentOn" | "absentFrom" | "coverageBucket"> {
  const present: string[] = [];
  if (zohoExists) present.push("zoho");
  for (const s of stores) if (s.listed) present.push(s.storeId);

  const allChannels = ["zoho", ...allStoreIds];
  const absent = allChannels.filter((c) => !present.includes(c));

  const hasZoho = present.includes("zoho");
  const storeCount = present.filter((c) => c !== "zoho").length;

  let bucket: CoverageBucket;
  if (present.length === 0) bucket = "nowhere";
  else if (absent.length === 0) bucket = "everywhere";
  else if (hasZoho && storeCount === 0) bucket = "zoho_only";
  else if (!hasZoho && storeCount > 0) bucket = "stores_only";
  else if (storeCount === 1) bucket = "single_store";
  else bucket = "missing_channels";

  return { presentOn: present, absentFrom: absent, coverageBucket: bucket };
}

/* ── build the full matrix ──────────────────────────────────────────────── */
// storeIds: the canonical column set (from sync config in the route). Passing
// it in — rather than inferring only from rows present — means a SKU absent
// from a store still gets an explicit { listed:false } cell for that column,
// so the matrix is rectangular and "not listed" is distinguishable from
// "listed but zero".
export function buildInventoryItems(
  zohoItems: ZohoItemRow[],
  storeInventory: StoreInventoryRow[],
  storeIds: string[],
): InventoryItem[] {
  // index live store quantities by "store|sku"
  const storeByKey = new Map<string, StoreInventoryRow>();
  const skusFromStores = new Set<string>();
  for (const r of storeInventory) {
    const sku = (r.sku ?? "").trim();
    if (!sku) continue;
    storeByKey.set(`${r.store_id}|${sku}`, r);
    skusFromStores.add(sku);
  }

  // Build the SKU universe from Zoho items (authoritative catalog). Also fold
  // in any SKU that exists on a store but NOT in Zoho — those are exactly the
  // oversell / stores_only candidates you'd otherwise never see.
  const zohoBySku = new Map<string, ZohoItemRow>();
  for (const z of zohoItems) {
    const sku = (z.sku ?? "").trim();
    if (sku) zohoBySku.set(sku, z);
  }
  const allSkus = new Set<string>([...zohoBySku.keys(), ...skusFromStores]);

  const items: InventoryItem[] = [];
  for (const sku of allSkus) {
    const z = zohoBySku.get(sku);
    const zohoStock = z?.stock_on_hand ?? 0;
    const available = z?.available_stock ?? 0;
    const zohoExists = !!z;
    // name: prefer Zoho's, fall back to whatever a store titled it
    const name =
      z?.name ||
      storeInventory.find((r) => (r.sku ?? "").trim() === sku)?.product_title ||
      sku;

    const stores: StoreQty[] = storeIds.map((sid) => {
      const row = storeByKey.get(`${sid}|${sku}`);
      return { storeId: sid, quantity: row ? row.quantity : null, listed: Boolean(row) };
    });

    const totalStoreQty = stores.reduce((s, q) => s + (q.quantity ?? 0), 0);

    // maxDiff across LISTED stores only — a store that doesn't sell this SKU
    // isn't a "difference", it's an absence.
    const listed = stores.filter((s) => s.listed);
    const maxDiff = listed.length
      ? Math.max(...listed.map((s) => Math.abs(zohoStock - (s.quantity ?? 0))))
      : 0;

    const coverage = classifyCoverage(zohoExists, stores, storeIds);

    // Dead cash: only meaningful for zoho_only SKUs (nobody's selling them).
    // Requires unit_cost_aed on the ZohoItemRow; falls back to 0 (count-based
    // filter still works, just no AED number).
    const deadCashAed =
      coverage.coverageBucket === "zoho_only" ? zohoStock * (z?.unit_cost_aed ?? 0) : 0;

    items.push({
      sku,
      name,
      zohoStock,
      available,
      zohoExists,
      stores,
      totalStoreQty,
      maxDiff,
      status: classify(zohoStock, available, stores),
      ...coverage,
      deadCashAed,
    });
  }

  // Sort by urgency, then largest divergence, then SKU — so the default order
  // is already action-ordered even before the panel sorts.
  const rank: Record<InvStatus, number> = {
    oversell_risk: 0,
    unlisted: 1,
    stock_mismatch: 2,
    out: 3,
    critical: 4,
    low: 5,
    ok: 6,
  };
  items.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] || b.maxDiff - a.maxDiff || a.sku.localeCompare(b.sku),
  );
  return items;
}

/* ── aggregates the panel's KPI row & filter pills read directly ────────── */
export function countInventory(items: InventoryItem[]) {
  return {
    outOfStock: items.filter((i) => i.status === "out").length,
    critical: items.filter((i) => i.status === "critical").length,
    oversellRisk: items.filter((i) => i.status === "oversell_risk").length,
    unlisted: items.filter((i) => i.status === "unlisted").length,
    stockMismatch: items.filter((i) => i.status === "stock_mismatch").length,
  };
}

export function countCoverage(items: InventoryItem[]): Record<CoverageBucket, number> {
  return {
    everywhere: items.filter((i) => i.coverageBucket === "everywhere").length,
    zoho_only: items.filter((i) => i.coverageBucket === "zoho_only").length,
    stores_only: items.filter((i) => i.coverageBucket === "stores_only").length,
    missing_channels: items.filter((i) => i.coverageBucket === "missing_channels").length,
    single_store: items.filter((i) => i.coverageBucket === "single_store").length,
    nowhere: items.filter((i) => i.coverageBucket === "nowhere").length,
  };
}

// Per-channel "how many SKUs are absent from this channel?" — drives the
// "Not on Woo / Not on KSA" sub-filters under Missing channels.
export function countMissingFrom(
  items: InventoryItem[],
  storeIds: string[],
): Record<string, number> {
  const channels = ["zoho", ...storeIds];
  const out: Record<string, number> = {};
  for (const c of channels) out[c] = items.filter((i) => i.absentFrom.includes(c)).length;
  return out;
}

// Per-store "how many SKUs live ONLY on this store?" — drives the sub-filters
// under Single store. Zoho excluded (zoho_only is its own top-level bucket).
export function countOnlyOn(
  items: InventoryItem[],
  storeIds: string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of storeIds) {
    out[c] = items.filter(
      (i) => i.coverageBucket === "single_store" && i.presentOn.includes(c),
    ).length;
  }
  return out;
}

export function sumDeadCash(items: InventoryItem[]): number {
  return items
    .filter((i) => i.coverageBucket === "zoho_only")
    .reduce((sum, i) => sum + i.deadCashAed, 0);
}

/* ── legacy finders — derive from the same matrix so they never drift ───── */
export function findStockMismatches(
  zohoItems: ZohoItemRow[],
  storeInventory: StoreInventoryRow[],
  storeIds?: string[],
): StockMismatch[] {
  const cols = storeIds ?? orderStoreIds(storeInventory.map((r) => r.store_id));
  return buildInventoryItems(zohoItems, storeInventory, cols)
    .filter((i) => i.maxDiff > 0)
    .map((i) => ({
      sku: i.sku,
      name: i.name,
      zohoStock: i.zohoStock,
      storeStock: i.stores
        .filter((s) => s.listed)
        .map((s) => ({ storeId: s.storeId, quantity: s.quantity })),
      maxDiff: i.maxDiff,
    }));
}

// Recent orders (default: last 30 days) with no matching Zoho salesorder
// number or reference — a likely bookkeeping gap, not proof of one, since
// Zoho reference formatting can vary by store.
export function findOrdersMissingFromZoho(
  orders: OrderRow[],
  zohoOrders: ZohoOrderRow[],
  days = 30,
): OrderRow[] {
  const zohoRefs = new Set<string>();
  for (const o of zohoOrders) {
    if (o.salesorder_number) zohoRefs.add(normalizeRef(o.salesorder_number));
    if (o.reference_number) zohoRefs.add(normalizeRef(o.reference_number));
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return orders.filter((o) => {
    if (!o.order_date || new Date(o.order_date).getTime() < cutoff) return false;
    const ref = normalizeRef(o.order_number);
    for (const zref of zohoRefs) {
      if (zref.includes(ref) || ref.includes(zref)) return false;
    }
    return true;
  });
}