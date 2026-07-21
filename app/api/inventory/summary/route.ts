// import { NextResponse } from "next/server";
// import { ZohoRepository } from "@/lib/repositories/zoho.repository";
// import { StoreInventoryRepository } from "@/lib/repositories/store-inventory.repository";
// import { OrdersRepository } from "@/lib/repositories/orders.repository";
// import { findStockMismatches, findOrdersMissingFromZoho } from "@/lib/inventory-compare";

// export const maxDuration = 30;

// // GET /api/inventory/summary — SKU stock mismatches (Zoho vs live
// // Shopify/WooCommerce) and recent orders with no matching Zoho reference,
// // for the inventory panel. Reads only from already-synced tables; does not
// // call any live API.
// export async function GET() {
//   const [zohoItems, storeInventory, zohoOrders, orders] = await Promise.all([
//     ZohoRepository.listItems(),
//     StoreInventoryRepository.listAll(),
//     ZohoRepository.listOrders(),
//     OrdersRepository.listAll(),
//   ]);

//   const mismatches = findStockMismatches(zohoItems, storeInventory);
//   const missingOrders = findOrdersMissingFromZoho(orders, zohoOrders);

//   return NextResponse.json({
//     mismatches,
//     missingOrders: missingOrders.map((o) => ({
//       uid: o.uid,
//       orderNumber: o.order_number,
//       storeId: o.store_id,
//       orderDate: o.order_date,
//       grossAed: o.gross_aed,
//     })),
//     counts: { zohoItems: zohoItems.length, storeInventoryRows: storeInventory.length, zohoOrders: zohoOrders.length },
//   });
// }

import { NextResponse } from "next/server";
import { ZohoRepository } from "@/lib/repositories/zoho.repository";
import { StoreInventoryRepository } from "@/lib/repositories/store-inventory.repository";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import {
  findOrdersMissingFromZoho,
  buildInventoryItems,
  findStockMismatches,
  countInventory,
  orderStoreIds,
} from "@/lib/inventory-compare";

export const maxDuration = 30;

// The stores the inventory panel renders as columns. Kept explicit (not just
// "whatever store_ids appear in the data") so an empty/half-synced store still
// shows as a column the founder expects — a missing column reads as "this
// store is fine" when it actually means "this store never synced". Matches the
// StoreInventoryRow store_id union in store-inventory.repository.ts.
const CONFIGURED_STORES = ["UAE", "KSA", "WA", "WOO"];

// GET /api/inventory/summary — full per-SKU × per-store stock matrix with a
// server-computed status per SKU (oversell_risk / out / critical / low / ok),
// plus the existing mismatch + missing-order sections. Reads only synced
// tables; never calls a live store/Zoho API.
export async function GET() {
  const [zohoItems, storeInventory, zohoOrders, orders] = await Promise.all([
    ZohoRepository.listItems(),
    StoreInventoryRepository.listAll(),
    ZohoRepository.listOrders(),
    OrdersRepository.listAll(),
  ]);

  // Column order: configured stores first, then any unexpected store_id that
  // showed up in data (so nothing is silently hidden), all deterministically
  // ordered by orderStoreIds so every row's stores[] lines up with storeIds[].
  const storeIds = orderStoreIds([
    ...CONFIGURED_STORES,
    ...storeInventory.map((r) => r.store_id),
  ]);

  const items = buildInventoryItems(zohoItems, storeInventory, storeIds);
  const mismatches = findStockMismatches(zohoItems, storeInventory, storeIds);
  const missingOrders = findOrdersMissingFromZoho(orders, zohoOrders);
  const alertCounts = countInventory(items);

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
      ...alertCounts,
    },
  });
}