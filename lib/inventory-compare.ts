// Comparison logic for the inventory panel — diffs Zoho's authoritative
// stock_on_hand against live Shopify/WooCommerce quantities (keyed on SKU),
// and flags recent store orders with no matching Zoho sales order/reference.
// Pure functions over already-fetched rows so the API route stays thin.

export type ZohoItemRow = { sku: string; name: string; stock_on_hand: number; available_stock: number; status: string };
export type StoreInventoryRowDb = { store_id: string; sku: string; quantity: number | null; product_title: string; product_status: string };
export type ZohoOrderRow = { salesorder_number: string; reference_number: string; order_status: string };
export type OrderRow = { uid: string; order_number: string; store_id: string; order_date: string | null; gross_aed: number };

export type StockMismatch = {
  sku: string;
  name: string;
  zohoStock: number;
  storeStock: { storeId: string; quantity: number | null }[];
  maxDiff: number;
};

// Flags a SKU whenever ANY store's live quantity differs from Zoho's
// stock_on_hand — the founder decides which side is stale.
export function findStockMismatches(zohoItems: ZohoItemRow[], storeInventory: StoreInventoryRowDb[]): StockMismatch[] {
  const zohoBySku = new Map(zohoItems.map((i) => [i.sku, i]));
  const storeBySku = new Map<string, { storeId: string; quantity: number | null }[]>();
  for (const row of storeInventory) {
    const list = storeBySku.get(row.sku) ?? [];
    list.push({ storeId: row.store_id, quantity: row.quantity });
    storeBySku.set(row.sku, list);
  }

  const mismatches: StockMismatch[] = [];
  for (const [sku, stores] of storeBySku) {
    const zoho = zohoBySku.get(sku);
    if (!zoho) continue; // SKU not in Zoho at all — a different exception, not a stock mismatch
    let maxDiff = 0;
    for (const s of stores) {
      if (s.quantity === null) continue;
      maxDiff = Math.max(maxDiff, Math.abs(s.quantity - zoho.stock_on_hand));
    }
    if (maxDiff > 0) {
      mismatches.push({ sku, name: zoho.name, zohoStock: zoho.stock_on_hand, storeStock: stores, maxDiff });
    }
  }
  return mismatches.sort((a, b) => b.maxDiff - a.maxDiff);
}

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
