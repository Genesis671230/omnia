// Reads one month's dispatch sheet (Local + SMSA tabs) and the store orders,
// and lists the cancellations / refunds / returns / exchanges the sheet
// records that the app hasn't marked yet. Read-only: applying goes through
// /api/orders/:uid/adjust like any other adjustment.

import { addDubaiDays, dubaiDayBoundsUtc } from "@/lib/dubai-day";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { OrderAdjustmentsRepository } from "@/lib/repositories/order-adjustments.repository";
import { readDispatchSheets } from "@/lib/integrations/dispatch-sheet-read";
import { ledgerMonthBounds } from "@/lib/orders/sales-ledger";
import { ZohoInvoiceIndexRepository } from "@/lib/repositories/zoho-invoice-index";
import { gatewayRefundsFor } from "@/lib/reports/management-report.service";
import { suggestSheetAdjustments, type EvidenceGatewayRefund, type SheetAdjOrder } from "./sheet-adjustments";
import { norm } from "./three-way";

export async function buildSheetAdjustments(month: string, fresh = false) {
  const { fromDay, toDay, label } = ledgerMonthBounds(month);
  const [orders, sheet] = await Promise.all([
    OrdersRepository.listInWindow({ from: dubaiDayBoundsUtc(fromDay).fromUtc, to: dubaiDayBoundsUtc(toDay).toUtc }),
    // the month's sheet plus a fortnight after: a refund is often logged late
    readDispatchSheets(fromDay, addDubaiDays(toDay, 14), fresh),
  ]);
  const numbers = orders.map((o) => o.order_number);
  const [posted, creditNotes, refunds] = await Promise.all([
    OrderAdjustmentsRepository.postedFor(numbers),
    ZohoInvoiceIndexRepository.creditNotesFor(numbers),
    gatewayRefundsFor(numbers),
  ]);
  const gatewayRefunds = new Map<string, EvidenceGatewayRefund[]>();
  for (const r of refunds) gatewayRefunds.set(norm(r.order), [...(gatewayRefunds.get(norm(r.order)) ?? []), { amountAed: r.amountAed, gateway: r.gateway, date: r.date }]);
  const byUid = new Map<string, string>();
  // postedFor puts a refund ahead of a "received" close; either way the kind
  // tells the finder whether there's still something to mark
  for (const o of orders) { const a = posted.get(o.order_number); if (a) byUid.set(o.uid, a.kind); }
  const suggestions = suggestSheetAdjustments({ fromDay, toDay, orders: orders as unknown as SheetAdjOrder[], sheet: sheet.rows, posted: byUid, creditNotes, gatewayRefunds });
  return { month, label, fromDay, toDay, suggestions, sheetSources: sheet.sources, sheetErrors: sheet.errors, sheetReadAt: sheet.readAt };
}
