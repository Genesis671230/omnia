// Send an order (or part of a split order) from the KSA warehouse — the one
// click that replaces the KSA team's manual steps:
//
//   1. reserve: the KSA items from SMSA Fulfillment KSA (the rest of a split
//      order from Omniastores LLC)
//   2. sheet:   one row per SKU — products + packaging — into today's block of
//      "KSA Orders // <Mon YYYY>" in the KSA dispatch sheet (tab and block
//      created when missing; an order already in the tab is never written twice)
//   3. zoho:    the sales order closed from the KSA warehouse with the packaging
//      as rate-0 lines → invoice → sent, via the /sales-orders close (same
//      tax, amount, batch and COD rules). Split orders stop before this step —
//      their UAE half is packed later, so they close from /sales-orders.
//
// Every step is idempotent, so sending again retries whatever failed.

import { supabase } from "@/lib/supabase";
import { getSetting } from "@/lib/settings";
import { dubaiToday } from "@/lib/dubai-day";
import { addTab, deleteRows, listTabNames, readAllValues, writeRows } from "@/lib/integrations/google-sheets";
import { InventoryReservationsRepository } from "@/lib/repositories/inventory-reservations.repository";
import { OrderEventsRepository } from "@/lib/repositories/order-events.repository";
import { effectiveStock, refreshWarehouseStock } from "@/lib/inventory/live-warehouse-stock";
import { withZohoOrg } from "@/lib/integrations/zoho-org";
import { getSalesOrder } from "@/lib/sales-orders/zoho-so";
import { ownCommitted } from "@/lib/sales-orders/so-plan";
import { cleanOptions, close, plan, targetForOrder, type AmountOptions, type CloseResult } from "@/lib/sales-orders/so-close.service";
import { KSA_PACKAGING, PACKAGING_SKUS, learnPackaging, suggestPackaging, sumPack, type PackHistory, type PackLine } from "./packaging";
import { KSA_HEADERS, buildKsaRows, findMonthTab, inTab, newMonthTabTitle, placeRows, shipDateLabel, type KsaOrder } from "./sheet-rows";

export const KSA_WAREHOUSE_ID = "2330082000016063536"; // SMSA Fulfillment KSA
export const UAE_WAREHOUSE_ID = "2330082000000980131"; // Omniastores LLC
const DEFAULT_SHEET_ID = "1PxmMVrMCl406kMw5jGdDc_HauYQLZu2tpmTY3XyN3ls";

export async function sheetId(): Promise<string> {
  try { return (await getSetting<string>("ksa.dispatch_sheet_id")) || DEFAULT_SHEET_ID; } catch { return DEFAULT_SHEET_ID; }
}

type OrderRow = KsaOrder & { uid: string; fulfillment_stage: string | null; line_items: { sku?: string; qty?: number; title?: string }[] };

async function loadOrder(uid: string): Promise<OrderRow> {
  const { data, error } = await supabase.from("orders")
    .select("uid, order_number, customer_name, customer_phone, city, country, shipping_address1, fulfillment_stage, line_items")
    .eq("uid", uid).maybeSingle();
  if (error) throw new Error(`order read failed: ${error.message}`);
  if (!data) throw new Error("order not found");
  return data as OrderRow;
}

const productLines = (o: OrderRow) => (o.line_items ?? [])
  .map((l) => ({ sku: (l.sku ?? "").trim().toUpperCase(), qty: Number(l.qty ?? 1), title: l.title ?? "" }))
  .filter((l) => l.sku && l.qty > 0);

// ── packaging history from the sheet (current + 2 previous months) ─────────

let historyCache: { at: number; id: string; v: PackHistory } | null = null;
export async function packHistory(id: string): Promise<PackHistory> {
  if (historyCache && historyCache.id === id && Date.now() - historyCache.at < 30 * 60_000) return historyCache.v;
  const titles = await listTabNames(id);
  const today = dubaiToday();
  const months = [0, 1, 2].map((k) => {
    const [y, m] = today.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 - k, 1));
    return d.toISOString().slice(0, 10);
  });
  const rows: { ref: string; sku: string; qty: number }[] = [];
  for (const day of months) {
    const tab = findMonthTab(titles, day);
    if (!tab) continue;
    for (const r of await readAllValues(tab, id)) rows.push({ ref: String(r[0] ?? "").trim(), sku: String(r[19] ?? "").trim(), qty: Number(r[20] ?? 1) || 1 });
  }
  const v = learnPackaging(rows);
  historyCache = { at: Date.now(), id, v };
  return v;
}

