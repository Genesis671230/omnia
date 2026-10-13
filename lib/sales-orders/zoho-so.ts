// Zoho Books calls for closing sales orders. Callers wrap these in
// withZohoOrg(...) — every path here runs against the current org scope.

import { getAccessToken } from "@/lib/integrations/zoho";
import { zohoBooksBase, zohoOrgId } from "@/lib/integrations/zoho-context";
import { zohoThrottledFetch } from "@/lib/integrations/zoho-throttle";
import type { Combo, PackItem, Region, RegionTax, SoDetail, SoRules, StockMap } from "./so-plan";

type Json = { code?: number; message?: string; [k: string]: unknown };

export class ZohoSoError extends Error {
  constructor(message: string, public code?: number) { super(message); }
}

async function books(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<Json> {
  const token = await getAccessToken();
  const url = new URL(`${zohoBooksBase()}${path}`);
  url.searchParams.set("organization_id", zohoOrgId());
  const res = await zohoThrottledFetch(url.toString(), {
    method,
    headers: { Authorization: `Zoho-oauthtoken ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const text = await res.text();
  let json: Json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ZohoSoError(`Zoho ${method} ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    throw new ZohoSoError(`Zoho ${method} ${path.split("?")[0]} (code ${json.code}): ${json.message ?? res.status}`, json.code);
  }
  return json;
}

export type SoListRow = { salesorder_id: string; number: string; status: string; date: string; total: number; customer: string };

export async function listSalesOrders(fromDay: string, toDay: string): Promise<SoListRow[]> {
  const out: SoListRow[] = [];
  for (let page = 1; page <= 25; page++) {
    const j = await books("GET", `/salesorders?date_start=${fromDay}&date_end=${toDay}&per_page=200&page=${page}`);
    for (const s of (j.salesorders ?? []) as Record<string, unknown>[]) {
      out.push({
        salesorder_id: String(s.salesorder_id), number: String(s.salesorder_number ?? "").toUpperCase(), status: String(s.status ?? ""),
        date: String(s.date ?? ""), total: Number(s.total ?? 0), customer: String(s.customer_name ?? ""),
      });
    }
    if (!(j.page_context as { has_more_page?: boolean } | undefined)?.has_more_page) break;
  }
  return out;
}

/** Exact sales-order number match (Zoho's filter is a prefix search). */
export async function findSalesOrdersByNumber(number: string): Promise<SoListRow[]> {
  const j = await books("GET", `/salesorders?salesorder_number=${encodeURIComponent(number)}&per_page=50`);
  return ((j.salesorders ?? []) as Record<string, unknown>[])
    .filter((s) => String(s.salesorder_number ?? "").toUpperCase() === number.toUpperCase())
    .map((s) => ({
      salesorder_id: String(s.salesorder_id), number: String(s.salesorder_number ?? "").toUpperCase(), status: String(s.status ?? ""),
      date: String(s.date ?? ""), total: Number(s.total ?? 0), customer: String(s.customer_name ?? ""),
    }));
}

export type InvoiceBrief = { invoice_id: string; number: string; customer: string; reference: string; total: number; status: string; date: string };
/** Invoices dated in a range (paged, up to 5,000). */
export async function listInvoices(fromDay: string, toDay: string): Promise<InvoiceBrief[]> {
  const out: InvoiceBrief[] = [];
  for (let page = 1; page <= 25; page++) {
    const j = await books("GET", `/invoices?date_start=${fromDay}&date_end=${toDay}&per_page=200&page=${page}`);
    for (const i of (j.invoices ?? []) as Record<string, unknown>[]) {
      out.push({ invoice_id: String(i.invoice_id), number: String(i.invoice_number ?? ""), customer: String(i.customer_name ?? ""), reference: String(i.reference_number ?? ""), total: Number(i.total ?? 0), status: String(i.status ?? ""), date: String(i.date ?? "") });
    }
    if (!(j.page_context as { has_more_page?: boolean } | undefined)?.has_more_page) break;
  }
  return out;
}

export async function getSalesOrder(id: string): Promise<SoDetail> {
  const so = (await books("GET", `/salesorders/${id}`)).salesorder as SoDetail;
  soCache.set(`${zohoOrgId()}|${id}`, { at: Date.now(), v: so });
  return so;
}

// Dry runs only (scanner checks re-plan the same SO on every box): a recent
// read is reused. Every write below drops it, and live closes read fresh.
const soCache = new Map<string, { at: number; v: SoDetail }>();
const SO_TTL = 45_000;
export async function getSalesOrderCached(id: string): Promise<SoDetail> {
  const hit = soCache.get(`${zohoOrgId()}|${id}`);
  if (hit && Date.now() - hit.at < SO_TTL) return hit.v;
  return getSalesOrder(id);
}
const forgetSo = (id: string) => soCache.delete(`${zohoOrgId()}|${id}`);

const cacheKey = (k: string) => `${zohoOrgId()}|${k}`;
const itemCache = new Map<string, { at: number; v: PackItem | null }>();
const stockCache = new Map<string, { at: number; v: Map<string, number> }>();
const taxCache = new Map<string, ZohoTax[]>();
const ITEM_TTL = 60 * 60_000;
const STOCK_TTL = 3 * 60_000;

/** Packaging SKU → active Zoho item with exactly that SKU (inventory items first). */
export async function itemsBySku(skus: string[]): Promise<Map<string, PackItem>> {
  const out = new Map<string, PackItem>();
  for (const raw of [...new Set(skus.map((s) => s.toUpperCase()))]) {
    const hit = itemCache.get(cacheKey(raw));
    if (hit && Date.now() - hit.at < ITEM_TTL) {
      if (hit.v) out.set(raw, hit.v);
      continue;
    }
    const j = await books("GET", `/items?search_text=${encodeURIComponent(raw)}&per_page=50`);
    const rows = ((j.items ?? []) as Record<string, unknown>[])
      .filter((i) => String(i.sku ?? "").toUpperCase() === raw && i.status === "active")
      .sort((a, b) => Number(b.item_type === "inventory") - Number(a.item_type === "inventory"));
    const v = rows[0] ? { item_id: String(rows[0].item_id), sku: String(rows[0].sku), name: String(rows[0].name), stockTracked: rows[0].item_type === "inventory", trackBatch: Boolean(rows[0].track_batch_number) } : null;
    itemCache.set(cacheKey(raw), { at: Date.now(), v });
    if (v) out.set(raw, v);
  }
  return out;
}

const comboCache = new Map<string, { at: number; v: Combo | null }>();
/** Combo (kit) items → their inventory components per unit, from the item's
 *  mapped_items (ledsp9 = 1× SET101 + 1× PAP999). Null when not a combo. */
export async function comboComponents(itemIds: string[]): Promise<Map<string, Combo>> {
  const out = new Map<string, Combo>();
  for (const id of [...new Set(itemIds)]) {
    const hit = comboCache.get(cacheKey(id));
    let v: Combo | null;
    if (hit && Date.now() - hit.at < ITEM_TTL) v = hit.v;
    else {
      const it = (await books("GET", `/items/${id}`)).item as { sku?: string; is_combo_product?: boolean; mapped_items?: { item_id: string; sku?: string; name?: string; item_type?: string; track_batch_number?: boolean; mapped_quantity?: number; quantity?: number }[] };
      const comps = (it?.mapped_items ?? []).filter((m) => m.item_id).map((m) => ({
        item_id: String(m.item_id), sku: String(m.sku ?? ""), name: String(m.name ?? ""), stockTracked: m.item_type === "inventory",
        trackBatch: Boolean(m.track_batch_number), qty: Number(m.mapped_quantity ?? m.quantity ?? 1) || 1,
      }));
      v = it?.is_combo_product && comps.length && comps.every((c) => c.sku) ? { sku: String(it.sku ?? ""), components: comps } : null;
      comboCache.set(cacheKey(id), { at: Date.now(), v });
    }
    if (v) out.set(id, v);
  }
  return out;
}

/** Available-for-sale stock per warehouse, one item read each (cached 3 min).
 *  Callers get COPIES: plan() draws stock down across a selection (take()),
 *  and handing out the cached Map let every dry run lower the cache — a
 *  second check of the same order saw KSA 1 → 0. */
export async function itemStock(itemIds: string[], fresh = false): Promise<StockMap> {
  const out: StockMap = new Map();
  for (const id of [...new Set(itemIds)]) {
    const hit = stockCache.get(cacheKey(id));
    if (!fresh && hit && Date.now() - hit.at < STOCK_TTL) { out.set(id, new Map(hit.v)); continue; }
    const it = (await books("GET", `/items/${id}`)).item as { warehouses?: { warehouse_id: string; warehouse_available_for_sale_stock?: number; warehouse_available_stock?: number }[] };
    const m = new Map<string, number>();
    for (const w of it?.warehouses ?? []) m.set(String(w.warehouse_id), Number(w.warehouse_available_for_sale_stock ?? w.warehouse_available_stock ?? 0));
    stockCache.set(cacheKey(id), { at: Date.now(), v: m });
    out.set(id, new Map(m));
  }
  return out;
}

export type ZohoTax = { tax_id: string; tax_name: string; tax_percentage: number };

export async function listTaxes(): Promise<ZohoTax[]> {
  const hit = taxCache.get(zohoOrgId());
  if (hit) return hit;
  const j = await books("GET", "/settings/taxes");
  const v = ((j.taxes ?? []) as ZohoTax[]).map((t) => ({ tax_id: String(t.tax_id), tax_name: t.tax_name, tax_percentage: Number(t.tax_percentage) }));
  taxCache.set(zohoOrgId(), v);
  return v;
}

/** The Zoho tax each region uses, by the names set in Settings. */
export async function regionTaxes(rules: SoRules): Promise<RegionTax> {
  const taxes = await listTaxes();
  const out = {} as RegionTax;
  for (const r of ["UAE", "GCC", "INTL"] as Region[]) {
    const name = rules.regions[r].tax_name;
    const t = taxes.find((x) => x.tax_name.trim().toLowerCase() === name.trim().toLowerCase());
    if (!t) throw new ZohoSoError(`Zoho tax "${name}" (${r}) not found in this organisation — fix it under Sales orders → Settings`);
    out[r] = { tax_id: t.tax_id, pct: t.tax_percentage };
  }
  return out;
}

export type Warehouse = { warehouse_id: string; warehouse_name: string; is_primary: boolean };
const whCache = new Map<string, Warehouse[]>();
/** /settings/warehouses is refused for this token, so the list comes from
 *  an inventory item's own warehouse breakdown (every warehouse is listed there). */
export async function listWarehouses(sampleItemId?: string): Promise<Warehouse[]> {
  const hit = whCache.get(zohoOrgId());
  if (hit?.length) return hit;
  let raw: Record<string, unknown>[] = [];
  try {
    raw = ((await books("GET", "/settings/warehouses")).warehouses ?? []) as Record<string, unknown>[];
  } catch {
    if (sampleItemId) raw = (((await books("GET", `/items/${sampleItemId}`)).item as { warehouses?: Record<string, unknown>[] })?.warehouses ?? []);
  }
  const v = raw
    .filter((w) => w.status !== "inactive")
    .map((w) => ({ warehouse_id: String(w.warehouse_id), warehouse_name: String(w.warehouse_name ?? ""), is_primary: Boolean(w.is_primary) }));
  if (v.length) whCache.set(zohoOrgId(), v);
  return v;
}

export type ItemHit = { item_id: string; sku: string; name: string; rate: number; item_type: string; product_type: string; track_batch_number: boolean };
export async function searchItems(q: string): Promise<ItemHit[]> {
  const j = await books("GET", `/items?search_text=${encodeURIComponent(q)}&per_page=25`);
  return ((j.items ?? []) as Record<string, unknown>[])
    .filter((i) => i.status === "active")
    .map((i) => ({ item_id: String(i.item_id), sku: String(i.sku ?? ""), name: String(i.name ?? ""), rate: Number(i.rate ?? 0), item_type: String(i.item_type ?? ""), product_type: String(i.product_type ?? ""), track_batch_number: Boolean(i.track_batch_number) }));
}

export type Batch = { batch_id: string; batch_number: string; balance: number; date: string; bill: string; vendor: string;
  /** Received into another warehouse — here only if it was transferred (Zoho answers 2309 when not). */
  elsewhere?: boolean };

// A bill shows the warehouse a batch was RECEIVED into and its balance across
// ALL warehouses — LEDBOX2 came into the main warehouse, but its last 4 boxes
// were moved on, so Zoho answers 2309 "Batch LEDBOX2 is not available in
// selected location". Per-warehouse batch stock is code 57 for this token, so
// Zoho's own refusal is the signal: the batch is excluded for that item +
// warehouse (6 h) and the next-oldest is tried.
const EXCLUDE_TTL = 6 * 60 * 60_000;
const excluded = new Map<string, number>();
const exKey = (itemId: string, wh: string, batchNumber: string) => `${zohoOrgId()}|${itemId}|${wh}|${batchNumber.toUpperCase()}`;
export function excludeBatch(itemId: string, wh: string, batchNumber: string) { excluded.set(exKey(itemId, wh, batchNumber), Date.now()); }
export function isExcluded(itemId: string, wh: string, batchNumber: string) {
  const at = excluded.get(exKey(itemId, wh, batchNumber));
  return at != null && Date.now() - at < EXCLUDE_TTL;
}
/** "Batch LEDBOX2 is not available in selected location for the item LED Set Box - LEDBOX2" */
export function rejectedBatch(message: string): string | null {
  const m = message.match(/\bBatch\s+(\S+)\s+(?:is not available|is not|does not|has only|exceeds|is insufficient)/i);
  return m ? m[1].trim() : null;
}
const batchCache = new Map<string, { at: number; v: Batch[] }>();
/** Last walk per item|warehouse and how much it covered — a second box of the
 *  same item (need 1 → 2) reuses it instead of re-reading every bill. */
const batchCover = new Map<string, { at: number; v: Batch[]; covered: number; complete: boolean }>();
/** Warehouses stocked only by transfer (no bills land there): SMSA Fulfillment KSA. */
const TRANSFER_STOCKED = new Set(["2330082000016063536"]);
const MAX_BILL_READS = 15;

/** Supplier batches with stock for a batch-tracked item in one warehouse,
 *  FIFO: oldest bill first. The batch endpoints answer code 57 for this
 *  token, but bill lines carry each batch's live balance_quantity — so bills
 *  are walked oldest-first and the walk stops once `need` is covered (exact
 *  FIFO for that quantity). A batch keeps its batch_id when it is transferred
 *  (the SA4051 KSA invoice used BT48's bill batch id), so batches received
 *  into another warehouse follow as fallbacks for TRANSFER_STOCKED warehouses —
 *  that is how stock moved to SMSA Fulfillment KSA is found. Batches from adjustments are not on a bill. */
export async function batchesFor(itemId: string, warehouseId: string, opts: { fresh?: boolean; need?: number } = {}): Promise<Batch[]> {
  const key = cacheKey(`${itemId}|${warehouseId}|${opts.need ?? "all"}`);
  const hit = batchCache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < STOCK_TTL) return hit.v;
  const coverKey = cacheKey(`${itemId}|${warehouseId}`);
  const cov = batchCover.get(coverKey);
  if (!opts.fresh && cov && Date.now() - cov.at < STOCK_TTL && (cov.complete || (opts.need != null && cov.covered >= opts.need))) return cov.v;
  const bills = ((await books("GET", `/bills?item_id=${itemId}&per_page=200&sort_column=date&sort_order=A`)).bills ?? []) as { bill_id: string; bill_number?: string; date: string; vendor_name?: string; status?: string }[];
  bills.sort((a, b) => a.date.localeCompare(b.date) || a.bill_id.localeCompare(b.bill_id));
  const out: Batch[] = [];
  const elsewhere: Batch[] = [];
  let covered = 0;
  let reads = 0;
  let complete = true;
  for (const b of bills.filter((x) => x.status !== "void")) {
    if (opts.need != null && covered >= opts.need) { complete = false; break; }
    if (++reads > MAX_BILL_READS) { complete = false; break; }
    const bill = (await books("GET", `/bills/${b.bill_id}`)).bill as { line_items?: { item_id: string; batches?: { batch_id: string; batch_number: string; balance_quantity?: number; warehouse_id?: string; status?: string }[] }[] };
    for (const l of bill?.line_items ?? []) {
      if (l.item_id !== itemId) continue;
      for (const bt of l.batches ?? []) {
        if (bt.status && bt.status !== "active") continue;
        const bal = Number(bt.balance_quantity ?? 0);
        if (bal <= 0 || isExcluded(itemId, warehouseId, bt.batch_number) || out.some((x) => x.batch_id === bt.batch_id) || elsewhere.some((x) => x.batch_id === bt.batch_id)) continue;
        const row: Batch = { batch_id: bt.batch_id, batch_number: bt.batch_number, balance: bal, date: b.date, bill: b.bill_number ?? b.bill_id, vendor: b.vendor_name ?? "" };
        if (bt.warehouse_id && bt.warehouse_id !== warehouseId) { elsewhere.push({ ...row, elsewhere: true }); continue; }
        out.push(row);
        covered += bal;
      }
    }
  }
  // Bills walked past `need` only for same-warehouse batches; transferred ones
  // can't be counted toward it (their balance spans every warehouse).
  // FIFO across every candidate: oldest bill first, whichever warehouse it was received into.
  const fifo = (a: Batch, b: Batch) => a.date.localeCompare(b.date) || a.bill.localeCompare(b.bill) || a.batch_number.localeCompare(b.batch_number);
  const all = TRANSFER_STOCKED.has(warehouseId) ? [...out, ...elsewhere].sort(fifo) : out;
  batchCache.set(key, { at: Date.now(), v: all });
  batchCover.set(coverKey, { at: Date.now(), v: all, covered, complete });
  return all;
}

export type BatchPick = { batch_id: string; batch_number: string; out_quantity: number };

/** FIFO pick of `qty` across batches (already oldest first); null when short. */
export function pickBatches(batches: Batch[], qty: number): BatchPick[] | null {
  const out: BatchPick[] = [];
  let left = qty;
  for (const b of batches) {
    if (left <= 0) break;
    const take = Math.min(left, b.balance);
    if (take > 0) { out.push({ batch_id: b.batch_id, batch_number: b.batch_number, out_quantity: take }); left -= take; }
  }
  return left > 0 ? null : out;
}

export async function invoicesForReference(ref: string): Promise<{ invoice_id: string; invoice_number: string; status: string }[]> {
  const j = await books("GET", `/invoices?reference_number=${encodeURIComponent(ref)}`);
  return ((j.invoices ?? []) as { invoice_id: string; invoice_number: string; status: string }[]).filter((i) => i.status !== "void");
}

export const getInvoice = async (id: string) => (await books("GET", `/invoices/${id}`)).invoice as { invoice_id: string; status: string; total: number; balance: number };
export const updateSalesOrder = async (id: string, body: Record<string, unknown>) => { forgetSo(id); return (await books("PUT", `/salesorders/${id}`, body)).salesorder as SoDetail; };
export const confirmSalesOrder = (id: string) => { forgetSo(id); return books("POST", `/salesorders/${id}/status/open`); };
export const markInvoiceSent = (id: string) => books("POST", `/invoices/${id}/status/sent`);

/** Invoice the whole sales order on `date`, every line linked back to it
 *  (salesorder_item_id) so Zoho marks the sales order invoiced → closed.
 *  Batch-tracked lines take the override for that line when given, else FIFO
 *  over supplier batches; when Zoho refuses a FIFO batch for the location it
 *  is excluded and the next-oldest is tried. A refused POST creates nothing,
 *  so the retry is safe. */
export async function invoiceSalesOrder(so: SoDetail, opts: { date: string; batches?: Record<string, BatchPick[]>; onRetry?: (msg: string) => void }): Promise<{ invoice_id: string; invoice_number: string; total: number }> {
  forgetSo(so.salesorder_id);
  const picks = new Map<string, BatchPick[]>();
  const auto = new Set<string>();
  const pickLine = async (l: SoDetail["line_items"][number]) => {
    const pick = pickBatches(await batchesFor(l.item_id, l.warehouse_id!, { fresh: true, need: l.quantity }), l.quantity);
    if (!pick) throw new ZohoSoError(`No supplier batch with stock in this warehouse found for ${l.sku || l.name} — choose the batch in the editor or in Zoho`);
    picks.set(l.line_item_id, pick);
  };
  for (const l of so.line_items) {
    if (!l.track_batch_number || !l.warehouse_id) continue;
    const override = opts.batches?.[l.line_item_id];
    if (override?.length) {
      const sum = override.reduce((s, b) => s + b.out_quantity, 0);
      if (sum !== l.quantity) throw new ZohoSoError(`${l.sku || l.name}: chosen batches total ${sum}, line quantity is ${l.quantity}`);
      picks.set(l.line_item_id, override);
      continue;
    }
    auto.add(l.line_item_id);
    await pickLine(l);
  }
  const bodyOf = () => ({
    customer_id: so.customer_id,
    date: opts.date,
    due_date: opts.date,
    reference_number: so.salesorder_number,
    tax_treatment: so.tax_treatment,
    ...(so.place_of_supply ? { place_of_supply: so.place_of_supply } : {}),
    is_inclusive_tax: false,
    line_items: so.line_items.map((l) => ({
      item_id: l.item_id, salesorder_item_id: l.line_item_id, name: l.name, description: l.description ?? "",
      quantity: l.quantity, rate: l.rate, discount: l.discount ?? 0, tax_id: l.tax_id, unit: l.unit,
      ...(l.warehouse_id ? { warehouse_id: l.warehouse_id } : {}),
      ...(picks.has(l.line_item_id) ? { batches: picks.get(l.line_item_id)!.map((b) => ({ batch_id: b.batch_id, batch_number: b.batch_number, out_quantity: b.out_quantity })) } : {}),
    })),
  });
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      return (await books("POST", "/invoices", bodyOf())).invoice as { invoice_id: string; invoice_number: string; total: number };
    } catch (e) {
      const bad = e instanceof ZohoSoError ? rejectedBatch(e.message) : null;
      if (!bad) throw e;
      // Zoho's word beats any pick, chosen or FIFO: the batch isn't in this
      // location, so drop it and take the next oldest that is.
      const hit = so.line_items.filter((l) => l.warehouse_id && picks.get(l.line_item_id)?.some((b) => b.batch_number.toUpperCase() === bad.toUpperCase()));
      if (!hit.length) throw new ZohoSoError(`${(e as Error).message} — pick another batch for that line in the editor`, (e as ZohoSoError).code);
      for (const l of hit) {
        excludeBatch(l.item_id, l.warehouse_id!, bad);
        opts.onRetry?.(`batch ${bad} not in this location for ${l.sku || l.name} — using the next oldest${auto.has(l.line_item_id) ? "" : " instead of the chosen one"}`);
        auto.add(l.line_item_id);
        await pickLine(l);
      }
    }
  }
  throw new ZohoSoError("Gave up after 30 batch retries — pick the batches in the editor");
}
