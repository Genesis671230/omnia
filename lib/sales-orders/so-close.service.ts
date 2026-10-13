// Daily sales-order close: packing sheet (what left the warehouse, with its
// boxes and bags) × Zoho sales orders × store orders.
//
//   board()     cheap: 1 Sheets call + the month's SO list per org. No detail reads.
//   plan()      dry run for chosen orders: SO detail, packaging items, stock, batches.
//   close()     live, capped: fix tax + add packaging → confirm → invoice (dated
//               per Settings, FIFO supplier batches) → sent. Each order is
//               re-planned on fresh stock right before it is written.
//   detail() / saveEdit()   the per-order editor: any field of the sales
//               order, then optionally the same confirm → invoice → sent.
//
// COD: the sale is booked in House of Omnia (the COD org). A COD order's
// sales order in any other org is closed at AED 0 (stock moves, zero invoice
// = paid), then its House of Omnia invoice is marked paid — one customer
// payment MAN/<order>/PAY into the COD clearing account, via the order
// adjustment "received" flow, so it is recorded on the order and never doubled.

import { supabase } from "@/lib/supabase";
import { chunkForInFilter } from "@/lib/repositories/in-filter-chunks";
import { listZohoConnections, withZohoOrg } from "@/lib/integrations/zoho-org";
import { depositAccountsFor, findOrderInvoices, runAdjustment } from "@/lib/orders/order-adjustment.service";
import { getSetting } from "@/lib/settings";
import { dubaiDayKey } from "@/lib/dubai-day";
import { readDispatchSheets, type SheetRow } from "@/lib/integrations/dispatch-sheet-read";
import { PACKING_SHEETS, readPackingMonth, sheetIdFromInput, type PackedOrder } from "./packing-sheet";
import { DEFAULT_RULES, invoiceDateFor, isCodOrder, lineWarehouse, planClose, type ClosePlan, type OrderFacts, type SoDetail, type SoRules, type StockMap } from "./so-plan";
import {
  batchesFor, comboComponents, confirmSalesOrder, findSalesOrdersByNumber, listInvoices, getSalesOrder, getSalesOrderCached, invoiceSalesOrder, invoicesForReference, itemStock, itemsBySku,
  getInvoice, listSalesOrders, listTaxes, listWarehouses, markInvoiceSent, pickBatches, regionTaxes, updateSalesOrder,
  type Batch, type BatchPick,
} from "./zoho-so";

export const CLOSE_LIMIT = 25;
/** SMSA Fulfillment KSA — orders sent from the order panel's KSA dispatch. */
export const KSA_WAREHOUSE_ID = "2330082000016063536";
/** Omniastores LLC — the UAE warehouse (a split order's UAE half). */
export const UAE_WAREHOUSE_ID = "2330082000000980131";

export type SoSettings = {
  rules: SoRules;
  invoiceDateSource: "order" | "dispatch" | "salesorder";
  markSent: boolean;
  warehouseId: string;
  maxPerRun: number;
  packingSheets: Record<string, string>;
};

export async function soSettings(): Promise<SoSettings> {
  const g = async <T,>(k: string, fallback: T): Promise<T> => {
    try { return (await getSetting<T>(k)) ?? fallback; } catch { return fallback; }
  };
  return {
    rules: {
      rates: await g("salesorders.fixed_rates", DEFAULT_RULES.rates),
      regions: {
        UAE: { tax_treatment: await g("salesorders.uae_tax_treatment", DEFAULT_RULES.regions.UAE.tax_treatment), tax_name: await g("salesorders.uae_tax_name", DEFAULT_RULES.regions.UAE.tax_name) },
        GCC: { tax_treatment: await g("salesorders.gcc_tax_treatment", DEFAULT_RULES.regions.GCC.tax_treatment), tax_name: await g("salesorders.gcc_tax_name", DEFAULT_RULES.regions.GCC.tax_name) },
        INTL: { tax_treatment: await g("salesorders.intl_tax_treatment", DEFAULT_RULES.regions.INTL.tax_treatment), tax_name: await g("salesorders.intl_tax_name", DEFAULT_RULES.regions.INTL.tax_name) },
      },
      tolerancePct: await g("salesorders.amount_tolerance_pct", DEFAULT_RULES.tolerancePct),
      aliases: Object.fromEntries(Object.entries(await g<Record<string, string>>("salesorders.sku_aliases", {})).map(([k, v]) => [k.toUpperCase(), v.toUpperCase()])),
    },
    invoiceDateSource: await g("salesorders.invoice_date_source", "order" as const),
    markSent: await g("salesorders.mark_sent", true),
    warehouseId: await g("salesorders.warehouse_id", "2330082000000980131"),
    maxPerRun: await g("salesorders.max_per_run", 10),
    packingSheets: { ...PACKING_SHEETS, ...(await g<Record<string, string>>("salesorders.packing_sheets", {})) },
  };
}