// ── preview ────────────────────────────────────────────────────────────────

export type KsaPreview = {
  orderNumber: string;
  shipDate: string;
  sheetTab: string;
  inSheet: boolean;
  lines: { sku: string; qty: number; title: string; ksaStock: number | null; uaeStock: number | null; suggested: boolean }[];
  packaging: { sku: string; label: string; primary: boolean; ksaStock: number | null; uaeStock: number | null }[];
  suggestion: PackLine[];
  /** Boxes per product line — the panel sums them per warehouse as items move between KSA and UAE. */
  perLine: { sku: string; pack: PackLine[]; basis: string }[];
  basis: { sku: string; basis: string }[];
  headers: readonly string[];
  record: Record<string, unknown> | null;
  warnings: string[];
  /** The Zoho sales order's status — "invoiced" means its stock already left. */
  soStatus: string | null;
};

/** The order's Zoho SO: its status and what it commits (item|warehouse → qty). */
async function soCommitment(orderNumber: string): Promise<{ status: string | null; committed: Map<string, number> }> {
  try {
    const t = await targetForOrder(orderNumber, { packaging: null, dispatchDay: null });
    if (!t) return { status: null, committed: new Map() };
    const so = await withZohoOrg(t.org, () => getSalesOrder(t.soId));
    return { status: so.status, committed: ownCommitted(so) };
  } catch {
    return { status: null, committed: new Map() };
  }
}

export async function preview(uid: string): Promise<KsaPreview> {
  const id = await sheetId();
  const order = await loadOrder(uid);
  const lines = productLines(order);
  const warnings: string[] = [];

  let itemIds = new Map<string, string>();
  try { itemIds = await refreshWarehouseStock([...lines.map((l) => l.sku), ...PACKAGING_SKUS]); }
  catch (e) { warnings.push(`Live stock refresh failed — showing stored stock: ${(e as Error).message}`); }
  if (itemIds.size === 0) {
    const { data } = await supabase.from("zoho_items").select("item_id, sku").in("sku", [...lines.map((l) => l.sku), ...PACKAGING_SKUS]);
    for (const i of data ?? []) itemIds.set(String(i.sku).toUpperCase(), String(i.item_id));
  }
  const ids = [...new Set(itemIds.values())];
  const [ksa, uae, so] = await Promise.all([effectiveStock(ids, KSA_WAREHOUSE_ID, uid), effectiveStock(ids, UAE_WAREHOUSE_ID, uid), soCommitment(order.order_number)]);
  // A confirmed SO's own lines are committed in Zoho — they are this order's, so they count as available to it.
  for (const [k, q] of so.committed) {
    const [item, wh] = k.split("|");
    const m = wh === KSA_WAREHOUSE_ID ? ksa : wh === UAE_WAREHOUSE_ID ? uae : null;
    if (m) m.set(item, (m.get(item) ?? 0) + q);
  }
  const stockOf = (m: Map<string, number>, sku: string) => { const i = itemIds.get(sku); return i == null ? null : m.get(i) ?? 0; };

  let history: PackHistory = new Map();
  let titles: string[] = [];
  try { [history, titles] = await Promise.all([packHistory(id), listTabNames(id)]); }
  catch (e) { warnings.push(`KSA sheet not readable — ${(e as Error).message}`); }

  const shipDay = dubaiToday();
  const tab = findMonthTab(titles, shipDay) ?? newMonthTabTitle(shipDay);
  let inSheet = false;
  if (titles.includes(tab)) {
    try { inSheet = inTab(await readAllValues(tab, id), order.order_number); } catch { /* shown via warnings above */ }
  }

  const withStock = lines.map((l) => ({ ...l, ksaStock: stockOf(ksa, l.sku), uaeStock: stockOf(uae, l.sku) }));
  // Default: every line KSA can cover; nothing if KSA covers none.
  const ksaLines = withStock.filter((l) => (l.ksaStock ?? 0) >= l.qty);
  const s = suggestPackaging(ksaLines.length ? ksaLines : withStock, history);
  const all = suggestPackaging(withStock, history);

  const { data: record } = await supabase.from("order_ksa_dispatch").select("*").eq("order_uid", uid).maybeSingle();
  return {
    orderNumber: order.order_number,
    shipDate: shipDateLabel(shipDay),
    sheetTab: tab,
    inSheet,
    lines: withStock.map((l) => ({ ...l, suggested: ksaLines.includes(l) })),
    packaging: KSA_PACKAGING.map((p) => ({ ...p, ksaStock: stockOf(ksa, p.sku), uaeStock: stockOf(uae, p.sku) })),
    suggestion: s.total,
    perLine: all.perLine,
    basis: all.perLine.map((p) => ({ sku: p.sku, basis: p.basis })),
    headers: KSA_HEADERS,
    record: record ?? null,
    warnings,
    soStatus: so.status,
  };
}

