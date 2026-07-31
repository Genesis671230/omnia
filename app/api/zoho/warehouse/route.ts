import { NextResponse } from "next/server";
import { ZohoWarehousesRepository } from "@/lib/repositories/zoho-warehouses.repository";
import { syncZohoWarehouses, syncItemWarehouseStockDelta } from "@/lib/zoho-warehouse-sync";

// The delta path only detail-fetches items changed since the last sync's
// cursor. On a well-caught-up DB that's usually dozens per hour — fits
// comfortably inside the 300s ceiling. The initial 11K backfill does NOT
// run through this route (see scripts/backfill-zoho-warehouse-stock.ts).
export const maxDuration = 300;

// GET /api/integrations/zoho/warehouses — the 7 warehouses as we have
// them, primary first. UI reads this to render the per-warehouse columns.
export async function GET() {
  const warehouses = await ZohoWarehousesRepository.listAll();
  return NextResponse.json({ warehouses });
}

// POST /api/integrations/zoho/warehouses — refresh metadata AND run one
// delta sync of item-warehouse stock. Do NOT call this on cold DB — run
// the local backfill script first, then this route stays cheap forever.
export async function POST() {
  const warehousesResult = await syncZohoWarehouses();
  const stockResult = await syncItemWarehouseStockDelta();
  return NextResponse.json({
    warehouses: warehousesResult,
    stock: stockResult,
  });
}