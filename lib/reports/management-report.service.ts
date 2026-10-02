// Gathers the evidence for one month's management report. DB + stored Zoho
// indexes + the dispatch sheets (cached) — no Zoho calls.

import { supabase } from "@/lib/supabase";
import { addDubaiDays, dubaiDayBoundsUtc, dubaiToday } from "@/lib/dubai-day";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { ZohoInvoiceIndexRepository } from "@/lib/repositories/zoho-invoice-index";
import { buildSalesLedger } from "@/lib/orders/sales-ledger.service";
import { readDispatchSheets } from "@/lib/integrations/dispatch-sheet-read";
import { buildManagementReport, type MrGatewayRefund, type MrLedger, type MrStoreOrder } from "./management-report";

const norm = (s: string) => s.trim().replace(/^#/, "").toUpperCase();

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { from: `${month}-01`, to: `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}` };
}

/** When a payout's money moved: its own date, else the bank credit it was
 *  matched to, else when the file was uploaded. Many Stripe / COD payouts
 *  carry no payout_date. */
async function payoutDates(ids: string[]): Promise<Map<string, { date: string | null; gateway: string }>> {
  const payouts = await inChunks(ids, 200, async (c) => {
    const { data, error } = await supabase.from("payouts").select("id, gateway, payout_date, bank_line_id, uploaded_at").in("id", c);
    if (error) throw new Error(`payouts: ${error.message}`);
    return data ?? [];
  });
  const bankIds = [...new Set(payouts.map((p) => p.bank_line_id).filter(Boolean))] as string[];
  const bank = await inChunks(bankIds, 200, async (c) => {
    const { data, error } = await supabase.from("bank_lines").select("id, statement_date").in("id", c);
    if (error) throw new Error(`bank lines: ${error.message}`);
    return data ?? [];
  });
  const bankDate = new Map(bank.map((b) => [b.id as string, String(b.statement_date ?? "").slice(0, 10)]));
  return new Map(payouts.map((p) => [p.id as string, {
    date: (p.payout_date ? String(p.payout_date).slice(0, 10) : null) ?? (p.bank_line_id ? bankDate.get(p.bank_line_id) ?? null : null) ?? (p.uploaded_at ? String(p.uploaded_at).slice(0, 10) : null),
    gateway: String(p.gateway ?? ""),
  }]));
}

async function inChunks<T>(keys: string[], size: number, fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < keys.length; i += size) out.push(...(await fn(keys.slice(i, i + size))));
  return out;
}

/** Refund cash per order: gateway payout refund lines, plus refunds this app
 *  booked against a payout (Tabby/Tamara deduct them inside the payout). */
async function gatewayRefundsFor(orderNumbers: string[]): Promise<MrGatewayRefund[]> {
  const lines = await inChunks(orderNumbers, 300, async (c) => {
    const { data, error } = await supabase.from("payout_transactions").select("payout_id, order_ref, gross_aed").eq("is_refund", true).in("order_ref", c);
    if (error) throw new Error(`payout refund lines: ${error.message}`);
    return data ?? [];
  });
  const posted = await inChunks(orderNumbers, 300, async (c) => {
    const { data, error } = await supabase.from("refund_postings").select("payout_id, order_number, amount_aed, posted_at").in("order_number", c);
    if (error) throw new Error(`refund postings: ${error.message}`);
    return data ?? [];
  });
  const payoutIds = [...new Set([...lines.map((l) => l.payout_id), ...posted.map((p) => p.payout_id)].filter(Boolean))] as string[];
  const pInfo = await payoutDates(payoutIds);
  const out: MrGatewayRefund[] = lines.map((l) => ({
    order: l.order_ref, amountAed: Math.abs(Number(l.gross_aed) || 0), date: pInfo.get(l.payout_id)?.date ?? null,
    payoutId: l.payout_id, gateway: pInfo.get(l.payout_id)?.gateway ?? "",
  }));
  // A booked refund on a payout already carrying that order's refund line is the same money.
  const seen = new Set(lines.map((l) => `${norm(l.order_ref)}|${l.payout_id}`));
  for (const p of posted) {
    if (!p.payout_id || seen.has(`${norm(p.order_number)}|${p.payout_id}`)) continue;
    out.push({ order: p.order_number, amountAed: Math.abs(Number(p.amount_aed) || 0), date: pInfo.get(p.payout_id)?.date ?? (String(p.posted_at ?? "").slice(0, 10) || null), payoutId: p.payout_id, gateway: pInfo.get(p.payout_id)?.gateway ?? "" });
  }
  return out;
}

/** Every gateway refund whose money went out in the month, whatever month the
 *  order was. Refund lines are few (~hundreds), so all are read and dated. */
async function refundsPaidIn(month: string): Promise<MrGatewayRefund[]> {
  const { data: lines, error } = await supabase.from("payout_transactions").select("payout_id, order_ref, gross_aed").eq("is_refund", true);
  if (error) throw new Error(`refund lines: ${error.message}`);
  const info = await payoutDates([...new Set((lines ?? []).map((l) => l.payout_id as string))]);
  return (lines ?? [])
    .map((l) => ({ order: l.order_ref as string, amountAed: Math.abs(Number(l.gross_aed) || 0), date: info.get(l.payout_id)?.date ?? null, payoutId: l.payout_id as string, gateway: info.get(l.payout_id)?.gateway ?? "" }))
    .filter((r) => r.date?.startsWith(month));
}

export async function buildMonthManagementReport(month: string) {
  const { from, to } = monthBounds(month);
  const today = dubaiToday();
  const [orders, ledger, paidIn] = await Promise.all([
    OrdersRepository.listInWindow({ from: dubaiDayBoundsUtc(addDubaiDays(from, -1)).fromUtc, to: dubaiDayBoundsUtc(addDubaiDays(to, 1)).toUtc }),
    buildSalesLedger(month),
    refundsPaidIn(month),
  ]);
  const numbers = orders.map((o) => o.order_number);
  const sheetTo = [addDubaiDays(to, 60), today].sort()[0];
  const [gatewayRefunds, creditNotes, invoiceCounts, sheet] = await Promise.all([
    gatewayRefundsFor(numbers),
    ZohoInvoiceIndexRepository.creditNotesFor(numbers),
    ZohoInvoiceIndexRepository.invoiceCounts(numbers),
    readDispatchSheets(from, sheetTo > from ? sheetTo : to),
  ]);
  const ledgerMap = new Map<string, MrLedger>();
  for (const d of ledger.days) for (const o of d.orderList) {
    ledgerMap.set(norm(o.orderNumber), { status: o.status, feeAed: o.feeAed, receivedAed: o.receivedAed, payoutId: o.payout?.id ?? null, bankDate: o.bank?.date ?? null });
  }
  // Order month for refunds paid this month (orders outside this month too).
  const refOrders = [...new Set(paidIn.map((r) => r.order))];
  const refMonths = await inChunks(refOrders, 300, async (c) => {
    const { data } = await supabase.from("orders").select("order_number, order_date").in("order_number", c);
    return data ?? [];
  });
  const orderMonthOf = new Map(refMonths.map((o) => [norm(o.order_number), String(o.order_date).slice(0, 7)]));

  const report = buildManagementReport({
    month, today, orders: orders as unknown as MrStoreOrder[], ledger: ledgerMap, gatewayRefunds, creditNotes, invoiceCounts,
    sheet: sheet.rows, refundsPaidInMonth: paidIn, orderMonthOf,
  });
  return { ...report, sources: { sheets: sheet.sources, sheetErrors: sheet.errors, zohoIndexAsOf: await ZohoInvoiceIndexRepository.lastUpdated() } };
}
