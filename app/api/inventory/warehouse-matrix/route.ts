import { NextRequest, NextResponse } from "next/server";
import { WarehouseMatrixRepository } from "@/lib/repositories/warehouse-matrix.repository";
import { ZohoWarehousesRepository } from "@/lib/repositories/zoho-warehouses.repository";
import { computeAggregateInsights, isSellableWarehouse } from "@/lib/warehouse-matrix-insights";

// Paginated because 9,866 SKUs would kill both the browser and the JSON
// serializer. TanStack Table's manual pagination mode consumes this shape
// directly: { rows, total, page, pageSize }.
export const maxDuration = 60;

// GET /api/inventory/warehouse-matrix?page=1&pageSize=50&search=...
//    &sortKey=sku&sortDir=asc
//
// Returns:
//   { rows, total, page, pageSize,
//     warehouses: [{ warehouse_id, warehouse_name, is_primary }],  ← column order
//     kpis: { totalSkus, perWarehouse[], perStorefront[] },
//     insights: { ...aggregate for THIS PAGE only } }
//
// The panel calls this once per page-change. KPIs are computed against
// the full catalog (unfiltered) and stay stable; insights are page-scoped
// so filtering to "oversell only" shows insights for that filtered set.
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const pageSize = parseInt(url.searchParams.get("pageSize") || "50", 10);
  const search = url.searchParams.get("search") || undefined;
  const sortKey = (url.searchParams.get("sortKey") as "sku" | "name" | "zoho_aggregate_stock" | null) || "sku";
  const sortDir = (url.searchParams.get("sortDir") as "asc" | "desc" | null) || "asc";

  const [matrix, warehouses, kpis] = await Promise.all([
    WarehouseMatrixRepository.list({ page, pageSize, search, sortKey, sortDir }),
    ZohoWarehousesRepository.listAll(),
    WarehouseMatrixRepository.kpis(),
  ]);

  const insights = computeAggregateInsights(matrix.rows);

  return NextResponse.json({
    rows: matrix.rows,
    total: matrix.total,
    page,
    pageSize,
    // Column order the panel uses. Sellable warehouses first (primary
    // Omniastores LLC → SMSA KSA → any other sellable), then the
    // operational bucket (quarantine, damage, photoshoot, gifts). This
    // is the founder's reading order: the numbers that decide fulfillment
    // first, the numbers that explain "why isn't this sellable" after.
    warehouses: [...warehouses]
      .sort((a, b) => {
        const aSellable = isSellableWarehouse(a.warehouse_name);
        const bSellable = isSellableWarehouse(b.warehouse_name);
        if (aSellable !== bSellable) return aSellable ? -1 : 1;
        if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
        return a.warehouse_name.localeCompare(b.warehouse_name);
      })
      .map((w) => ({
        warehouse_id: w.warehouse_id,
        warehouse_name: w.warehouse_name,
        is_primary: w.is_primary,
        is_sellable: isSellableWarehouse(w.warehouse_name),
      })),
    kpis,
    insights,
  });
}