export type BoardRow = {
  orderNumber: string;
  day: number | null;
  packaging: PackedOrder["packaging"];
  duplicateDays: number[];
  so: { org: string; orgLabel: string; id: string; status: string; date: string; total: number; customer: string } | null;
  order: (OrderFacts & { uid: string; storeId: string | null; orderDay: string | null }) | null;
  /** COD orders: the sale lives in House of Omnia; this SO/invoice must be AED 0. */
  cod: { codOrg: string; codOrgLabel: string; fullValue: boolean; codInvoice: { number: string; total: number; status: string } | null } | null;
  /** Sent from the KSA warehouse (order panel) — packaging comes from that send, not the packing sheet. */
  ksa: { split: boolean; shipDate: string; issues: string[]; ksaSkus: string[] } | null;
  stage: "closed" | "to_close" | "not_dispatched" | "no_so" | "confirmed";
  /** What the dispatch sheet (Local + SMSA) says beyond a plain sale. */
  sheet: SheetSays | null;
  /** Cancel / return / refund / exchange already recorded on the order in the app. */
  adjustments: { kind: string; status: string; creditAed: number; creditNote: string; exchangeInvoice: string; markOnly: boolean }[];
};

/** cancelled = before dispatch; returned = full or partial (some items) back;
 *  exchanged = an Exchange shipment row; repair / pending = follow-up shipments. */
export type SheetSays = { kind: "cancelled" | "returned" | "partial" | "exchanged" | "repair" | "pending" | "note"; notes: string[]; refundedAed: number | null };

/** The sheet's words → one suggestion per order. Pure. */
export function sheetSays(rows: Pick<SheetRow, "kind" | "comments" | "saleType" | "cancelledRefundedAed">[]): SheetSays | null {
  const notes = [...new Set(rows.map((r) => r.comments.trim()).filter((c) => c && !/^(urgent( order)?|dispatch from ksa|gift|same invoice)\b/i.test(c) || /return|refund|cancel|exchange|pending|repair/i.test(c)))];
  const text = rows.map((r) => `${r.comments} ${r.saleType}`).join(" ");
  const refunded = rows.reduce((s, r) => s + (r.cancelledRefundedAed ?? 0), 0) || null;
  const kinds = new Set(rows.map((r) => r.kind));
  const kind: SheetSays["kind"] | null =
    // "Cancelled and Returned" left the warehouse and came back — a return, not a cancel before dispatch.
    (kinds.has("cancelled") && !/return/i.test(text)) || /cancel\w*\s*(before|bd\b)/i.test(text) ? "cancelled"
    : kinds.has("exchange") || /exchange/i.test(text) ? "exchanged"
    : kinds.has("partial_refund") || /\b\d+\s*items?\s*(returned|refunded)/i.test(text) ? "partial"
    : kinds.has("refunded") || /return|refund/i.test(text) ? "returned"
    : kinds.has("repair") || /repair/i.test(text) ? "repair"
    : kinds.has("pending") || /pending/i.test(text) ? "pending"
    : notes.length ? "note"
    : null;
  return kind ? { kind, notes, refundedAed: refunded } : null;
}

const norm = (s: string) => s.trim().replace(/^#/, "").toUpperCase();
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monthBounds = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const from = new Date(Date.UTC(y, m - 1, 1) - 7 * 86_400_000).toISOString().slice(0, 10);
  return { from, to: last };
};
const dayOf = (month: string, day: number | null) => (day == null ? null : `${month}-${String(day).padStart(2, "0")}`);

export async function orderFacts(numbers: string[]): Promise<Map<string, NonNullable<BoardRow["order"]>>> {
  const out = new Map<string, NonNullable<BoardRow["order"]>>();
  for (const chunk of chunkForInFilter(numbers)) {
    const { data, error } = await supabase.from("orders").select("uid,order_number,country,currency,gross_original,store_id,order_date,discount_aed,gateway").in("order_number", chunk);
    if (error) throw new Error(`orders read failed: ${error.message}`);
    for (const o of data ?? []) {
      out.set(norm(String(o.order_number)), {
        uid: String(o.uid), gateway: o.gateway ?? null,
        country: o.country ?? null, currency: o.currency ?? null, grossOriginal: o.gross_original == null ? null : Number(o.gross_original),
        storeId: o.store_id ?? null, orderDate: o.order_date ?? null, orderDay: dubaiDayKey(o.order_date), discountAed: o.discount_aed == null ? null : Number(o.discount_aed),
      });
    }
  }
  return out;
}

// The board (packing sheet + every org's SO list + HoO invoices, ~11 s) was
// re-read on every Check, editor open and Save just to find one SO id. The
// GET always reads fresh and refills this; plan/detail/save reuse it briefly.
// Safe because planOne re-reads the SO itself — a status that moved since is
// caught there (closed → skipped). Writes drop the month.
const BOARD_TTL = 3 * 60_000;
const boardCache = new Map<string, { at: number; v: Promise<Awaited<ReturnType<typeof readBoard>>> }>();
const boardKey = (month: string, sheetInput?: string) => `${month}|${sheetInput ?? ""}`;
export function forgetBoard(month: string) {
  for (const k of boardCache.keys()) if (k.startsWith(`${month}|`)) boardCache.delete(k);
}
export async function board(month: string, sheetInput?: string) {
  const v = readBoard(month, sheetInput);
  boardCache.set(boardKey(month, sheetInput), { at: Date.now(), v });
  v.catch(() => boardCache.delete(boardKey(month, sheetInput)));
  return v;
}
async function cachedBoard(month: string, sheetInput?: string) {
  const hit = boardCache.get(boardKey(month, sheetInput));
  return hit && Date.now() - hit.at < BOARD_TTL ? hit.v : board(month, sheetInput);
}

