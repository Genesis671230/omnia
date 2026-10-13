// Pack an order from Omniastores LLC (the UAE warehouse) on the order page:
// the packer scans or picks the boxes that went into the parcel, then one
// confirm
//
//   1. reserves the items from Omniastores LLC (when not reserved yet)
//   2. closes the Zoho sales order from that warehouse with the boxes as
//      rate-0 lines → invoice → sent — the /sales-orders close, so the same
//      tax, amount, batch, kit and COD rules apply and Zoho stock moves.
//
// The pick is saved in order_uae_pack, and /sales-orders uses those boxes
// instead of the packing sheet's — a flagged order can be closed there later
// without counting its boxes twice. Sending again retries; it never re-invoices.

import { supabase } from "@/lib/supabase";
import { getSetting } from "@/lib/settings";
import { dubaiToday } from "@/lib/dubai-day";
import { InventoryReservationsRepository } from "@/lib/repositories/inventory-reservations.repository";
import { OrderEventsRepository } from "@/lib/repositories/order-events.repository";
import { effectiveStock, refreshWarehouseStock } from "@/lib/inventory/live-warehouse-stock";
import { withZohoOrg } from "@/lib/integrations/zoho-org";
import { batchesFor, getSalesOrder, itemStock, itemsBySku } from "@/lib/sales-orders/zoho-so";
import { ownCommitted } from "@/lib/sales-orders/so-plan";
import { cleanOptions, close, forgetBoard, plan, targetForOrder, UAE_WAREHOUSE_ID, type AmountOptions, type CloseResult } from "@/lib/sales-orders/so-close.service";
import { KSA_PACKAGING, PACKAGING_SKUS, suggestPackaging, sumPack, type PackHistory, type PackLine } from "@/lib/ksa-dispatch/packaging";
import { packHistory, sheetId } from "@/lib/ksa-dispatch/ksa-dispatch.service";

type OrderRow = { uid: string; order_number: string; fulfillment_stage: string | null; line_items: { sku?: string; qty?: number; title?: string }[] };

async function loadOrder(uid: string): Promise<OrderRow> {
  const { data, error } = await supabase.from("orders").select("uid, order_number, fulfillment_stage, line_items").eq("uid", uid).maybeSingle();
  if (error) throw new Error(`order read failed: ${error.message}`);
  if (!data) throw new Error("order not found");
  return data as OrderRow;
}

const productLines = (o: OrderRow) => (o.line_items ?? [])
  .map((l) => ({ sku: (l.sku ?? "").trim().toUpperCase(), qty: Number(l.qty ?? 1), title: l.title ?? "" }))
  .filter((l) => l.sku && l.qty > 0);

export async function packagingBarcodes(): Promise<Record<string, string>> {
  try { return (await getSetting<Record<string, string>>("packaging.barcodes")) ?? {}; } catch { return {}; }
}

export type UaePackPreview = {
  orderNumber: string;
  lines: { sku: string; qty: number; title: string; uaeStock: number | null }[];
  packaging: { sku: string; label: string; primary: boolean; uaeStock: number | null }[];
  /** What this order's items were packed with before (KSA history), else the rules — a hint, never pre-filled. */
  suggestion: PackLine[];
  basis: { sku: string; basis: string }[];
  barcodes: Record<string, string>;
  soStatus: string | null;
  soInvoice: string | null;
  ksaSent: boolean;
  record: Record<string, unknown> | null;
  warnings: string[];
};