// ── send ───────────────────────────────────────────────────────────────────

/** ksaSkus ship from SMSA Fulfillment KSA with `packaging`; every other item
 *  (a split order's UAE half) from Omniastores LLC with `uaePackaging`. */
export type SendInput = { ksaSkus: string[]; packaging: PackLine[]; uaePackaging?: PackLine[]; actor: string } & AmountOptions;

const cleanPack = (list: PackLine[] | undefined) => {
  const out = sumPack((list ?? []).map((p) => ({ sku: p.sku.trim().toUpperCase(), qty: Math.floor(Number(p.qty) || 0) })));
  for (const p of out) {
    if (!PACKAGING_SKUS.has(p.sku)) throw new Error(`${p.sku} is not a packaging option`);
    if (p.qty > 50) throw new Error(`${p.sku}: ${p.qty} is too many`);
  }
  return out;
};
export type StepResult = { ok: boolean; skipped?: boolean; message: string };
export type SendResult = { reserve: StepResult; sheet: StepResult & { tab?: string; startRow?: number; rows?: number }; zoho: StepResult & { flagged?: boolean; close?: CloseResult } };

const RESERVABLE = new Set(["new", "processing", "confirmed"]);

export async function send(uid: string, input: SendInput): Promise<SendResult> {
  const order = await loadOrder(uid);
  const lines = productLines(order);
  const wanted = new Set(input.ksaSkus.map((s) => s.trim().toUpperCase()));
  const ksaLines = lines.filter((l) => wanted.has(l.sku));
  if (!ksaLines.length) throw new Error("Pick at least one item to ship from KSA");
  const packaging = cleanPack(input.packaging);
  const split = ksaLines.length < lines.length;
  const uaePackaging = split ? cleanPack(input.uaePackaging) : [];
  const id = await sheetId();
  const { data: prior } = await supabase.from("order_ksa_dispatch").select("ship_date, sheet_tab, sheet_start_row, sheet_rows").eq("order_uid", uid).maybeSingle();
  // An edit keeps the day it was first sent — its rows stay in that day's block.
  const shipDay = (prior?.ship_date as string | undefined) ?? dubaiToday();

  // 1. reserve
  let reserve: StepResult;
  const stage = order.fulfillment_stage || "new";
  if (!RESERVABLE.has(stage)) {
    reserve = { ok: true, skipped: true, message: `already ${stage}` };
  } else {
    // Each item from the warehouse it ships from: KSA items from KSA, a split
    // order's other items from the UAE warehouse.
    const itemIds = await refreshWarehouseStock(lines.map((l) => l.sku));
    const plan = lines.map((l) => ({ ...l, item_id: itemIds.get(l.sku), wh: wanted.has(l.sku) ? KSA_WAREHOUSE_ID : UAE_WAREHOUSE_ID }));
    const missing = plan.filter((l) => !l.item_id).map((l) => l.sku);
    if (missing.length) throw new Error(`Not in the Zoho catalogue: ${missing.join(", ")}`);
    const short: string[] = [];
    for (const wh of [KSA_WAREHOUSE_ID, UAE_WAREHOUSE_ID]) {
      const mine = plan.filter((l) => l.wh === wh);
      if (!mine.length) continue;
      const have = await effectiveStock(mine.map((l) => l.item_id!), wh, uid);
      for (const l of mine) if ((have.get(l.item_id!) ?? 0) < l.qty) short.push(`${l.sku}: needs ${l.qty}, ${have.get(l.item_id!) ?? 0} in ${wh === KSA_WAREHOUSE_ID ? "KSA" : "UAE"}`);
    }
    if (short.length) {
      await OrderEventsRepository.log(uid, input.actor, "reservation.failed", stage, stage, { ksa: true, failures: short });
      throw new Error(`Not enough stock — ${short.join("; ")}`);
    }
    if (!split) {
      const r = await InventoryReservationsRepository.reserve(uid, KSA_WAREHOUSE_ID, input.actor);
      if (!r.ok) throw new Error(`Reserve refused: ${r.error}`);
    } else {
      // Split: each line from its own warehouse — the RPC reserves a whole order from one.
      const { data: o } = await supabase.from("orders").select("tenant_id").eq("uid", uid).single();
      const { error } = await supabase.from("inventory_reservations").upsert(plan.map((l) => ({
        tenant_id: o?.tenant_id, order_uid: uid, order_number: order.order_number, item_id: l.item_id, sku: l.sku,
        warehouse_id: l.wh, warehouse_name: l.wh === KSA_WAREHOUSE_ID ? "SMSA Fulfillment KSA" : "Omniastores LLC", qty: l.qty, reserved_by: input.actor,
        released_at: null, release_reason: null, reserved_at: new Date().toISOString(),
      })), { onConflict: "order_uid,sku,warehouse_id" });
      if (error) throw new Error(`reservation write failed: ${error.message}`);
      const { error: e2 } = await supabase.from("orders").update({ fulfillment_stage: "reserved", fulfillment_stage_updated_at: new Date().toISOString(), fulfillment_stage_updated_by: input.actor }).eq("uid", uid);
      if (e2) throw new Error(`stage update failed: ${e2.message}`);
    }
    await OrderEventsRepository.log(uid, input.actor, "reservation.created", stage, "reserved", {
      warehouse_id: KSA_WAREHOUSE_ID, warehouse_name: "SMSA Fulfillment KSA", split,
      reservations: plan.map((l) => ({ sku: l.sku, qty: l.qty, warehouse: l.wh === KSA_WAREHOUSE_ID ? "KSA" : "UAE" })),
    });
    reserve = { ok: true, message: split ? `reserved ${ksaLines.length} item(s) from KSA, ${lines.length - ksaLines.length} from UAE` : "reserved from SMSA Fulfillment KSA" };
  }

  const base = {
    order_uid: uid, order_number: order.order_number, ksa_skus: ksaLines.map((l) => l.sku), packaging, uae_packaging: uaePackaging, split,
    ship_date: shipDay, created_by: input.actor, updated_at: new Date().toISOString(),
    rate_override: cleanOptions(input).rateOverride ?? null, match_order_total: Boolean(input.matchOrderTotal),
  };
  await supabase.from("order_ksa_dispatch").upsert(base, { onConflict: "order_uid" });

  // 2. sheet
  let sheet: SendResult["sheet"];
  try {
    const titles = await listTabNames(id);
    let tab = findMonthTab(titles, shipDay);
    if (!tab) { tab = newMonthTabTitle(shipDay); await addTab(tab, id, Math.min(1, titles.length)); }
    let values = await readAllValues(tab, id);
    const rows = buildKsaRows(order, [...ksaLines.map((l) => ({ sku: l.sku, qty: l.qty })), ...packaging], shipDay);
    const ours = ownRows(values, prior, tab, order.order_number);
    if (ours && sameRows(values.slice(ours.start - 1, ours.start - 1 + ours.count), rows)) {
      sheet = { ok: true, skipped: true, message: `already in "${tab}" (row ${ours.start}), unchanged`, tab, startRow: ours.start, rows: ours.count };
    } else if (ours && ours.count === rows.length) {
      // Edited after sending: same number of rows → overwrite them in place.
      await writeRows(tab, ours.start, rows, id);
      sheet = { ok: true, message: `rows ${ours.start}–${ours.start + rows.length - 1} in "${tab}" updated`, tab, startRow: ours.start, rows: rows.length };
      await supabase.from("order_ksa_dispatch").update({ sheet_tab: tab, sheet_start_row: ours.start, sheet_rows: rows.length, sheet_written_at: new Date().toISOString(), sheet_error: null }).eq("order_uid", uid);
      await OrderEventsRepository.log(uid, input.actor, "ksa_sheet.updated", null, null, { tab, startRow: ours.start, rows: rows.length, packaging });
    } else if (!ours && inTab(values, order.order_number)) {
      sheet = { ok: true, skipped: true, message: `already in "${tab}" (typed by hand) — edit it there`, tab };
    } else {
      if (ours) {
        // Edited with a different row count: take ours out, then place the new set.
        await deleteRows(tab, ours.start, ours.count, id);
        values = await readAllValues(tab, id);
      }
      const { startRow, write } = placeRows(values, rows, shipDateLabel(shipDay));
      await writeRows(tab, startRow, write, id);
      sheet = { ok: true, message: `${rows.length} rows written to "${tab}" from row ${startRow + write.length - rows.length}`, tab, startRow: startRow + write.length - rows.length, rows: rows.length };
      await supabase.from("order_ksa_dispatch").update({ sheet_tab: tab, sheet_start_row: sheet.startRow, sheet_rows: rows.length, sheet_written_at: new Date().toISOString(), sheet_error: null }).eq("order_uid", uid);
      await OrderEventsRepository.log(uid, input.actor, "ksa_sheet.written", null, null, { tab, startRow: sheet.startRow, rows: rows.length, packaging });
    }
  } catch (e) {
    sheet = { ok: false, message: (e as Error).message };
    await supabase.from("order_ksa_dispatch").update({ sheet_error: sheet.message }).eq("order_uid", uid);
  }

  // 3. zoho
  let zoho: SendResult["zoho"];
  {
    try {
      const t = await targetForOrder(order.order_number, { ...zohoTarget(ksaLines.map((l) => l.sku), split, packaging, uaePackaging), dispatchDay: shipDay, ...cleanOptions(input) });
      if (!t) {
        zoho = { ok: false, message: `no Zoho sales order ${order.order_number} in any organisation` };
      } else {
        const [r] = await close([t], 1);
        const issues = r.issues?.map((i) => i.message) ?? [];
        zoho = r.outcome === "closed"
          ? { ok: true, message: `closed — invoice ${r.invoice}`, close: r }
          : r.outcome === "skipped" && /already/.test(r.steps.join(" "))
            ? { ok: true, skipped: true, message: r.steps.join("; "), close: r }
            : { ok: false, flagged: !r.error && issues.length > 0, message: r.error ?? (issues.length ? `Flagged, not closed — ${issues.join("; ")}` : r.steps.join("; ")), close: r };
        await supabase.from("order_ksa_dispatch").update({
          zoho_outcome: r.outcome, zoho_steps: r.steps, zoho_issues: r.issues ?? [], zoho_invoice: r.invoice ?? null, zoho_error: zoho.ok ? null : zoho.message,
        }).eq("order_uid", uid);
        await OrderEventsRepository.log(uid, input.actor, zoho.ok ? "zoho_so.closed" : "zoho_so.close_failed", null, null, { outcome: r.outcome, invoice: r.invoice, steps: r.steps, issues: r.issues });
      }
    } catch (e) {
      zoho = { ok: false, message: (e as Error).message };
      await supabase.from("order_ksa_dispatch").update({ zoho_outcome: "failed", zoho_error: zoho.message }).eq("order_uid", uid);
    }
  }

  return { reserve, sheet, zoho };
}


