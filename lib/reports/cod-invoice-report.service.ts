// Fetch side of the COD invoice report: live Zoho invoices + credit notes from
// every organisation (COD lives in House of Omnia), the month's COD orders,
// the sales ledger (courier voucher + bank) and app adjustments. Zoho is read
// once per month per 10 minutes; the invoice index is refreshed on the way.

import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { OrderAdjustmentsRepository } from "@/lib/repositories/order-adjustments.repository";
import { ZohoInvoiceIndexRepository } from "@/lib/repositories/zoho-invoice-index";
import { fetchSalesDocs } from "@/lib/integrations/zoho-sales-docs";
import { listZohoConnections } from "@/lib/integrations/zoho-org";
import { orderNumberOf } from "@/lib/finance/zoho-sales-verify";
import { buildSalesLedger } from "@/lib/orders/sales-ledger.service";
import { addDubaiDays, dubaiDayBoundsUtc, dubaiToday } from "@/lib/dubai-day";
import { buildCodInvoiceReport, type CodAdjustmentIn, type CodDocIn, type CodLedgerIn, type CodReport } from "./cod-invoice-report";

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; docs: CodDocIn[]; orgErrors: string[] }>();
const norm = (s: string) => s.trim().replace(/^#/, "").toUpperCase();

function bounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from, to };
}

async function zohoDocs(month: string, fresh: boolean) {
  const hit = cache.get(month);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit;
  const { from, to } = bounds(month);
  const today = dubaiToday();
  // COD is invoiced on delivery, days after the order — look past month end.
  const toDay = [addDubaiDays(to, 25), today].sort()[0];
  const { docs, orgs } = await fetchSalesDocs(addDubaiDays(from, -7), toDay, ["invoice", "creditnote"]);
  await ZohoInvoiceIndexRepository.upsertFromDocs(docs).catch(() => undefined);
  const out = {
    at: Date.now(),
    docs: docs.map((d) => ({ kind: d.kind as "invoice" | "creditnote", org: d.org, id: d.id, number: d.number, order: orderNumberOf(d), date: d.date, status: d.status, total: d.total, balance: d.balance ?? 0 })),
    orgErrors: orgs.filter((o) => o.error).map((o) => `${o.label}: ${o.error}`),
  };
  cache.set(month, out);
  return out;
}

export async function buildMonthCodReport(month: string, opts: { fresh?: boolean } = {}): Promise<CodReport & { orgErrors: string[]; zohoReadAt: string }> {
  const { from, to } = bounds(month);
  const [orders, ledger, zoho, conns] = await Promise.all([
    OrdersRepository.listInWindow({ from: dubaiDayBoundsUtc(addDubaiDays(from, -1)).fromUtc, to: dubaiDayBoundsUtc(addDubaiDays(to, 1)).toUtc }),
    buildSalesLedger(month),
    zohoDocs(month, !!opts.fresh),
    listZohoConnections(),
  ]);
  const cod = orders.filter((o) => (o.gateway || "").trim().toUpperCase() === "COD");
  const homeOrg = conns.find((c) => c.defaultForProviders.includes("COD"))?.label ?? "House of Omnia";
  const ledgerMap = new Map<string, CodLedgerIn>();
  for (const d of ledger.days) for (const o of d.orderList) {
    ledgerMap.set(norm(o.orderNumber), { status: o.status, payoutId: o.payout?.id ?? null, payoutSource: o.payout?.source ?? null, bankDate: o.bank?.date ?? null, receivedAed: o.receivedAed });
  }
  const adj = await OrderAdjustmentsRepository.postedFor(cod.map((o) => o.order_number));
  const adjustments = new Map<string, CodAdjustmentIn>([...adj].map(([k, a]) => [norm(k), {
    kind: a.kind, creditAed: a.credit_aed, creditNote: a.zoho_creditnote_number, receivedAed: a.received_aed, receivedVia: a.received_via, date: a.adjustment_date,
  }]));
  const wanted = new Set(cod.map((o) => norm(o.order_number)));
  const report = buildCodInvoiceReport({
    month, today: dubaiToday(), homeOrg,
    orders: cod.map((o) => ({ uid: o.uid, order_number: o.order_number, store_id: o.store_id, order_date: o.order_date, customer_name: o.customer_name,
      gross_aed: o.gross_aed, financial_status: o.financial_status, ops_status: o.ops_status, city: o.city, country: o.country })),
    docs: zoho.docs.filter((d) => wanted.has(norm(d.order))),
    ledger: ledgerMap, adjustments,
  });
  return { ...report, orgErrors: zoho.orgErrors, zohoReadAt: new Date(zoho.at).toISOString() };
}