async function readBoard(month: string, sheetInput?: string) {
  const settings = await soSettings();
  const raw = sheetInput || settings.packingSheets[month] || process.env.PACKING_SHEET_ID;
  if (!raw) throw new Error(`No packing sheet set for ${month} — paste the sheet link or add it under Settings`);
  const id = sheetIdFromInput(raw);
  const { from, to } = monthBounds(month);
  const [sheet, conns, ksaSends, uaePacks, dispatch] = await Promise.all([
    readPackingMonth(id), listZohoConnections(), ksaSendsIn(month), uaePacksIn(month),
    // A month's returns/exchanges are logged into the next month's first weeks too.
    readDispatchSheets(`${month}-01`, addDays(to, 20)).catch((e) => ({ rows: [] as SheetRow[], errors: [(e as Error).message] })),
  ]);

  const sos = new Map<string, NonNullable<BoardRow["so"]>>();
  const orgErrors: string[] = [];
  for (const c of conns.filter((c) => c.status !== "disabled")) {
    try {
      const list = await withZohoOrg(c.id, () => listSalesOrders(from, to));
      for (const s of list) {
        const prev = sos.get(s.number);
        // A number in two orgs: prefer the one still open for closing.
        if (!prev || prev.status !== "draft") sos.set(s.number, { org: c.id, orgLabel: c.label, id: s.salesorder_id, status: s.status, date: s.date, total: s.total, customer: s.customer });
      }
    } catch (e) {
      orgErrors.push(`${c.label}: ${(e as Error).message}`);
    }
  }

  // House of Omnia books each COD sale as an invoice to "<order no> <name>"
  // (INV-005246 "OS4313 Temitope Adisa") — no sales order. Index them by order no.
  const codConn = conns.find((c) => c.status !== "disabled" && c.defaultForProviders.some((p) => p.toUpperCase() === "COD")) ?? null;
  const codInvoices = new Map<string, { number: string; total: number; status: string }>();
  if (codConn) {
    try {
      const list = await withZohoOrg(codConn.id, () => listInvoices(from, addDays(to, 31)));
      for (const i of list) {
        if (i.status === "void") continue;
        const key = norm((i.reference || i.customer).split(/\s+/)[0] ?? "");
        if (key && !codInvoices.has(key)) codInvoices.set(key, { number: i.number, total: i.total, status: i.status });
      }
    } catch (e) {
      orgErrors.push(`${codConn.label} invoices: ${(e as Error).message}`);
    }
  }

  const packed = new Map<string, PackedOrder & { duplicateDays: number[] }>();
  for (const p of sheet.orders) {
    const prev = packed.get(p.orderNumber);
    if (prev) { prev.duplicateDays.push(p.day); continue; }
    packed.set(p.orderNumber, { ...p, duplicateDays: [] });
  }
  // Orders sent from the order panel: the boxes picked there are the truth —
  // KSA boxes from SMSA Fulfillment KSA; a split order's UAE boxes from the
  // UAE warehouse. Only when no UAE boxes were picked does the packing sheet
  // (where the team logs the UAE half by hand) supply them.
  for (const k of ksaSends) {
    const day = Number(k.ship_date.slice(8));
    const prev = packed.get(k.order_number);
    const ksaBoxes = k.packaging.map((p) => ({ sku: p.sku, qty: p.qty, description: "KSA", warehouse_id: KSA_WAREHOUSE_ID }));
    const uaeBoxes = !k.split ? []
      : k.uae_packaging.length ? k.uae_packaging.map((p) => ({ sku: p.sku, qty: p.qty, description: "UAE", warehouse_id: UAE_WAREHOUSE_ID }))
      : (prev?.packaging ?? []).map((p) => ({ ...p, description: p.description || "UAE", warehouse_id: UAE_WAREHOUSE_ID }));
    packed.set(k.order_number, { orderNumber: k.order_number, day: prev?.day ?? day, packaging: [...ksaBoxes, ...uaeBoxes], sheetRow: prev?.sheetRow ?? 0, duplicateDays: prev?.duplicateDays ?? [] });
  }
  // Packed from Omniastores LLC on the order page: the boxes scanned there win over the sheet's.
  const ksaNumbers = new Set(ksaSends.map((k) => k.order_number));
  for (const u of uaePacks) {
    if (ksaNumbers.has(u.order_number)) continue;
    const prev = packed.get(u.order_number);
    packed.set(u.order_number, {
      orderNumber: u.order_number, day: prev?.day ?? Number(u.pack_date.slice(8)),
      packaging: u.packaging.map((p) => ({ sku: p.sku, qty: p.qty, description: "UAE", warehouse_id: UAE_WAREHOUSE_ID })),
      sheetRow: prev?.sheetRow ?? 0, duplicateDays: prev?.duplicateDays ?? [],
    });
  }
  const ksaBy = new Map(ksaSends.map((k) => [k.order_number, k]));
  const numbers = new Set<string>([...packed.keys()]);
  for (const [n, s] of sos) if (s.status === "draft" || s.status === "open") numbers.add(n);
  const facts_ = await orderFacts([...numbers]);
  const sheetBy = new Map<string, SheetRow[]>();
  for (const r of dispatch.rows) {
    const n = norm(r.order || "");
    if (n && numbers.has(n)) sheetBy.set(n, [...(sheetBy.get(n) ?? []), r]);
  }
  const adjBy = await adjustmentsFor([...numbers]);
  for (const e of dispatch.errors) orgErrors.push(`Dispatch sheet: ${e}`);

  const rows: BoardRow[] = [...numbers].map((n) => {
    const p = packed.get(n) ?? null;
    const so = sos.get(n) ?? null;
    const stage: BoardRow["stage"] = !so ? "no_so"
      : so.status === "draft" ? (p ? "to_close" : "not_dispatched")
      : so.status === "open" ? "confirmed"
      : "closed";
    const k = ksaBy.get(n);
    const facts = facts_.get(n) ?? null;
    const cod = codConn && isCodOrder(facts) ? {
      codOrg: codConn.id, codOrgLabel: codConn.label, codInvoice: codInvoices.get(n) ?? null,
      // Closed (or confirmed) at full value outside the COD org — must be AED 0.
      // Draft/confirmed ones still go through the close, which zeroes them.
      fullValue: Boolean(so && so.org !== codConn.id && so.total > 0 && so.status !== "draft" && so.status !== "open" && so.status !== "partially_invoiced"),
    } : null;
    return {
      cod, sheet: sheetSays(sheetBy.get(n) ?? []), adjustments: adjBy.get(n) ?? [],
      orderNumber: n, day: p?.day ?? null, packaging: p?.packaging ?? [], duplicateDays: p?.duplicateDays ?? [], so, order: facts, stage,
      ksa: k ? { split: k.split, shipDate: k.ship_date, ksaSkus: k.ksa_skus, issues: stage === "closed" ? [] : k.zoho_issues.filter((i) => i.blocking).map((i) => i.message) } : null,
    };
  });
  rows.sort((a, b) => (a.day ?? 99) - (b.day ?? 99) || a.orderNumber.localeCompare(b.orderNumber));
  return { month, sheetId: id, days: sheet.days, rows, orgErrors, maxPerRun: settings.maxPerRun, rates: settings.rules.rates };
}

