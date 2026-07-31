import { supabase } from "@/lib/supabase";

// Matrix row consumed by the warehouse cockpit panel — one row per SKU with
// warehouse + storefront quantities already pivoted into keyed maps so the
// TanStack Table cell renderer never has to search an array.
//
// This shape is deliberately fat: a founder-facing table needs every cell
// resolvable without follow-up calls, and the alternative (returning long
// rows and pivoting in JS on 9,866 SKUs × 50 per page) is fine for a 50-row
// page but breaks the moment we support "export everything to CSV". Pivoting
// in SQL keeps the pattern consistent from 50 rows to 10,000.
export type WarehouseMatrixRow = {
  item_id: string;
  sku: string;
  name: string;
  zoho_aggregate_stock: number;         // zoho_items.stock_on_hand (org-level)
  zoho_available_stock: number;         // zoho_items.available_stock (org-level, minus committed)

  // keyed by warehouse_id — always contains an entry for every warehouse in
  // zoho_warehouses (even those where is_item_mapped=false, quantity=0), so
  // the UI can render a rectangular matrix with no undefined checks.
  warehouses: Record<string, {
    warehouse_name: string;
    stock_on_hand: number;
    available_stock: number;
    actual_available_for_sale_stock: number;
    committed_stock: number;
    quantity_in_transit: number;
    is_item_mapped: boolean;
    is_primary: boolean;
    local_committed:number;
  }>;

  // keyed by store_id (UAE/KSA/WA/WOO). May be missing entries if a SKU
  // isn't listed on a store — UI treats missing as "not listed", not zero.
  storefronts: Record<string, {
    quantity: number | null;
    product_status: string;
  }>;
};

export type MatrixQueryOptions = {
  page: number;              // 1-based
  pageSize: number;
  search?: string;           // matches SKU or name (case-insensitive)
  sortKey?: "sku" | "name" | "zoho_aggregate_stock";
  sortDir?: "asc" | "desc";
};

const DEFAULT_PAGE_SIZE = 50;

