import { NextResponse } from "next/server";
import { ZohoRepository } from "@/lib/repositories/zoho.repository";
import { StoreInventoryRepository } from "@/lib/repositories/store-inventory.repository";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { findStockMismatches, findOrdersMissingFromZoho } from "@/lib/inventory-compare";

export const maxDuration = 30;

// GET /api/inventory/summary — SKU stock mismatches (Zoho vs live
// Shopify/WooCommerce) and recent orders with no matching Zoho reference,
// for the inventory panel. Reads only from already-synced tables; does not
// call any live API.
export async function GET() {
  const [zohoItems, storeInventory, zohoOrders, orders] = await Promise.all([
    ZohoRepository.listItems(),
    StoreInventoryRepository.listAll(),
    ZohoRepository.listOrders(),
    OrdersRepository.listAll(),
  ]);

  const mismatches = findStockMismatches(zohoItems, storeInventory);
  const missingOrders = findOrdersMissingFromZoho(orders, zohoOrders);

  return NextResponse.json({
    mismatches,
    missingOrders: missingOrders.map((o) => ({
      uid: o.uid,
      orderNumber: o.order_number,
      storeId: o.store_id,
      orderDate: o.order_date,
      grossAed: o.gross_aed,
    })),
    counts: { zohoItems: zohoItems.length, storeInventoryRows: storeInventory.length, zohoOrders: zohoOrders.length },
  });
}