async function adjustmentsFor(numbers: string[]): Promise<Map<string, BoardRow["adjustments"]>> {
  const out = new Map<string, BoardRow["adjustments"]>();
  for (const chunk of chunkForInFilter(numbers)) {
    const { data, error } = await supabase.from("order_adjustments").select("order_number, kind, status, credit_aed, zoho_creditnote_number, zoho_exchange_invoice_number, mark_only").in("order_number", chunk).neq("status", "draft");
    if (error) { console.error("[sales-orders] adjustments:", error.message); return out; }
    for (const a of data ?? []) {
      const n = norm(String(a.order_number));
      out.set(n, [...(out.get(n) ?? []), { kind: a.kind, status: a.status, creditAed: Number(a.credit_aed ?? 0), creditNote: a.zoho_creditnote_number ?? "", exchangeInvoice: a.zoho_exchange_invoice_number ?? "", markOnly: Boolean(a.mark_only) }]);
    }
  }
  return out;
}

/** Orders packed from Omniastores LLC on the order page this month (order_uae_pack). */
async function uaePacksIn(month: string): Promise<{ order_number: string; pack_date: string; packaging: { sku: string; qty: number }[] }[]> {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const { data, error } = await supabase.from("order_uae_pack").select("order_number, pack_date, packaging").gte("pack_date", `${month}-01`).lte("pack_date", last);
  if (error) { console.error("[sales-orders] UAE packs:", error.message); return []; }
  return (data ?? []).map((r) => ({ order_number: norm(String(r.order_number)), pack_date: String(r.pack_date), packaging: (r.packaging ?? []) as { sku: string; qty: number }[] }));
}

type KsaSend = { order_number: string; ship_date: string; split: boolean; ksa_skus: string[]; packaging: { sku: string; qty: number }[]; uae_packaging: { sku: string; qty: number }[]; zoho_issues: { message: string; blocking: boolean }[] };
/** Orders sent from the KSA warehouse this month (order panel → order_ksa_dispatch). */
async function ksaSendsIn(month: string): Promise<KsaSend[]> {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const { data, error } = await supabase.from("order_ksa_dispatch").select("order_number, ship_date, split, ksa_skus, packaging, uae_packaging, zoho_issues").gte("ship_date", `${month}-01`).lte("ship_date", last);
  if (error) { console.error("[sales-orders] KSA sends:", error.message); return []; }
  return (data ?? []).map((r) => ({
    ...r, order_number: norm(String(r.order_number)), ksa_skus: (r.ksa_skus ?? []) as string[],
    uae_packaging: (r.uae_packaging ?? []) as KsaSend["uae_packaging"], zoho_issues: (r.zoho_issues ?? []) as KsaSend["zoho_issues"],
  })) as KsaSend[];
}

/** The org COD is booked in (Settings → Zoho organisations → default for COD). */
async function codOrgId(): Promise<string | null> {
  const conns = await listZohoConnections().catch(() => []);
  return conns.find((c) => c.status !== "disabled" && c.defaultForProviders.some((p) => p.toUpperCase() === "COD"))?.id ?? null;
}
const codZeroFor = (t: Pick<Target, "org" | "order">, codOrg: string | null) => isCodOrder(t.order) && codOrg != null && t.org !== codOrg;

export type Target = {
  orderNumber: string; org: string; soId: string;
  packaging: PackedOrder["packaging"] | null;
  order: BoardRow["order"];
  dispatchDay: string | null;
  /** Ship stock lines + packaging from this warehouse (KSA dispatch). */
  warehouseId?: string;
  /** Split order: product SKU → warehouse for each half. */
  lineWarehouses?: Record<string, string>;
  sheet?: SheetSays | null;
} & AmountOptions;
/** Per order, chosen on the board when closing. */
export type AmountOptions = { rateOverride?: number; matchOrderTotal?: boolean };