export const WarehouseMatrixRepository = {
  // Paginated matrix query. Returns { rows, total } so the UI can render
  // TanStack Table's paginator without a second count() call — Supabase's
  // count option on the same query is cheaper than a separate exact count.
  async list(opts: MatrixQueryOptions): Promise<{ rows: WarehouseMatrixRow[]; total: number }> {
    const page = Math.max(1, opts.page);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize || DEFAULT_PAGE_SIZE));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Step 1: page of base items (SKU catalog). Every downstream fetch is
    // scoped to just these item_ids/skus, so query cost stays flat as the
    // catalog grows.
    let itemQuery = supabase
      .from("zoho_items")
      .select("item_id, sku, name, stock_on_hand, available_stock", { count: "exact" })
      // Zoho contains ~1,000 catalog placeholders with empty sku (e.g. "Fashion
      // Accessories Set" as a bare category name). They never map to a
      // storefront (store_inventory is keyed on non-empty sku) and never carry
      // warehouse stock — showing them in the panel is pure noise. Filter at
      // the DB, not in application code, so pagination totals stay accurate.
      .neq("sku", "")
      .not("sku", "is", null);

    if (opts.search && opts.search.trim()) {
      const q = opts.search.trim();
      itemQuery = itemQuery.or(`sku.ilike.%${q}%,name.ilike.%${q}%`);
    }

    const sortKey = opts.sortKey ?? "sku";
    const sortAsc = (opts.sortDir ?? "asc") === "asc";
    itemQuery = itemQuery.order(sortKey === "zoho_aggregate_stock" ? "stock_on_hand" : sortKey, { ascending: sortAsc });

    const { data: items, error: itemsErr, count } = await itemQuery.range(from, to);
    if (itemsErr) throw new Error(`warehouse matrix items query failed: ${itemsErr.message}`);
    if (!items || items.length === 0) return { rows: [], total: count ?? 0 };

    const itemIds = items.map((i) => i.item_id as string);
    const skus = items.map((i) => (i.sku ?? "").trim()).filter(Boolean);

    // Step 2: parallel fetch of warehouse rows + storefront rows for just
    // this page. Both queries are bounded by page size × ~7 warehouses ≈ 350
    // rows and page size × ~4 storefronts ≈ 200 rows respectively — trivial.
    const [warehouseData, storefrontData, warehouseMeta] = await Promise.all([
      supabase
        .from("zoho_item_warehouse_stock")
        .select("item_id, warehouse_id, stock_on_hand, available_stock, actual_available_for_sale_stock, committed_stock, quantity_in_transit, is_item_mapped, is_primary")
        .in("item_id", itemIds),
      supabase
        .from("store_inventory")
        .select("sku, store_id, quantity, product_status")
        .in("sku", skus),
      supabase
        .from("zoho_warehouses")
        .select("warehouse_id, warehouse_name"),
    ]);

    const { data: liveReservations } = await supabase
    .from("inventory_reservations")
    .select("item_id, warehouse_id, qty")
    .in("item_id", itemIds)
    .is("released_at", null);

    const localCommit = new Map<string, number>();  // key: `${item_id}::${warehouse_id}`
    for (const r of liveReservations ?? []) {
      const k = `${r.item_id}::${r.warehouse_id}`;
      localCommit.set(k, (localCommit.get(k) ?? 0) + Number(r.qty));
    }

    if (warehouseData.error) throw new Error(`warehouse stock query failed: ${warehouseData.error.message}`);
    if (storefrontData.error) throw new Error(`storefront inventory query failed: ${storefrontData.error.message}`);
    if (warehouseMeta.error) throw new Error(`warehouse meta query failed: ${warehouseMeta.error.message}`);

    const warehouseNameById = new Map<string, string>(
      (warehouseMeta.data ?? []).map((w) => [w.warehouse_id as string, (w.warehouse_name as string) ?? ""]),
    );

    
    
    // Step 3: pivot into per-SKU keyed maps. This is O(page_size × warehouses)
    // — cheap enough to run inline, and keeps the API contract clean (the
    // panel gets ready-to-render objects, not lists to search).
    const warehousesByItemId = new Map<string, WarehouseMatrixRow["warehouses"]>();
    for (const row of warehouseData.data ?? []) {
      const localHold = localCommit.get(`${row.item_id}::${row.warehouse_id}`) ?? 0;
      const effective = Math.max(0, Number(row.actual_available_for_sale_stock ?? 0) - localHold);

      const bucket = warehousesByItemId.get(row.item_id as string) ?? {};
      bucket[row.warehouse_id as string] = {
        warehouse_name: warehouseNameById.get(row.warehouse_id as string) ?? "",
        stock_on_hand: Number(row.stock_on_hand ?? 0),
        available_stock: Number(row.available_stock ?? 0),
        committed_stock: Number(row.committed_stock ?? 0),
        quantity_in_transit: Number(row.quantity_in_transit ?? 0),
        is_item_mapped: Boolean(row.is_item_mapped),
        is_primary: Boolean(row.is_primary),
        actual_available_for_sale_stock: effective, // Number(row.actual_available_for_sale_stock ?? 0),
        local_committed: localHold,                  
      };
      warehousesByItemId.set(row.item_id as string, bucket);
    }

    const storefrontsBySku = new Map<string, WarehouseMatrixRow["storefronts"]>();
    for (const row of storefrontData.data ?? []) {
      const sku = ((row.sku as string) ?? "").trim();
      const bucket = storefrontsBySku.get(sku) ?? {};
      bucket[row.store_id as string] = {
        quantity: row.quantity as number | null,
        product_status: (row.product_status as string) ?? "",
      };
      storefrontsBySku.set(sku, bucket);
    }

    const rows: WarehouseMatrixRow[] = items.map((item) => {
      const sku = ((item.sku as string) ?? "").trim();
      return {
        item_id: item.item_id as string,
        sku,
        name: (item.name as string) ?? "",
        zoho_aggregate_stock: Number(item.stock_on_hand ?? 0),
        zoho_available_stock: Number(item.available_stock ?? 0),
        warehouses: warehousesByItemId.get(item.item_id as string) ?? {},
        storefronts: storefrontsBySku.get(sku) ?? {},
      };
    });

    return { rows, total: count ?? rows.length };
  },

  // KPI strip data — one aggregate query, not derived from the paginated
  // rows above (which would only show page-scoped numbers). These figures
  // are the founder-facing headline the panel opens with.
  async kpis(): Promise<{
    totalSkus: number;
    perWarehouse: {
      warehouse_id: string;
      warehouse_name: string;
      skus_with_stock: number;
      total_units: number;
      total_sellable_units: number;
    }[];
    perStorefront: {
      store_id: string;
      skus_listed: number;
      total_listed_units: number;
    }[];
  }> {
    const [warehouseAgg, storefrontAgg, itemCount, warehouseMeta] = await Promise.all([
      supabase.rpc("warehouse_matrix_kpis_per_warehouse"),
      supabase.rpc("warehouse_matrix_kpis_per_storefront"),
      supabase.from("zoho_items").select("*", { count: "exact", head: true }),
      supabase.from("zoho_warehouses").select("warehouse_id, warehouse_name"),
    ]);

    // RPCs are optional — if the DB functions aren't installed yet, fall
    // back to inline aggregation queries so the panel still ships.
    if (warehouseAgg.error || storefrontAgg.error) {
      return fallbackKpisInline(itemCount.count ?? 0, warehouseMeta.data ?? []);
    }

    return {
      totalSkus: itemCount.count ?? 0,
      perWarehouse: (warehouseAgg.data ?? []) as any[],
      perStorefront: (storefrontAgg.data ?? []) as any[],
    };
  },
};

