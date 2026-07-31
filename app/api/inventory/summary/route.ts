import { NextResponse } from "next/server";
import { ZohoRepository } from "@/lib/repositories/zoho.repository";
import { StoreInventoryRepository } from "@/lib/repositories/store-inventory.repository";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import {
  findOrdersMissingFromZoho,
  buildInventoryItems,
  findStockMismatches,
  countInventory,
  countCoverage,
  countMissingFrom,
  countOnlyOn,
  sumDeadCash,
  orderStoreIds,
} from "@/lib/inventory-compare";

export const maxDuration = 30;

// The stores the inventory panel renders as columns. Kept explicit (not just
// "whatever store_ids appear in the data") so an empty/half-synced store still
// shows as a column the founder expects — a missing column reads as "this
// store is fine" when it actually means "this store never synced".
const CONFIGURED_STORES = ["UAE", "KSA", "WA", "WOO"];

// GET /api/inventory/summary — full per-SKU × per-store stock matrix with a
// server-computed status per SKU (oversell/unlisted/mismatch/out/critical/
// low/ok) AND server-computed coverage (which channels carry each SKU), plus
// existing mismatch + missing-order sections. Reads only synced tables;
// never calls a live store/Zoho API.
export async function GET() {
  const [zohoItems, storeInventory, zohoOrders, orders] = await Promise.all([
    ZohoRepository.listItems(),
    StoreInventoryRepository.listAll(),
    ZohoRepository.listOrders(),
    OrdersRepository.listAll(),
  ]);

  const storeIds = orderStoreIds([
    ...CONFIGURED_STORES,
    ...storeInventory.map((r) => r.store_id),
  ]);

  const items = buildInventoryItems(zohoItems, storeInventory, storeIds);
  const mismatches = findStockMismatches(zohoItems, storeInventory, storeIds);
  const missingOrders = findOrdersMissingFromZoho(orders, zohoOrders);

  return NextResponse.json({
    items,
    storeIds,
    mismatches,
    missingOrders: missingOrders.map((o) => ({
      uid: o.uid,
      orderNumber: o.order_number,
      storeId: o.store_id,
      orderDate: o.order_date,
      grossAed: o.gross_aed,
    })),
    counts: {
      zohoItems: zohoItems.length,
      storeInventoryRows: storeInventory.length,
      zohoOrders: zohoOrders.length,
      ...countInventory(items),
      byCoverage: countCoverage(items),
      missingFrom: countMissingFrom(items, storeIds),
      onlyOn: countOnlyOn(items, storeIds),
      deadCashAed: sumDeadCash(items),
    },
  });
}