/** Warehouses for the Zoho close: whole order from KSA, or a split — KSA items
 *  and boxes from KSA, everything else from the UAE warehouse. */
function zohoTarget(ksaSkus: string[], split: boolean, ksaPack: PackLine[], uaePack: PackLine[]) {
  const boxes = [
    ...ksaPack.map((p) => ({ sku: p.sku, qty: p.qty, description: "KSA", warehouse_id: KSA_WAREHOUSE_ID })),
    ...uaePack.map((p) => ({ sku: p.sku, qty: p.qty, description: "UAE", warehouse_id: UAE_WAREHOUSE_ID })),
  ];
  return split
    ? { packaging: boxes, warehouseId: UAE_WAREHOUSE_ID, lineWarehouses: Object.fromEntries(ksaSkus.map((s) => [s, KSA_WAREHOUSE_ID])) }
    : { packaging: boxes, warehouseId: KSA_WAREHOUSE_ID };
}

type Prior = { sheet_tab?: string | null; sheet_start_row?: number | null; sheet_rows?: number | null } | null;
/** The rows this system wrote for the order, if they are still where it left
 *  them (every row in the range carries the order number). Rows above may have
 *  moved them — then they are found by scanning for an unbroken run. */
function ownRows(values: string[][], prior: Prior, tab: string, orderNumber: string): { start: number; count: number } | null {
  if (!prior?.sheet_start_row || !prior.sheet_rows || prior.sheet_tab !== tab) return null;
  const isOurs = (i: number) => String(values[i]?.[0] ?? "").trim().toUpperCase() === orderNumber.toUpperCase();
  const fits = (start: number) => Array.from({ length: prior.sheet_rows! }, (_, k) => start - 1 + k).every(isOurs);
  if (fits(prior.sheet_start_row)) return { start: prior.sheet_start_row, count: prior.sheet_rows };
  for (let i = 0; i < values.length; i++) if (isOurs(i) && fits(i + 1)) return { start: i + 1, count: prior.sheet_rows };
  return null;
}
const sameRows = (a: string[][], b: string[][]) =>
  a.length === b.length && a.every((r, i) => b[i].every((v, c) => String(r[c] ?? "") === v));

