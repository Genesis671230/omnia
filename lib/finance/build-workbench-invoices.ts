// Core of the invoices-workbench data pipeline: Zoho invoices for a window,
// joined against orders/settlements for gateway + exchange detection.
// Extracted out of app/api/invoices/workbench/route.ts so the sheet-matches
// route (lib/finance/payments-sheet.ts's consumer) can reuse the exact same
// gateway-derivation and exchange-grouping logic instead of re-deriving it.

import { listZohoInvoicesAll } from "@/lib/integrations/zoho";
import { extractOrderNumber } from "@/lib/finance/extract-order-number";
import { deriveGateway } from "@/lib/finance/derive-gateway";
import { classifyResidual } from "@/lib/finance/classify-invoice";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkbenchInvoice, WorkbenchResponse, ZohoInvoiceStatus } from "@/lib/finance/types";

export function defaultWorkbenchFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

export async function buildWorkbenchInvoices({
  from, to, status,
}: {
  from: string;
  to: string;
  status: ZohoInvoiceStatus | "all";
}): Promise<WorkbenchResponse> {
  const orgId = process.env.ZOHO_ORGANIZATION_ID!;

  // 1. Pull Zoho invoices for the window (25 pages × 200 = 5000 max)
  const zohoInvoices = await listZohoInvoicesAll(
    {
      status: status === "all" ? undefined : status,
      dateStart: from,
      dateEnd: to,
      perPage: 20,
    },
    orgId,
    25,
  );

  // 2. Extract order numbers, build exchange index
  const enriched = zohoInvoices.map((inv) => ({
    ...inv,
    orderNumber: extractOrderNumber(inv.customer_name),
  }));

  const byOrder = new Map<string, typeof enriched>();
  for (const inv of enriched) {
    if (!inv.orderNumber) continue;
    const arr = byOrder.get(inv.orderNumber) ?? [];
    arr.push(inv);
    byOrder.set(inv.orderNumber, arr);
  }
  const exchangeOrders = new Set(
    [...byOrder.entries()].filter(([, arr]) => arr.length >= 2).map(([k]) => k),
  );

  // 3. Batch-join local orders + settlements — 2 queries, parallel
  const orderNumbers = [...byOrder.keys()];
  const supabase = createAdminClient();

  const [ordersRes, settlementsRes] = await Promise.all([
    supabase
      .from("orders")
      .select("order_number, payment_gateway_names, gateway")
      .in("order_number", orderNumbers),
    supabase
      .from("settlement_records")
      .select("id, order_number, gateway, bank_line_id, gross_aed")
      .in("order_number", orderNumbers),
  ]);

  const orderMap = new Map((ordersRes.data ?? []).map((o: any) => [o.order_number, o]));
  const settlementMap = new Map((settlementsRes.data ?? []).map((s: any) => [s.order_number, s]));

  // 4. Build enriched rows
  const rows: WorkbenchInvoice[] = enriched.map((inv) => {
    const order = inv.orderNumber ? orderMap.get(inv.orderNumber) : undefined;
    const settlement = inv.orderNumber ? settlementMap.get(inv.orderNumber) : undefined;
    const { gateway, source } = deriveGateway(inv.orderNumber, settlement as any, order as any);
    const isExchange = !!inv.orderNumber && exchangeOrders.has(inv.orderNumber);
    const siblings = isExchange && inv.orderNumber
      ? (byOrder.get(inv.orderNumber) ?? [])
          .filter((s) => s.invoice_id !== inv.invoice_id)
          .map((s) => ({
            invoiceId: s.invoice_id,
            invoiceNumber: s.invoice_number,
            status: s.status as ZohoInvoiceStatus,
            balance: Number(s.balance),
            total: Number(s.total),
          }))
      : [];

    return {
      invoiceId: inv.invoice_id,
      invoiceNumber: inv.invoice_number,
      invoiceDate: inv.date,
      dueDate: inv.due_date,
      status: inv.status as ZohoInvoiceStatus,
      total: Number(inv.total),
      balance: Number(inv.balance),
      currency: inv.currency_code,
      customerName: inv.customer_name,
      orderNumber: inv.orderNumber,
      gateway,
      gatewaySource: source,
      settlementId: (settlement as any)?.id ?? null,
      hasBankCredit: !!(settlement as any)?.bank_line_id,
      residualCategory: classifyResidual(Number(inv.total), Number(inv.balance)),
      isExchange,
      exchangeSiblings: siblings,
    };
  });

  // 5. Sort: exchanges first, then date desc, then invoice # desc
  rows.sort((a, b) => {
    if (a.isExchange !== b.isExchange) return a.isExchange ? -1 : 1;
    const d = b.invoiceDate.localeCompare(a.invoiceDate);
    if (d !== 0) return d;
    return b.invoiceNumber.localeCompare(a.invoiceNumber);
  });

  // 6. Facets for the filter UI
  const gatewayCounts: Record<string, number> = {};
  for (const r of rows) gatewayCounts[r.gateway] = (gatewayCounts[r.gateway] ?? 0) + 1;

  return {
    invoices: rows,
    totalCount: rows.length,
    gatewayCounts,
    exchangeCount: rows.filter((r) => r.isExchange).length,
  };
}
