"use client";

/* Sales-order editor — every field the close touches, editable before it is
 * written: date, reference, notes, tax treatment, place of supply, each line
 * (qty, rate, discount, tax, warehouse, description), add/remove lines, and
 * the supplier batch each batch-tracked line is invoiced from (FIFO picked,
 * overridable). "Save" updates the sales order only; "Save & close" also
 * confirms it, invoices it on the invoice date and marks it sent. */

import { Loader2, Plus, Search, Trash2, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import type { EditorData } from "@/lib/sales-orders/so-close.service";
import type { BatchPick, ItemHit } from "@/lib/sales-orders/zoho-so";

type Line = {
  key: string; line_item_id?: string; item_id: string; sku: string; name: string; description: string;
  quantity: number; rate: number; discount: string; tax_id: string; warehouse_id: string; unit?: string; track_batch: boolean;
};

const TREATMENTS = ["vat_registered", "vat_not_registered", "gcc_vat_registered", "gcc_vat_not_registered", "non_gcc", "dz_vat_registered", "dz_vat_not_registered"];
const PLACES = [
  ["DU", "Dubai"], ["AB", "Abu Dhabi"], ["SH", "Sharjah"], ["AJ", "Ajman"], ["UQ", "Umm Al Quwain"], ["RK", "Ras Al Khaimah"], ["FU", "Fujairah"],
  ["SA", "Saudi Arabia"], ["KW", "Kuwait"], ["QA", "Qatar"], ["OM", "Oman"], ["BH", "Bahrain"],
];
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let seq = 0;
const key = () => `l${++seq}`;

function lineNet(l: Line): number {
  const gross = l.quantity * l.rate;
  const d = String(l.discount ?? "").trim();
  if (!d) return gross;
  if (d.endsWith("%")) return gross * (1 - (parseFloat(d) || 0) / 100);
  return gross - (parseFloat(d) || 0);
}

export function SoEditor({ month, order, sheet, onClose, onSaved }: { month: string; order: string; sheet?: string; onClose: () => void; onSaved: () => void }) {
  const [data, setData] = useState<EditorData | null>(null);
  const [error, setError] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [head, setHead] = useState({ date: "", reference_number: "", notes: "", tax_treatment: "", place_of_supply: "" });
  const [invoiceDate, setInvoiceDate] = useState("");
  const [batchQty, setBatchQty] = useState<Record<string, Record<string, number>>>({});
  const [busy, setBusy] = useState<"" | "save" | "close">("");
  const [armed, setArmed] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ItemHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const fromSo = useCallback((d: EditorData) => {
    setHead({ date: d.so.date, reference_number: d.so.reference_number ?? "", notes: d.so.notes ?? "", tax_treatment: d.so.tax_treatment, place_of_supply: d.so.place_of_supply ?? "" });
    setLines(d.so.line_items.map((l) => ({
      key: key(), line_item_id: l.line_item_id, item_id: l.item_id, sku: l.sku ?? "", name: l.name ?? "", description: l.description ?? "",
      quantity: l.quantity, rate: l.rate, discount: String(l.discount ?? ""), tax_id: l.tax_id ?? "", warehouse_id: l.warehouse_id ?? "", unit: l.unit, track_batch: Boolean(l.track_batch_number),
    })));
    const bq: Record<string, Record<string, number>> = {};
    for (const [lid, picks] of Object.entries(d.suggestedBatches)) bq[lid] = Object.fromEntries(picks.map((p) => [p.batch_id, p.out_quantity]));
    setBatchQty(bq);
    setInvoiceDate(d.invoiceDate);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/sales-orders/detail?month=${month}&order=${encodeURIComponent(order)}${sheet ? `&sheet=${encodeURIComponent(sheet)}` : ""}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setData(j);
      fromSo(j);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [month, order, sheet, fromSo]);
  useEffect(() => { load(); }, [load]);

  const taxPct = useMemo(() => new Map((data?.taxes ?? []).map((t) => [t.tax_id, t.tax_percentage])), [data]);
  const totals = useMemo(() => {
    let sub = 0, tax = 0;
    for (const l of lines) { const n = lineNet(l); sub += n; tax += n * (taxPct.get(l.tax_id) ?? 0) / 100; }
    return { sub, tax, total: Math.round((sub + tax) * 100) / 100 };
  }, [lines, taxPct]);
  const orderAed = data?.plan.orderTotalAed ?? null;
  const editable = data ? data.so.status === "draft" || data.so.status === "open" : false;

  // Suggested fixes from the dry run: tax by region, packaging lines.
  function applySuggested() {
    const u = data?.plan.update as { tax_treatment: string; place_of_supply?: string; line_items: Record<string, unknown>[] } | null;
    if (!u || !data) return;
    setHead((h) => ({ ...h, tax_treatment: u.tax_treatment, place_of_supply: u.place_of_supply ?? "" }));
    const byId = new Map(data.so.line_items.map((l) => [l.line_item_id, l]));
    setLines(u.line_items.map((r) => {
      const was = r.line_item_id ? byId.get(String(r.line_item_id)) : undefined;
      return {
        key: key(), line_item_id: r.line_item_id ? String(r.line_item_id) : undefined, item_id: String(r.item_id),
        sku: was?.sku ?? "", name: String(r.name ?? was?.name ?? ""), description: String(r.description ?? was?.description ?? ""),
        quantity: Number(r.quantity), rate: Number(r.rate), discount: String(r.discount ?? ""), tax_id: String(r.tax_id ?? ""),
        warehouse_id: String(r.warehouse_id ?? ""), unit: was?.unit, track_batch: Boolean(was?.track_batch_number),
      };
    }));
    toast.success(`${data.plan.changes.length} suggested change(s) applied — review, then save`);
  }

  const setLine = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  async function search() {
    if (q.trim().length < 2) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/sales-orders/items?q=${encodeURIComponent(q.trim())}&org=${data?.org ?? "env"}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setHits(j.items);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSearching(false);
    }
  }
  function addItem(it: ItemHit) {
    const regionTax = lines[0]?.tax_id ?? "";
    const wh = lines.find((l) => l.warehouse_id)?.warehouse_id ?? "";
    setLines((ls) => [...ls, { key: key(), item_id: it.item_id, sku: it.sku, name: it.name, description: "", quantity: 1, rate: it.rate, discount: "", tax_id: regionTax, warehouse_id: it.product_type === "goods" ? wh : "", track_batch: it.track_batch_number }]);
    setHits([]);
    setQ("");
  }

  function batchesPayload(): Record<string, BatchPick[]> | undefined {
    const out: Record<string, BatchPick[]> = {};
    for (const l of lines) {
      if (!l.line_item_id || !l.track_batch) continue;
      const opts = data?.batchOptions[l.line_item_id] ?? [];
      const picks = Object.entries(batchQty[l.line_item_id] ?? {}).filter(([, n]) => n > 0)
        .map(([id, n]) => ({ batch_id: id, batch_number: opts.find((b) => b.batch_id === id)?.batch_number ?? "", out_quantity: n }));
      if (picks.length) out[l.line_item_id] = picks;
    }
    return Object.keys(out).length ? out : undefined;
  }

  async function submit(close: boolean) {
    if (close && !armed) { setArmed(true); return; }
    setArmed(false);
    setBusy(close ? "close" : "save");
    try {
      const edit = {
        date: head.date, reference_number: head.reference_number, notes: head.notes,
        tax_treatment: head.tax_treatment, place_of_supply: head.place_of_supply || undefined,
        line_items: lines.map((l) => ({
          line_item_id: l.line_item_id, item_id: l.item_id, name: l.name, description: l.description,
          quantity: Number(l.quantity), rate: Number(l.rate), discount: l.discount || 0, tax_id: l.tax_id || undefined,
          warehouse_id: l.warehouse_id || undefined, unit: l.unit,
        })),
      };
      const res = await fetch("/api/sales-orders/update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, order, edit, close, batches: close ? batchesPayload() : undefined, invoiceDate: close ? invoiceDate : undefined, sheet, confirm: true }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setLog(j.steps ?? []);
      if (j.error) toast.error(j.error);
      else toast.success(close ? (j.outcome === "closed" ? `${order} closed · ${j.invoice}` : `${order}: ${j.outcome}`) : `${order} saved · AED ${j.total}`);
      onSaved();
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const body = (
    <div className="fixed inset-0 z-[90] flex justify-end bg-slate-900/30" onClick={onClose}>
      <div className="h-full w-full max-w-[1100px] overflow-y-auto bg-[#F6F8FC] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[22px] font-light text-slate-900">{order} <span className="text-[13px] text-slate-500">{data ? `${data.so.status} · ${data.plan.region} ${data.plan.country} · ${data.so.customer_name ?? ""}` : ""}</span></div>
            {data && <div className="text-[12.5px] text-slate-500">Store order {data.order?.orderDay ?? "—"}{data.order?.currency ? ` · ${data.order.currency} ${data.order.grossOriginal}` : ""}{orderAed != null ? ` = AED ${fmt(orderAed)} at the fixed rate` : ""}{data.day ? ` · packed day ${data.day}` : " · not on the packing sheet"}</div>}
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-white"><X size={18} /></button>
        </div>

        {error && <div className="mb-3 rounded-2xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700 ring-1 ring-rose-200">{error}</div>}
        {!data ? (!error && <div className="flex items-center gap-2 text-[13px] text-slate-500"><Loader2 size={14} className="animate-spin" /> Reading the sales order, stock and supplier batches…</div>) : (
          <div className="space-y-4">
            {/* flags + suggested */}
            <div className="rounded-[20px] bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] uppercase tracking-wide text-slate-400">Dry run</span>
                <span className={`rounded-full px-2 py-0.5 text-[12px] ring-1 ${data.plan.state === "ready" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : data.plan.state === "closed" ? "bg-slate-100 text-slate-600 ring-slate-200" : "bg-rose-50 text-rose-700 ring-rose-200"}`}>{data.plan.state}</span>
                {editable && data.plan.update && <button onClick={applySuggested} className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#2347D9] px-3 py-1.5 text-[12.5px] text-white hover:bg-[#1c3bb8]"><Wand2 size={13} /> Apply suggested fixes</button>}
              </div>
              <div className="mt-2 grid gap-3 text-[12.5px] md:grid-cols-2">
                <div>{data.plan.changes.length ? data.plan.changes.map((c) => <div key={c} className="text-slate-700">• {c}</div>) : <div className="text-slate-400">No changes suggested</div>}</div>
                <div>{data.plan.issues.length ? data.plan.issues.map((i) => <div key={i.message} className={i.blocking ? "text-rose-700" : "text-amber-700"}>{i.blocking ? "✕" : "!"} {i.message}</div>) : <div className="text-emerald-700">No flags</div>}</div>
              </div>
              {data.packaging.length > 0 && <div className="mt-2 flex flex-wrap gap-1 text-[11.5px]"><span className="text-slate-400">Packing sheet:</span>{data.packaging.map((p) => <span key={p.sku} className="rounded bg-slate-100 px-1.5 text-slate-700">{p.qty}× {p.sku} {p.description}</span>)}</div>}
            </div>

            {/* header fields */}
            <div className="grid gap-3 rounded-[20px] bg-white p-4 shadow-sm md:grid-cols-5">
              <Field label="SO date"><input type="date" value={head.date} disabled={!editable} onChange={(e) => setHead({ ...head, date: e.target.value })} className="inp" /></Field>
              <Field label="Reference"><input value={head.reference_number} disabled={!editable} onChange={(e) => setHead({ ...head, reference_number: e.target.value })} className="inp" /></Field>
              <Field label="Tax treatment">
                <select value={head.tax_treatment} disabled={!editable} onChange={(e) => setHead({ ...head, tax_treatment: e.target.value })} className="inp">{TREATMENTS.map((t) => <option key={t}>{t}</option>)}</select>
              </Field>
              <Field label="Place of supply">
                <select value={head.place_of_supply} disabled={!editable} onChange={(e) => setHead({ ...head, place_of_supply: e.target.value })} className="inp">
                  <option value="">— none —</option>{PLACES.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}
                </select>
              </Field>
              <Field label="Invoice date"><input type="date" value={invoiceDate} disabled={!editable} onChange={(e) => setInvoiceDate(e.target.value)} className="inp" /></Field>
              <div className="md:col-span-5"><Field label="Notes"><input value={head.notes} disabled={!editable} onChange={(e) => setHead({ ...head, notes: e.target.value })} className="inp" /></Field></div>
            </div>

            {/* lines */}
            <div className="overflow-x-auto rounded-[20px] bg-white shadow-sm">
              <table className="w-full min-w-[960px] text-[12.5px]">
                <thead className="border-b border-slate-100 text-[10.5px] uppercase tracking-wide text-slate-400">
                  <tr><th className="px-3 py-2 text-left">Item</th><th className="px-2 text-left">Description</th><th className="px-2">Qty</th><th className="px-2">Rate</th><th className="px-2">Discount</th><th className="px-2">Tax</th><th className="px-2">Warehouse</th><th className="px-2 text-right">Amount</th><th /></tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <LineRow key={l.key} l={l} editable={editable} data={data} setLine={setLine} remove={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      batchQty={l.line_item_id ? batchQty[l.line_item_id] ?? {} : {}} setBatch={(bid, n) => l.line_item_id && setBatchQty((b) => ({ ...b, [l.line_item_id!]: { ...(b[l.line_item_id!] ?? {}), [bid]: n } }))} />
                  ))}
                </tbody>
              </table>
              {editable && (
                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2">
                  <div className="relative">
                    <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Add item by SKU or name" className="inp w-64 pl-7" />
                  </div>
                  <button onClick={search} className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12.5px] text-[#2347D9] ring-1 ring-slate-200 hover:bg-slate-50">{searching ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Find</button>
                  <div className="flex w-full flex-wrap gap-1">{hits.map((h) => <button key={h.item_id} onClick={() => addItem(h)} className="rounded-lg bg-slate-50 px-2 py-1 text-left text-[12px] ring-1 ring-slate-200 hover:bg-sky-50"><b>{h.sku}</b> {h.name} <span className="text-slate-400">· {h.item_type}{h.track_batch_number ? " · batch" : ""} · {fmt(h.rate)}</span></button>)}</div>
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-5 border-t border-slate-100 px-4 py-3 text-[13px] tabular-nums">
                <span className="text-slate-500">Sub-total {fmt(totals.sub)}</span>
                <span className="text-slate-500">Tax {fmt(totals.tax)}</span>
                <span className="font-medium text-slate-900">Total AED {fmt(totals.total)}</span>
                {orderAed != null && <span className={Math.abs(orderAed - totals.total) > Math.max(1, orderAed * 0.002) ? "font-medium text-orange-600" : "text-emerald-700"}>Order AED {fmt(orderAed)} ({totals.total - orderAed >= 0 ? "+" : ""}{fmt(totals.total - orderAed)})</span>}
              </div>
            </div>

            {/* actions */}
            {editable ? (
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => data && fromSo(data)} className="rounded-full px-3 py-2 text-[12.5px] text-slate-600 ring-1 ring-slate-200 hover:bg-white">Reset to Zoho</button>
                <span className="ml-auto text-[12px] text-slate-500">Close = {data.so.status === "draft" ? "confirm → " : ""}invoice on {invoiceDate}{data.settings.markSent ? " → mark sent" : ""}</span>
                <button onClick={() => submit(false)} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[13px] text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">{busy === "save" && <Loader2 size={13} className="animate-spin" />} Save to Zoho</button>
                <button onClick={() => submit(true)} disabled={!!busy} className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50 ${armed ? "bg-rose-600" : "bg-[#2347D9] hover:bg-[#1c3bb8]"}`}>{busy === "close" && <Loader2 size={13} className="animate-spin" />}{armed ? "Confirm: save, invoice & send" : "Save & close"}</button>
                {armed && <button onClick={() => setArmed(false)} className="text-[12.5px] text-slate-500 hover:underline">Cancel</button>}
              </div>
            ) : <div className="text-[12.5px] text-slate-500">This sales order is {data.so.status}; it can no longer be edited here.</div>}
            {log.length > 0 && <div className="rounded-2xl bg-white p-3 text-[12.5px] text-slate-700 shadow-sm">{log.map((s) => <div key={s}>• {s}</div>)}</div>}
          </div>
        )}
      </div>
      <style>{`.inp{height:34px;width:100%;border-radius:10px;border:1px solid #e2e8f0;background:#fff;padding:0 8px;font-size:12.5px}.inp:disabled{background:#f8fafc;color:#64748b}`}</style>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(body, document.body);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[10.5px] uppercase tracking-wide text-slate-400">{label}</span>{children}</label>;
}

function LineRow({ l, editable, data, setLine, remove, batchQty, setBatch }: {
  l: Line; editable: boolean; data: EditorData; setLine: (k: string, p: Partial<Line>) => void; remove: () => void;
  batchQty: Record<string, number>; setBatch: (batchId: string, n: number) => void;
}) {
  const opts = l.line_item_id ? data.batchOptions[l.line_item_id] ?? [] : [];
  const picked = Object.values(batchQty).reduce((s, n) => s + (n || 0), 0);
  const pct = data.taxes.find((t) => t.tax_id === l.tax_id)?.tax_percentage ?? 0;
  return (
    <>
      <tr className="border-b border-slate-50 align-top">
        <td className="px-3 py-2"><div className="font-medium text-slate-900">{l.sku || "—"}</div><div className="max-w-[220px] truncate text-[11.5px] text-slate-500" title={l.name}>{l.name}</div></td>
        <td className="px-2 py-2"><input value={l.description} disabled={!editable} onChange={(e) => setLine(l.key, { description: e.target.value })} className="inp" /></td>
        <td className="w-16 px-2 py-2"><input type="number" min={1} value={l.quantity} disabled={!editable} onChange={(e) => setLine(l.key, { quantity: Number(e.target.value) })} className="inp" /></td>
        <td className="w-24 px-2 py-2"><input type="number" min={0} step="0.01" value={l.rate} disabled={!editable} onChange={(e) => setLine(l.key, { rate: Number(e.target.value) })} className="inp" /></td>
        <td className="w-20 px-2 py-2"><input value={l.discount} placeholder="5% or 10" disabled={!editable} onChange={(e) => setLine(l.key, { discount: e.target.value })} className="inp" /></td>
        <td className="w-36 px-2 py-2">
          <select value={l.tax_id} disabled={!editable} onChange={(e) => setLine(l.key, { tax_id: e.target.value })} className="inp">
            <option value="">— exempt —</option>{data.taxes.map((t) => <option key={t.tax_id} value={t.tax_id}>{t.tax_name} ({t.tax_percentage}%)</option>)}
          </select>
        </td>
        <td className="w-40 px-2 py-2">
          <select value={l.warehouse_id} disabled={!editable} onChange={(e) => setLine(l.key, { warehouse_id: e.target.value })} className="inp">
            <option value="">—</option>{data.warehouses.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_name}</option>)}
            {l.warehouse_id && !data.warehouses.some((w) => w.warehouse_id === l.warehouse_id) && <option value={l.warehouse_id}>{l.warehouse_id}</option>}
          </select>
        </td>
        <td className="px-2 py-2 text-right tabular-nums">{fmt(lineNet(l) * (1 + pct / 100))}</td>
        <td className="px-2 py-2">{editable && <button onClick={remove} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={14} /></button>}</td>
      </tr>
      {l.track_batch && (
        <tr className="border-b border-slate-100 bg-slate-50/60">
          <td />
          <td colSpan={8} className="px-2 py-2 text-[12px]">
            {!l.line_item_id ? <span className="text-slate-500">Batch-tracked — invoiced from the oldest supplier batch (FIFO) after saving.</span>
              : !opts.length ? <span className="text-rose-700">No supplier batch with stock found on this item&apos;s bills — pick the batch in Zoho.</span>
              : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className={picked === l.quantity ? "text-emerald-700" : "text-orange-600"}>Batches {picked}/{l.quantity} (FIFO, oldest bill first):</span>
                  {opts.map((b) => (
                    <label key={b.batch_id} className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 ring-1 ring-slate-200" title={`Bill ${b.bill} · ${b.date}`}>
                      <b>{b.batch_number}</b><span className="text-slate-500">{b.vendor || "supplier"} · {b.date} · {b.balance} left</span>
                      <input type="number" min={0} max={b.balance} value={batchQty[b.batch_id] ?? 0} disabled={!editable} onChange={(e) => setBatch(b.batch_id, Math.max(0, Math.min(b.balance, Number(e.target.value) || 0)))} className="h-6 w-12 rounded border border-slate-200 px-1" />
                    </label>
                  ))}
                </div>
              )}
          </td>
        </tr>
      )}
    </>
  );
}