/** Dry run of the Zoho close for this selection — shown before sending, so a
 *  wrong amount, a missing batch or short stock flags the order up front. */
export async function zohoCheck(uid: string, input: Omit<SendInput, "actor">) {
  const order = await loadOrder(uid);
  const lines = productLines(order);
  const wanted = new Set(input.ksaSkus.map((s) => s.trim().toUpperCase()));
  const ksaSkus = lines.filter((l) => wanted.has(l.sku)).map((l) => l.sku);
  const split = ksaSkus.length < lines.length;
  const t = await targetForOrder(order.order_number, { ...zohoTarget(ksaSkus, split, cleanPack(input.packaging), split ? cleanPack(input.uaePackaging) : []), dispatchDay: dubaiToday(), ...cleanOptions(input) });
  if (!t) return { state: "no_so" as const, issues: [{ code: "no_so", message: `No Zoho sales order ${order.order_number} in any organisation`, blocking: true }], changes: [] };
  const [r] = await plan([t]);
  if (r.error || !r.plan) return { state: "error" as const, issues: [{ code: "error", message: r.error ?? "dry run failed", blocking: true }], changes: [] };
  const p = r.plan;
  return { state: p.state, issues: p.issues, changes: p.changes, soTotal: p.soTotal, expectedTotal: p.expectedTotal, orderTotalAed: p.orderTotalAed, cod: p.cod, fx: p.fx, invoiceDate: r.invoiceDate };
}

/** The saved send — for the order page's flag card (no Zoho or Sheets calls). */
export async function record(uid: string) {
  const { data } = await supabase.from("order_ksa_dispatch").select("*").eq("order_uid", uid).maybeSingle();
  return data ?? null;
}

/** Send again with what was saved on the first send — retries the failed steps. */
export async function retry(uid: string, actor: string): Promise<SendResult> {
  const { data } = await supabase.from("order_ksa_dispatch").select("ksa_skus, packaging, uae_packaging, rate_override, match_order_total").eq("order_uid", uid).maybeSingle();
  if (!data) throw new Error("This order was never sent from KSA");
  return send(uid, {
    ksaSkus: data.ksa_skus as string[], packaging: data.packaging as PackLine[], uaePackaging: (data.uae_packaging ?? []) as PackLine[], actor,
    rateOverride: data.rate_override == null ? undefined : Number(data.rate_override), matchOrderTotal: Boolean(data.match_order_total),
  });
}