/** Batch-tracked lines → the FIFO pick, or an issue when the bills don't cover it. */
async function batchCheck(so: SoDetail, fresh: boolean, added: { item_id: string; sku: string; warehouse_id: string; qty: number }[] = [], warehouseOverride?: string, lineWarehouses?: Record<string, string>) {
  const picks: Record<string, BatchPick[]> = {};
  const issues: ClosePlan["issues"] = [];
  // Packaging the close will add: picked FIFO at invoice time, but checked now.
  for (const a of added) {
    if (!pickBatches(await batchesFor(a.item_id, a.warehouse_id, { fresh, need: a.qty }), a.qty)) {
      issues.push({ code: "no_batch", message: `${a.sku}: no supplier batch with stock found on its bills`, blocking: true });
    }
  }
  for (const l of so.line_items) {
    const wh = lineWarehouse(l, lineWarehouses, warehouseOverride);
    if (!l.track_batch_number || !wh) continue;
    const pick = pickBatches(await batchesFor(l.item_id, wh, { fresh, need: l.quantity }), l.quantity);
    if (pick) picks[l.line_item_id] = pick;
    else issues.push({ code: "no_batch", message: `${l.sku || l.name}: no supplier batch with stock found on its bills — choose one in the editor`, blocking: true });
  }
  return { picks, issues };
}

async function planOne(t: Target, s: SoSettings, stock: StockMap, fresh: boolean, codOrg: string | null): Promise<{ so: SoDetail; plan: ClosePlan; batches: Record<string, BatchPick[]> }> {
  // A dry run may reuse a read from the last 45 s (scanner: one check per box); a live close never does.
  const so = fresh ? await getSalesOrder(t.soId) : await getSalesOrderCached(t.soId);
  const skus = (t.packaging ?? []).map((p) => s.rules.aliases[p.sku.toUpperCase()] ?? p.sku);
  const items = await itemsBySku(skus);
  // Rate-0 kits on the draft (ledsp9): their components replace them.
  const combos = await comboComponents(so.line_items.filter((l) => l.rate === 0 && l.item_type !== "inventory" && l.product_type === "goods").map((l) => l.item_id));
  for (const c of combos.values()) for (const it of c.components) if (!items.has(it.sku.toUpperCase())) items.set(it.sku.toUpperCase(), it);
  const taxes = await regionTaxes(s.rules);
  const args = { so, order: t.order, packaging: t.packaging, items, taxes, defaultWarehouse: s.warehouseId, rules: s.rules, codZero: codZeroFor(t, codOrg), warehouseOverride: t.warehouseId, lineWarehouses: t.lineWarehouses, rateOverride: t.rateOverride, matchOrderTotal: t.matchOrderTotal, combos };
  // First pass to learn which items it consumes, then read their stock.
  const dry = planClose({ ...args, stock: new Map() });
  const unread = dry.consume.map((c) => c.item_id).filter((id) => !stock.has(id));
  for (const [k, v] of await itemStock(unread, fresh)) stock.set(k, v);
  const p = planClose({ ...args, stock });
  if (t.sheet?.kind === "cancelled" && p.state !== "closed") {
    p.issues.push({ code: "sheet_cancelled", message: `Dispatch sheet says cancelled before dispatch (${t.sheet.notes.join(" · ") || "no comment"}) — don't invoice; void the sales order in Zoho, or fix the sheet`, blocking: true });
    p.state = "blocked";
  }
  let batches: Record<string, BatchPick[]> = {};
  if (p.state === "ready") {
    const onSo = new Set(so.line_items.map((l) => l.item_id));
    const batchTracked = new Set([...items.values()].filter((i) => i.trackBatch).map((i) => i.item_id));
    const added = p.consume.filter((c) => batchTracked.has(c.item_id) && !onSo.has(c.item_id));
    const b = await batchCheck(so, fresh, added, t.warehouseId, t.lineWarehouses);
    batches = b.picks;
    if (b.issues.length) { p.issues.push(...b.issues); p.state = "blocked"; }
  }
  return { so, plan: p, batches };
}

const take = (stock: StockMap, plan: ClosePlan) => {
  for (const c of plan.consume) {
    const m = stock.get(c.item_id);
    if (m?.has(c.warehouse_id)) m.set(c.warehouse_id, m.get(c.warehouse_id)! - c.qty);
  }
};

function groupByOrg(targets: Target[]) {
  const g = new Map<string, Target[]>();
  for (const t of targets) g.set(t.org, [...(g.get(t.org) ?? []), t]);
  return g;
}

export type PlanOut = { orderNumber: string; plan?: ClosePlan; batches?: Record<string, BatchPick[]>; invoiceDate?: string; error?: string };

/** Dry run. Stock is drawn down across the selection in order, so the
 *  20th set box is flagged when only 19 are left. */
export async function plan(targets: Target[]): Promise<PlanOut[]> {
  const s = await soSettings();
  const codOrg = await codOrgId();
  const out: PlanOut[] = [];
  for (const [org, list] of groupByOrg(targets)) {
    await withZohoOrg(org, async () => {
      const stock: StockMap = new Map();
      for (const t of list) {
        try {
          const { so, plan: p, batches } = await planOne(t, s, stock, false, codOrg);
          if (p.state === "ready") take(stock, p);
          out.push({ orderNumber: t.orderNumber, plan: p, batches, invoiceDate: invoiceDateFor(s.invoiceDateSource, so, t.order?.orderDay ?? null, t.dispatchDay) });
        } catch (e) {
          out.push({ orderNumber: t.orderNumber, error: (e as Error).message });
        }
      }
    });
  }
  return out;
}