export async function preview(uid: string): Promise<UaePackPreview> {
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
  const [uae, so, history, barcodes, rec, ksa] = await Promise.all([
    effectiveStock(ids, UAE_WAREHOUSE_ID, uid),
    soState(order.order_number),
    sheetId().then(packHistory).catch((e) => { warnings.push(`Packaging history not readable — ${(e as Error).message}`); return new Map() as PackHistory; }),
    packagingBarcodes(),
    supabase.from("order_uae_pack").select("*").eq("order_uid", uid).maybeSingle(),
    supabase.from("order_ksa_dispatch").select("order_uid").eq("order_uid", uid).maybeSingle(),
  ]);
  // A confirmed SO commits its own lines — they are this order's, so they count as available to it.
  for (const [k, q] of so.committed) {
    const [item, wh] = k.split("|");
    if (wh === UAE_WAREHOUSE_ID) uae.set(item, (uae.get(item) ?? 0) + q);
  }
  const stockOf = (sku: string) => { const i = itemIds.get(sku); return i == null ? null : uae.get(i) ?? 0; };
  const s = suggestPackaging(lines, history);
  return {
    orderNumber: order.order_number,
    lines: lines.map((l) => ({ ...l, uaeStock: stockOf(l.sku) })),
    packaging: KSA_PACKAGING.map((p) => ({ ...p, uaeStock: stockOf(p.sku) })),
    suggestion: s.total,
    basis: s.perLine.map((p) => ({ sku: p.sku, basis: p.basis })),
    barcodes,
    soStatus: so.status,
    soInvoice: so.invoice,
    ksaSent: Boolean(ksa.data),
    record: rec.data ?? null,
    warnings,
  };
}

async function soState(orderNumber: string): Promise<{ status: string | null; invoice: string | null; committed: Map<string, number> }> {
  try {
    const t = await targetForOrder(orderNumber, { packaging: null, dispatchDay: null });
    if (!t) return { status: null, invoice: null, committed: new Map() };
    const so = await withZohoOrg(t.org, () => getSalesOrder(t.soId));
    if (so.status === "draft" || so.status === "open") warmPackaging(t.org);
    return { status: so.status, invoice: so.invoices?.[0]?.invoice_number ?? null, committed: ownCommitted(so) };
  } catch {
    return { status: null, invoice: null, committed: new Map() };
  }
}

/** Read every box's Zoho item, stock and (for batch-tracked boxes) batches in
 *  the background while the packer picks — so the first scan of any box type
 *  hits the caches instead of Zoho. Once per org per 2 minutes. */
const warmedAt = new Map<string, number>();
function warmPackaging(org: string) {
  if (Date.now() - (warmedAt.get(org) ?? 0) < 120_000) return;
  warmedAt.set(org, Date.now());
  void withZohoOrg(org, async () => {
    const items = [...(await itemsBySku([...PACKAGING_SKUS])).values()];
    await itemStock(items.map((i) => i.item_id));
    for (const i of items.filter((x) => x.trackBatch)) await batchesFor(i.item_id, UAE_WAREHOUSE_ID, { need: 3 });
  }).catch((e) => { warmedAt.delete(org); console.error("[uae-pack] warm-up failed:", (e as Error).message); });
}

export const cleanPack = (list: PackLine[] | undefined): PackLine[] => {
  const out = sumPack((list ?? []).map((p) => ({ sku: String(p.sku ?? "").trim().toUpperCase(), qty: Math.floor(Number(p.qty) || 0) })));
  for (const p of out) {
    if (!PACKAGING_SKUS.has(p.sku)) throw new Error(`${p.sku} is not a packaging option`);
    if (p.qty > 50) throw new Error(`${p.sku}: ${p.qty} is too many`);
  }
  return out;
};

const uaeTarget = (packaging: PackLine[]) => ({
  packaging: packaging.map((p) => ({ sku: p.sku, qty: p.qty, description: "UAE", warehouse_id: UAE_WAREHOUSE_ID })),
  warehouseId: UAE_WAREHOUSE_ID,
});

export type PackInput = { packaging: PackLine[] } & AmountOptions;

/** Dry run of the Zoho close for these boxes — nothing written. */
export async function check(uid: string, input: PackInput) {
  const order = await loadOrder(uid);
  const t = await targetForOrder(order.order_number, { ...uaeTarget(cleanPack(input.packaging)), dispatchDay: dubaiToday(), ...cleanOptions(input) });
  if (!t) return { state: "no_so" as const, issues: [{ code: "no_so", message: `No Zoho sales order ${order.order_number} in any organisation`, blocking: true }], changes: [] };
  const [r] = await plan([t]);
  if (r.error || !r.plan) return { state: "error" as const, issues: [{ code: "error", message: r.error ?? "dry run failed", blocking: true }], changes: [] };
  const p = r.plan;
  return { state: p.state, issues: p.issues, changes: p.changes, soTotal: p.soTotal, expectedTotal: p.expectedTotal, orderTotalAed: p.orderTotalAed, cod: p.cod, fx: p.fx, invoiceDate: r.invoiceDate };
}