// Inline fallback aggregation used when the RPC functions haven't been
// installed yet (fresh DB, or a migration hasn't run). Slower — a full
// table scan on zoho_item_warehouse_stock — but correctness matters more
// than speed for a one-time KPI query the panel loads at start.
async function fallbackKpisInline(
  totalSkus: number,
  warehouses: { warehouse_id: string; warehouse_name: string }[],
) {
  const [stockRows, storeRows] = await Promise.all([
    pageAll<{ warehouse_id: string; stock_on_hand: number; actual_available_for_sale_stock: number }>(
      "zoho_item_warehouse_stock",
      "warehouse_id, stock_on_hand, actual_available_for_sale_stock",
    ),
    pageAll<{ store_id: string; sku: string; quantity: number | null }>(
      "store_inventory",
      "store_id, sku, quantity",
    ),
  ]);

  const perWarehouse = warehouses.map((w) => {
    const rows = stockRows.filter((r) => r.warehouse_id === w.warehouse_id);
    return {
      warehouse_id: w.warehouse_id,
      warehouse_name: w.warehouse_name,
      skus_with_stock: rows.filter((r) => (r.stock_on_hand ?? 0) > 0).length,
      total_units: rows.reduce((s, r) => s + (Number(r.stock_on_hand) || 0), 0),
      total_sellable_units: rows.reduce((s, r) => s + (Number(r.actual_available_for_sale_stock) || 0), 0),
    };
  });

  const storesSeen = new Map<string, { skus: Set<string>; units: number }>();
  for (const r of storeRows) {
    const entry = storesSeen.get(r.store_id) ?? { skus: new Set<string>(), units: 0 };
    if (r.sku) entry.skus.add(r.sku);
    if (typeof r.quantity === "number") entry.units += r.quantity;
    storesSeen.set(r.store_id, entry);
  }
  const perStorefront = [...storesSeen.entries()].map(([store_id, v]) => ({
    store_id,
    skus_listed: v.skus.size,
    total_listed_units: v.units,
  }));

  return { totalSkus, perWarehouse, perStorefront };
}

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} paged select failed: ${error.message}`);
    out.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}