export type CloseResult = {
  orderNumber: string;
  outcome: "closed" | "skipped" | "failed";
  steps: string[];
  issues?: ClosePlan["issues"];
  invoice?: string;
  error?: string;
};

/** Confirm (if draft) → invoice on `date` with batches → sent (per Settings)
 *  → read back. Shared by the bulk close and the editor; runs in the org scope. */
async function finishClose(soId: string, wasDraft: boolean, date: string, s: SoSettings, steps: string[], batches?: Record<string, BatchPick[]>, codZero = false): Promise<Pick<CloseResult, "outcome" | "invoice" | "error">> {
  if (wasDraft) { await confirmSalesOrder(soId); steps.push("confirmed"); }
  const fresh = await getSalesOrder(soId);
  const inv = await invoiceSalesOrder(fresh, { date, batches, onRetry: (m) => steps.push(m) });
  steps.push(`invoice ${inv.invoice_number} dated ${date}, AED ${inv.total}`);
  // A zero COD invoice is paid once it is sent — always send it.
  if (s.markSent || codZero) { await markInvoiceSent(inv.invoice_id); steps.push(codZero ? `invoice marked sent → ${await invoiceStatus(inv.invoice_id)}` : "invoice marked sent"); }
  const after = await getSalesOrder(soId);
  steps.push(`sales order now ${after.status}`);
  return after.status === "invoiced"
    ? { outcome: "closed", invoice: inv.invoice_number }
    : { outcome: "failed", invoice: inv.invoice_number, error: `sales order is ${after.status}, expected invoiced` };
}

/** COD: mark the order's House of Omnia invoice paid — one payment
 *  MAN/<order>/PAY into the COD clearing account (order adjustment "received",
 *  idempotent by reference). Never throws: the sales order is already closed. */
async function markCodPaidInCodOrg(t: Pick<Target, "orderNumber" | "order">, codOrg: string, date: string, steps: string[]): Promise<void> {
  const tag = "House of Omnia";
  try {
    if (!t.order?.uid) { steps.push(`${tag}: store order not found — mark its invoice paid by hand`); return; }
    const { candidates, errors } = await findOrderInvoices({ order_number: t.orderNumber, gateway: "COD" });
    const inv = candidates.filter((c) => c.connectionId === codOrg && c.total > 0);
    if (!inv.length) { steps.push(`${tag}: no invoice for ${t.orderNumber}${errors.length ? ` (${errors.join("; ")})` : ""} — not marked paid`); return; }
    if (inv.length > 1) { steps.push(`${tag}: ${inv.length} invoices (${inv.map((i) => i.number).join(", ")}) — pick one by hand`); return; }
    const hit = inv[0];
    if (hit.balance <= 0.01) { steps.push(`${tag}: ${hit.number} already ${hit.status}`); return; }
    const { accounts, suggestedId } = await depositAccountsFor(codOrg, "COD");
    if (!suggestedId) { steps.push(`${tag}: no COD clearing account found — ${hit.number} not marked paid`); return; }
    const r = await runAdjustment({
      uid: t.order.uid, kind: "received", date, connectionId: codOrg, invoiceId: hit.invoiceId,
      receivedAed: hit.balance, receivedVia: "COD", depositAccountId: suggestedId,
      depositAccountName: accounts.find((a) => a.account_id === suggestedId)?.account_name ?? "",
      note: "COD — closed from sales-order close", dryRun: false, actor: "sales-orders",
    });
    steps.push(`${tag}: ${r.ok ? r.message : `not marked paid — ${r.message}`}`);
  } catch (e) {
    steps.push(`${tag}: not marked paid — ${(e as Error).message}`);
  }
}

async function invoiceStatus(id: string): Promise<string> {
  try { return String((await getInvoice(id)).status ?? "?"); } catch { return "?"; }
}

/** Live. Writes only orders whose fresh plan is ready; stops at `limit`. */
export async function close(targets: Target[], limit = CLOSE_LIMIT): Promise<CloseResult[]> {
  const s = await soSettings();
  const codOrg = await codOrgId();
  const afterOrg: (() => Promise<void>)[] = [];
  const out: CloseResult[] = [];
  let written = 0;
  for (const [org, list] of groupByOrg(targets)) {
    await withZohoOrg(org, async () => {
      const stock: StockMap = new Map();
      for (const t of list) {
        if (written >= limit) { out.push({ orderNumber: t.orderNumber, outcome: "skipped", steps: [`limit of ${limit} reached`] }); continue; }
        const steps: string[] = [];
        try {
          const { so, plan: p } = await planOne(t, s, stock, true, codOrg);
          if (p.state === "closed") { out.push({ orderNumber: t.orderNumber, outcome: "skipped", steps: [`already ${so.status}`] }); continue; }
          if (p.state !== "ready") { out.push({ orderNumber: t.orderNumber, outcome: "skipped", steps: ["not ready"], issues: p.issues }); continue; }
          const existing = await invoicesForReference(so.salesorder_number);
          if (existing.length) { out.push({ orderNumber: t.orderNumber, outcome: "skipped", steps: [`invoice ${existing[0].invoice_number} already carries this reference — link by hand`] }); continue; }

          written += 1;
          const updated = await updateSalesOrder(so.salesorder_id, p.update!);
          steps.push(`updated: ${p.changes.length} change(s), total AED ${updated.total}`);
          if (Math.abs(updated.total - p.expectedTotal) > 0.05) steps.push(`note: Zoho total ${updated.total} vs planned ${p.expectedTotal}`);
          take(stock, p);
          // Batches are picked FIFO at invoice time (not pinned from the plan),
          // so a batch Zoho says isn't in this location is swapped for the next.
          const date = invoiceDateFor(s.invoiceDateSource, so, t.order?.orderDay ?? null, t.dispatchDay);
          const r = await finishClose(so.salesorder_id, so.status === "draft", date, s, steps, undefined, p.cod);
          const res: CloseResult = { orderNumber: t.orderNumber, steps, ...r };
          out.push(res);
          if (p.cod && r.outcome === "closed" && codOrg) afterOrg.push(() => markCodPaidInCodOrg(t, codOrg, date, res.steps));
        } catch (e) {
          out.push({ orderNumber: t.orderNumber, outcome: "failed", steps, error: (e as Error).message });
        }
      }
    });
  }
  // Outside the sales-order org's scope: each runs in House of Omnia's.
  for (const f of afterOrg) await f();
  return out;
}