export type StepResult = { ok: boolean; skipped?: boolean; flagged?: boolean; message: string };
export type PackResult = { reserve: StepResult; zoho: StepResult & { close?: CloseResult } };

const RESERVABLE = new Set(["new", "processing", "confirmed"]);

export async function send(uid: string, input: PackInput & { actor: string }): Promise<PackResult> {
  const order = await loadOrder(uid);
  const lines = productLines(order);
  const packaging = cleanPack(input.packaging);
  const { data: ksa } = await supabase.from("order_ksa_dispatch").select("order_uid").eq("order_uid", uid).maybeSingle();
  if (ksa) throw new Error(`${order.order_number} was sent from KSA — edit the KSA send instead`);
  const { data: prior } = await supabase.from("order_uae_pack").select("pack_date").eq("order_uid", uid).maybeSingle();
  const packDay = (prior?.pack_date as string | undefined) ?? dubaiToday();

  // 1. reserve from Omniastores LLC
  let reserve: StepResult;
  const stage = order.fulfillment_stage || "new";
  if (!RESERVABLE.has(stage)) {
    reserve = { ok: true, skipped: true, message: `already ${stage}` };
  } else if (!lines.length) {
    reserve = { ok: true, skipped: true, message: "no product lines on the order" };
  } else {
    const itemIds = await refreshWarehouseStock(lines.map((l) => l.sku));
    const missing = lines.filter((l) => !itemIds.get(l.sku)).map((l) => l.sku);
    if (missing.length) throw new Error(`Not in the Zoho catalogue: ${missing.join(", ")}`);
    const r = await InventoryReservationsRepository.reserve(uid, UAE_WAREHOUSE_ID, input.actor);
    if (!r.ok) {
      await OrderEventsRepository.log(uid, input.actor, "reservation.failed", stage, stage, { warehouse_id: UAE_WAREHOUSE_ID, error: r.error, failures: r.failures, uaePack: true });
      throw new Error(`Reserve from Omniastores LLC refused: ${r.error}${r.failures?.length ? ` — ${JSON.stringify(r.failures)}` : ""}`);
    }
    await OrderEventsRepository.log(uid, input.actor, "reservation.created", stage, "reserved", { warehouse_id: UAE_WAREHOUSE_ID, warehouse_name: "Omniastores LLC", reservations: r.reservations, uaePack: true });
    reserve = { ok: true, message: "reserved from Omniastores LLC" };
  }

  await supabase.from("order_uae_pack").upsert({
    order_uid: uid, order_number: order.order_number, packaging, pack_date: packDay, created_by: input.actor, updated_at: new Date().toISOString(),
    rate_override: cleanOptions(input).rateOverride ?? null, match_order_total: Boolean(input.matchOrderTotal),
  }, { onConflict: "order_uid" });
  await OrderEventsRepository.log(uid, input.actor, "uae_pack.saved", null, null, { packaging });

  // 2. Zoho sales order close from Omniastores LLC
  let zoho: PackResult["zoho"];
  try {
    const t = await targetForOrder(order.order_number, { ...uaeTarget(packaging), dispatchDay: packDay, ...cleanOptions(input) });
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
      await supabase.from("order_uae_pack").update({
        zoho_outcome: r.outcome, zoho_steps: r.steps, zoho_issues: r.issues ?? [], zoho_invoice: r.invoice ?? null, zoho_error: zoho.ok ? null : zoho.message,
      }).eq("order_uid", uid);
      await OrderEventsRepository.log(uid, input.actor, zoho.ok ? "zoho_so.closed" : "zoho_so.close_failed", null, null, { outcome: r.outcome, invoice: r.invoice, steps: r.steps, issues: r.issues, warehouse: "Omniastores LLC" });
    }
  } catch (e) {
    zoho = { ok: false, message: (e as Error).message };
    await supabase.from("order_uae_pack").update({ zoho_outcome: "failed", zoho_error: zoho.message }).eq("order_uid", uid);
  }
  forgetBoard(packDay.slice(0, 7));
  return { reserve, zoho };
}

export async function record(uid: string) {
  const { data } = await supabase.from("order_uae_pack").select("*").eq("order_uid", uid).maybeSingle();
  return data ?? null;
}
