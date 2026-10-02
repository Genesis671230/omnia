// Gathers the three sources for a range and compares them. DB + sheets only
// (sheets cached a minute); Zoho amounts come from zoho_invoice_index.

import { addDubaiDays, dubaiDayBoundsUtc } from "@/lib/dubai-day";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { ZohoInvoiceIndexRepository } from "@/lib/repositories/zoho-invoice-index";
import { readDispatchSheets } from "@/lib/integrations/dispatch-sheet-read";
import { compareThreeWay, norm, type TwOrder } from "./three-way";

export async function buildThreeWay(fromDay: string, toDay: string, fresh = false) {
  // A week either side: an order logged the next day (or the next month's
  // sheet) still finds its row and shows as a timing difference.
  const [orders, sheet] = await Promise.all([
    OrdersRepository.listInWindow({ from: dubaiDayBoundsUtc(addDubaiDays(fromDay, -45)).fromUtc, to: dubaiDayBoundsUtc(addDubaiDays(toDay, 15)).toUtc }),
    readDispatchSheets(addDubaiDays(fromDay, -7), addDubaiDays(toDay, 7), fresh),
  ]);
  const invoices = await ZohoInvoiceIndexRepository.forOrders([...orders.map((o) => o.order_number), ...sheet.rows.map((r) => norm(r.order))]);
  const result = compareThreeWay({ fromDay, toDay, orders: orders as unknown as TwOrder[], invoices, sheet: sheet.rows });
  return { ...result, sheetErrors: sheet.errors, sheetSources: sheet.sources, sheetReadAt: sheet.readAt, invoicesUpdatedAt: await ZohoInvoiceIndexRepository.lastUpdated() };
}
