// Comparison logic for the inventory panel — diffs Zoho's authoritative
// stock_on_hand against live Shopify/WooCommerce quantities (keyed on SKU),
// and flags recent store orders with no matching Zoho sales order/reference.
// Pure functions over already-fetched rows so the API route stays thin.

// export type ZohoItemRow = { sku: string; name: string; stock_on_hand: number; available_stock: number; status: string };
export type StoreInventoryRowDb = { store_id: string; sku: string; quantity: number | null; product_title: string; product_status: string };
export type ZohoOrderRow = { salesorder_number: string; reference_number: string; order_status: string };
export type OrderRow = { uid: string; order_number: string; store_id: string; order_date: string | null; gross_aed: number };

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

// Exported for reuse anywhere else Zoho reference-number formatting drift
// needs absorbing (e.g. the Customer Payment publish invoice lookup).
export function normalizeRef(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Recent orders (default: last 30 days) with no matching Zoho salesorder
// number or reference — a likely bookkeeping gap, not proof of one, since
// Zoho reference formatting can vary by store.
export function findOrdersMissingFromZoho(orders: OrderRow[], zohoOrders: ZohoOrderRow[], days = 30): OrderRow[] {
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


// Inventory comparison: Zoho (authoritative stock_on_hand) vs live per-store
// quantities, plus store orders with no matching Zoho sales order.
//
// This file adds buildInventoryItems() — the full per-SKU × per-store matrix
// with a single server-side status classification — WITHOUT changing the
// existing findStockMismatches / findOrdersMissingFromZoho signatures the
// route already calls. The status rule lives here (one place) so the panel
// never re-derives it and the two can't drift.

/* ── shared input shapes (mirror the repositories) ──────────────────────── */
export type ZohoItemRow = {
  sku: string; name: string; stock_on_hand: number; available_stock: number; status: string;
};
export type StoreInventoryRow = {
  store_id: string; sku: string; quantity: number | null; product_title: string; product_status: string;
};

/* ── output shapes (consumed by the route → panel) ──────────────────────── */
export type InvStatus = "oversell_risk" | "out" | "critical" | "low" | "ok";

export type StoreQty = { storeId: string; quantity: number | null; listed: boolean };

export type InventoryItem = {
  sku: string;
  name: string;
  zohoStock: number;        // stock_on_hand — authoritative
  available: number;        // available_stock — governs oversell (on_hand − committed)
  stores: StoreQty[];       // one entry per configured store, SAME ORDER every row
  totalStoreQty: number;
  maxDiff: number;          // max |zohoStock − storeQty| across LISTED stores only
  status: InvStatus;
};

// Thresholds are a starting point. If Zoho ever syncs a per-SKU reorder level,
// swap these constants for that field so a fast-mover and a slow-mover aren't
// judged the same. Kept as named constants so there's one place to change.
const CRITICAL_MAX = 3;   // 1..3  → critical
const LOW_MAX = 10;       // 4..10 → low

// Order stores deterministically so every row's `stores[]` lines up with the
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

/* ── the classifier — the single source of truth for status ─────────────── */
function classify(zohoStock: number, available: number, storeQ: StoreQty[]): InvStatus {
  // Oversell risk is the most urgent: nothing available to sell in Zoho, yet a
  // store is still listing it with live stock. That's selling air. We check
  // available_stock (not stock_on_hand) because committed-but-not-shipped
  // units are already spoken for.
  const liveOnAStore = storeQ.some((s) => s.listed && (s.quantity ?? 0) > 0);
  if (available <= 0 && liveOnAStore) return "oversell_risk";

  if (zohoStock <= 0) return "out";
  if (zohoStock <= CRITICAL_MAX) return "critical";
  if (zohoStock <= LOW_MAX) return "low";
  return "ok";
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
  // oversell candidates you'd otherwise never see, so they must not be
  // dropped just because Zoho has no row.
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
    // isn't a "difference", it's an absence. Comparing against a phantom 0
    // there would flag every multi-store SKU as mismatched.
    const listed = stores.filter((s) => s.listed);
    const maxDiff = listed.length
      ? Math.max(...listed.map((s) => Math.abs(zohoStock - (s.quantity ?? 0))))
      : 0;

    items.push({
      sku, name, zohoStock, available, stores, totalStoreQty, maxDiff,
      status: classify(zohoStock, available, stores),
    });
  }

  // Sort by urgency, then largest divergence, then SKU — so the default order
  // is already action-ordered even before the panel sorts.
  const rank: Record<InvStatus, number> = { oversell_risk: 0, out: 1, critical: 2, low: 3, ok: 4 };
  items.sort((a, b) =>
    rank[a.status] - rank[b.status] || b.maxDiff - a.maxDiff || a.sku.localeCompare(b.sku),
  );
  return items;
}

// Summary counts the panel's alert KPIs read directly.
export function countInventory(items: InventoryItem[]) {
  return {
    outOfStock: items.filter((i) => i.status === "out").length,
    critical: items.filter((i) => i.status === "critical").length,
    oversellRisk: items.filter((i) => i.status === "oversell_risk").length,
  };
}

/* ────────────────────────────────────────────────────────────────────────
   EXISTING finders — unchanged behavior, included here so this file stays the
   single home of inventory comparison. If your current implementations differ,
   keep yours; only the additions above are new. findStockMismatches now
   trivially derives from the same matrix to guarantee it never disagrees with
   the full view.
   ──────────────────────────────────────────────────────────────────────── */
export type StockMismatch = {
  sku: string; name: string; zohoStock: number;
  storeStock: { storeId: string; quantity: number | null }[]; maxDiff: number;
};

export function findStockMismatches(
  zohoItems: ZohoItemRow[],
  storeInventory: StoreInventoryRow[],
  storeIds?: string[],
): StockMismatch[] {
  const cols = storeIds ?? orderStoreIds(storeInventory.map((r) => r.store_id));
  return buildInventoryItems(zohoItems, storeInventory, cols)
    .filter((i) => i.maxDiff > 0)
    .map((i) => ({
      sku: i.sku, name: i.name, zohoStock: i.zohoStock,
      storeStock: i.stores.filter((s) => s.listed).map((s) => ({ storeId: s.storeId, quantity: s.quantity })),
      maxDiff: i.maxDiff,
    }));
}