/** One order's sales order without the month board: looked up by number in
 *  every active org (a draft/confirmed one wins over a closed one). */
// Which org/SO an order number resolves to — searched in every org (one Zoho
// call each), then remembered: the scanner asks again on every box.
const soLookup = new Map<string, { at: number; v: { org: string; id: string; status: string } }>();
const SO_LOOKUP_TTL = 10 * 60_000;

export async function targetForOrder(orderNumber: string, extra: Pick<Target, "packaging" | "dispatchDay" | "warehouseId">): Promise<Target | null> {
  const n = norm(orderNumber);
  const known = soLookup.get(n);
  let hit: { org: string; id: string; status: string } | null = known && Date.now() - known.at < SO_LOOKUP_TTL ? known.v : null;
  if (!hit) {
    const orgs = (await listZohoConnections()).filter((c) => c.status !== "disabled");
    const lists = await Promise.all(orgs.map((c) => withZohoOrg(c.id, () => findSalesOrdersByNumber(n)).then((l) => l.map((so) => ({ org: c.id, so })))));
    for (const { org, so } of lists.flat()) if (!hit || ((hit.status !== "draft" && hit.status !== "open") && (so.status === "draft" || so.status === "open"))) hit = { org, id: so.salesorder_id, status: so.status };
    if (hit) soLookup.set(n, { at: Date.now(), v: hit });
  }
  if (!hit) return null;
  const facts = await orderFacts([n]);
  return { orderNumber: n, org: hit.org, soId: hit.id, order: facts.get(n) ?? null, ...extra };
}

/** Only sane values pass: a positive rate, a boolean match. */
export function cleanOptions(o: AmountOptions | undefined): AmountOptions {
  if (!o) return {};
  const rate = Number(o.rateOverride);
  return { ...(rate > 0 && rate < 1000 ? { rateOverride: rate } : {}), ...(o.matchOrderTotal ? { matchOrderTotal: true } : {}) };
}

/** Resolve order numbers against a fresh board, so the client never picks the org or SO id. */
export async function targetsFor(month: string, orderNumbers: string[], sheet?: string, options: Record<string, AmountOptions> = {}): Promise<{ targets: Target[]; missing: string[] }> {
  const b = await cachedBoard(month, sheet);
  const byNo = new Map(b.rows.map((r) => [r.orderNumber, r]));
  const targets: Target[] = [];
  const missing: string[] = [];
  for (const raw of orderNumbers) {
    const r = byNo.get(norm(raw));
    if (!r?.so) { missing.push(raw); continue; }
    targets.push({
      sheet: r.sheet, orderNumber: r.orderNumber, org: r.so.org, soId: r.so.id, packaging: r.day == null ? null : r.packaging, order: r.order, dispatchDay: dayOf(month, r.day),
      // Sent from KSA: whole order from the KSA warehouse; a split one — its KSA
      // items from KSA, the rest from the UAE warehouse.
      ...(r.ksa && !r.ksa.split ? { warehouseId: KSA_WAREHOUSE_ID } : {}),
      ...(r.ksa?.split ? { warehouseId: UAE_WAREHOUSE_ID, lineWarehouses: Object.fromEntries(r.ksa.ksaSkus.map((s) => [s.toUpperCase(), KSA_WAREHOUSE_ID])) } : {}),
      ...cleanOptions(options[raw] ?? options[r.orderNumber]),
    });
  }
  return { targets, missing };
}

// ── editor ─────────────────────────────────────────────────────────────────

export type EditorData = {
  orderNumber: string;
  org: string;
  so: SoDetail;
  plan: ClosePlan;
  suggestedBatches: Record<string, BatchPick[]>;
  /** line_item_id → every supplier batch with stock, oldest first */
  batchOptions: Record<string, Batch[]>;
  taxes: { tax_id: string; tax_name: string; tax_percentage: number }[];
  warehouses: { warehouse_id: string; warehouse_name: string; is_primary: boolean }[];
  invoiceDate: string;
  settings: Pick<SoSettings, "invoiceDateSource" | "markSent">;
  order: BoardRow["order"];
  packaging: PackedOrder["packaging"];
  day: number | null;
};

export async function detail(month: string, orderNumber: string, sheet?: string): Promise<EditorData> {
  const { targets, missing } = await targetsFor(month, [orderNumber], sheet);
  if (missing.length || !targets[0]) throw new Error(`${orderNumber}: no Zoho sales order found`);
  const t = targets[0];
  const s = await soSettings();
  return withZohoOrg(t.org, async () => {
    const { so, plan: p, batches } = await planOne(t, s, new Map(), true, await codOrgId());
    const batchOptions: Record<string, Batch[]> = {};
    for (const l of so.line_items) {
      const wh = lineWarehouse(l, t.lineWarehouses, t.warehouseId);
      if (l.track_batch_number && wh) batchOptions[l.line_item_id] = await batchesFor(l.item_id, wh, { fresh: true });
    }
    return {
      orderNumber: t.orderNumber, org: t.org, so, plan: p, suggestedBatches: batches, batchOptions,
      taxes: await listTaxes(), warehouses: await listWarehouses(so.line_items.find((l) => l.item_type === "inventory")?.item_id).catch(() => []),
      invoiceDate: invoiceDateFor(s.invoiceDateSource, so, t.order?.orderDay ?? null, t.dispatchDay),
      settings: { invoiceDateSource: s.invoiceDateSource, markSent: s.markSent },
      order: t.order, packaging: t.packaging ?? [], day: t.dispatchDay ? Number(t.dispatchDay.slice(8)) : null,
    };
  });
}

export type SoEdit = {
  date?: string;
  reference_number?: string;
  notes?: string;
  tax_treatment: string;
  place_of_supply?: string;
  line_items: {
    line_item_id?: string; item_id: string; name?: string; description?: string;
    quantity: number; rate: number; discount?: string | number; tax_id?: string; warehouse_id?: string; unit?: string;
  }[];
};

/** Save the editor to Zoho; with `close`, carry on to confirm → invoice → sent.
 *  The person editing decides — no plan gate, but an existing invoice for the
 *  order still stops the close. */
export async function saveEdit(month: string, orderNumber: string, edit: SoEdit, opts: { close: boolean; batches?: Record<string, BatchPick[]>; invoiceDate?: string; sheet?: string }) {
  if (!edit.line_items?.length) throw new Error("A sales order needs at least one line");
  for (const l of edit.line_items) {
    if (!l.item_id) throw new Error("Every line needs an item");
    if (!(l.quantity > 0)) throw new Error(`Quantity must be above 0 (${l.name ?? l.item_id})`);
    if (!(l.rate >= 0)) throw new Error(`Rate can't be negative (${l.name ?? l.item_id})`);
  }
  const { targets, missing } = await targetsFor(month, [orderNumber], opts.sheet);
  if (missing.length || !targets[0]) throw new Error(`${orderNumber}: no Zoho sales order found`);
  const t = targets[0];
  const s = await soSettings();
  const codOrg = await codOrgId();
  if (opts.invoiceDate && !/^\d{4}-\d{2}-\d{2}$/.test(opts.invoiceDate)) throw new Error("Invoice date must be YYYY-MM-DD");
  const res = await withZohoOrg(t.org, async () => {
    const steps: string[] = [];
    const so = await getSalesOrder(t.soId);
    if (so.status !== "draft" && so.status !== "open") throw new Error(`${orderNumber} is ${so.status} — only draft or confirmed sales orders can be edited here`);
    const body: Record<string, unknown> = {
      customer_id: so.customer_id,
      ...(edit.date ? { date: edit.date } : {}),
      ...(edit.reference_number != null ? { reference_number: edit.reference_number } : {}),
      ...(edit.notes != null ? { notes: edit.notes } : {}),
      tax_treatment: edit.tax_treatment,
      ...(edit.place_of_supply ? { place_of_supply: edit.place_of_supply } : {}),
      is_inclusive_tax: false,
      line_items: edit.line_items.map((l) => ({
        ...(l.line_item_id ? { line_item_id: l.line_item_id } : {}),
        item_id: l.item_id, ...(l.name ? { name: l.name } : {}), description: l.description ?? "",
        quantity: l.quantity, rate: l.rate, discount: l.discount ?? 0, ...(l.unit ? { unit: l.unit } : {}),
        ...(l.tax_id ? { tax_id: l.tax_id, tax_exemption_id: "" } : {}),
        ...(l.warehouse_id ? { warehouse_id: l.warehouse_id } : {}),
      })),
    };
    const updated = await updateSalesOrder(so.salesorder_id, body);
    steps.push(`saved: ${updated.line_items.length} line(s), total AED ${updated.total}`);
    if (!opts.close) return { orderNumber: t.orderNumber, outcome: "saved" as const, steps, total: updated.total, codDate: null };

    const existing = await invoicesForReference(so.salesorder_number);
    if (existing.length) return { orderNumber: t.orderNumber, outcome: "skipped" as const, steps: [...steps, `invoice ${existing[0].invoice_number} already carries this reference — not invoiced again`], total: updated.total, codDate: null };
    const date = opts.invoiceDate || invoiceDateFor(s.invoiceDateSource, updated, t.order?.orderDay ?? null, t.dispatchDay);
    const codZero = codZeroFor(t, codOrg) && updated.total === 0;
    const r = await finishClose(so.salesorder_id, so.status === "draft", date, s, steps, opts.batches, codZero);
    return { orderNumber: t.orderNumber, steps, total: updated.total, ...r, codDate: r.outcome === "closed" && codZero ? date : null };
  });
  forgetBoard(month);
  if (res.codDate && codOrg) await markCodPaidInCodOrg(t, codOrg, res.codDate, res.steps);
  const { codDate: _unused, ...rest } = res;
  return rest;
}
