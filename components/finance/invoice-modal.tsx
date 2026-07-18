"use client";

/* Invoice generator — opens from an order row (ledger) or the dashboard
   spotlight. Auto-picks the invoice template by destination:

     • Ontrack (UAE)      → the two-up shipping label (lib/invoice.ts)
     • International (SMSA)→ the itemized customs invoice (lib/invoice-intl.ts),
                            matching the founder's #SA3671 sample

   The template is togglable (a UAE customer can still get the itemized invoice,
   and vice-versa). Ontrack mode auto-applies the founder's paid rendering
   (REMARKS=PAID, AED 30 shipping, TOTAL shows "PAID"). International mode
   lazy-fetches the order's line items to build the item table.

   Two outputs: Download invoice and Print invoice (hidden-iframe → the browser
   print dialog — a web page can't reach a printer any other way). For a non-UAE
   order that already has an SMSA AWB, a third action prints the AWB label as a
   separate document.

   Rendered through a portal into document.body so it escapes every ancestor
   stacking / overflow / opacity context; colors are self-contained hex (the
   finance --tokens live inside .wrap, not at :root). */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Download, FileText, Loader2, Plus, Printer, Trash2, Truck, X } from "lucide-react";
import { toast } from "sonner";
import { COURIER_OPTIONS } from "@/lib/courier";
import {
  intlPrefill, ontrackPrefill, selectInvoiceTemplate,
  type InvoiceTemplate,
} from "@/lib/invoice-fields";
import type { IntlInvoiceItem } from "@/lib/invoice-intl";
import { downloadBlob, printBlob, printUrl } from "@/lib/print";

type OrderForInvoice = {
  uid: string;
  order_number: string;
  order_date: string | null;
  customer_name: string;
  customer_phone: string;
  city: string;
  country: string;
  gateway: string;
  financial_status?: string;
  gross_aed: number;
  currency: string;
  courier?: string;
  awb_number?: string;
  label_url?: string;
};

const field =
  "rounded-lg border border-[#EAE3D6] bg-[#FBF8F1] px-2.5 py-2 text-[13px] text-[#1F1B16] outline-none focus:border-[#B08343]";
const label = "flex flex-col gap-1 text-[11px] font-medium text-[#8A8175]";

const isNonUae = (o: OrderForInvoice) => (o.country || "").trim().toUpperCase() !== "AE";

export function InvoiceModal({ order, onClose, queueRemaining = 0 }: { order: OrderForInvoice; onClose: () => void; queueRemaining?: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [template, setTemplate] = useState<InvoiceTemplate>(() => selectInvoiceTemplate(order.country || ""));
  const [busy, setBusy] = useState<null | "download" | "print" | "awb">(null);

  // ── Ontrack field state (seeded from the shared prefill, incl. paid rules) ─
  const seed = useMemo(() => ontrackPrefill(order), [order]);
  const [ot, setOt] = useState(seed);
  const setOtField = <K extends keyof typeof ot>(k: K, v: (typeof ot)[K]) => setOt((f) => ({ ...f, [k]: v }));
  const paidTotal = ot.totalLabel === "PAID";
  const setPaidTotal = (on: boolean) =>
    setOt((f) => ({ ...f, totalLabel: on ? "PAID" : undefined, remarks: on ? "PAID" : f.remarks === "PAID" ? "" : f.remarks, shipping: on && !f.shipping ? 30 : f.shipping }));

  // ── International field state (populated after the line-item fetch) ─────────
  const [intl, setIntl] = useState<ReturnType<typeof intlPrefill> | null>(null);
  const [intlLoading, setIntlLoading] = useState(false);
  const [intlError, setIntlError] = useState("");

  const loadIntl = useCallback(async () => {
    setIntlLoading(true);
    setIntlError("");
    try {
      const res = await fetch(`/api/orders/${order.uid}`);
      const data = await res.json();
      const detail = data.order || {};
      setIntl(intlPrefill({ ...order, customer_email: detail.customer_email }, detail.line_items || []));
    } catch {
      setIntlError("Couldn't load line items — showing a single summary line.");
      setIntl(intlPrefill(order, []));
    } finally {
      setIntlLoading(false);
    }
  }, [order]);

  // Lazy-load intl data the first time the intl template is active.
  useEffect(() => {
    if (template === "intl" && !intl && !intlLoading) loadIntl();
  }, [template, intl, intlLoading, loadIntl]);

  const cur = order.currency || "AED";
  const ontrackTotal = Number(ot.orderValue || 0) + Number(ot.shipping || 0);
  const intlSubtotal = (intl?.items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
  const intlTotal = intlSubtotal + Number(intl?.shipping || 0);

  const setIntlField = <K extends keyof NonNullable<typeof intl>>(k: K, v: NonNullable<typeof intl>[K]) =>
    setIntl((f) => (f ? { ...f, [k]: v } : f));
  const setItem = (i: number, patch: Partial<IntlInvoiceItem>) =>
    setIntl((f) => (f ? { ...f, items: f.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) } : f));
  const addItem = () =>
    setIntl((f) => (f ? { ...f, items: [...f.items, { itemNo: order.order_number, description: "", qty: 1, unitPrice: 0 }] } : f));
  const removeItem = (i: number) =>
    setIntl((f) => (f ? { ...f, items: f.items.filter((_, idx) => idx !== i) } : f));

  const produce = async (action: "download" | "print") => {
    if (template === "intl" && !intl) return;
    setBusy(action);
    try {
      const body =
        template === "intl"
          ? { template, ...intl }
          : { template, ...ot, orderNumber: order.order_number, total: ontrackTotal, currency: cur };
      const res = await fetch(`/api/orders/${order.uid}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      if (action === "download") {
        downloadBlob(blob, `omnia-invoice-${order.order_number}.pdf`);
        toast.success("Invoice downloaded");
      } else {
        printBlob(blob);
        toast.success("Sent to printer");
      }
      if (action === "download") onClose();
    } catch (e) {
      toast.error(`Invoice failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const printAwb = () => {
    setBusy("awb");
    try {
      printUrl(order.label_url || `/api/orders/${order.uid}/label`);
      toast.success("AWB label sent to printer");
    } finally {
      setBusy(null);
    }
  };

  const hasAwb = Boolean(order.awb_number);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[80] flex items-center justify-center p-5"
        style={{ background: "rgba(31,27,22,.45)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={busy ? undefined : onClose}
      >
        <motion.div
          className="w-full max-w-[600px] max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-[0_24px_60px_rgba(0,0,0,.25)]"
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          onClick={(e) => e.stopPropagation()}
        >
          <header className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-[#EAE3D6] bg-white/95 px-5 py-4 text-sm font-semibold backdrop-blur">
            <span className="inline-flex items-center gap-2 text-[#6F5325]"><FileText size={16} /> Invoice · #{order.order_number}</span>
            {queueRemaining > 0 && (
              <span className="rounded-full bg-[#F3EFE7] px-2.5 py-[3px] text-[11px] font-semibold text-[#8A8175]">{queueRemaining} more queued</span>
            )}
            <button className="ml-auto rounded-md p-1 text-[#8A8175] hover:bg-[#FBF3E6] hover:text-[#6F5325]" onClick={onClose}><X size={16} /></button>
          </header>

          {/* Template toggle */}
          <div className="px-5 pt-4">
            <div className="inline-flex rounded-lg border border-[#EAE3D6] bg-[#FBF8F1] p-0.5 text-[12px] font-medium">
              {(["ontrack", "intl"] as const).map((t) => (
                <button
                  key={t}
                  className={`rounded-[7px] px-3 py-1.5 transition-colors ${template === t ? "bg-[#B08343] text-white" : "text-[#8A8175] hover:text-[#6F5325]"}`}
                  onClick={() => setTemplate(t)}
                >
                  {t === "ontrack" ? "Ontrack (UAE)" : "International"}
                </button>
              ))}
              {template === selectInvoiceTemplate(order.country || "") && (
                <span className="ml-1 self-center pr-2 text-[10.5px] text-[#B0A48F]">auto</span>
              )}
            </div>
          </div>

          {template === "ontrack" ? (
            <>
              <div className="grid grid-cols-2 gap-x-3.5 gap-y-3 px-5 py-4">
                <label className={label}>Invoice No#<input className={field} value={ot.invoiceNo} onChange={(e) => setOtField("invoiceNo", e.target.value)} /></label>
                <label className={label}>Customer ID<input className={field} value={ot.customerId} onChange={(e) => setOtField("customerId", e.target.value)} placeholder="optional" /></label>
                <label className={label}>Date<input className={field} value={ot.date} onChange={(e) => setOtField("date", e.target.value)} /></label>
                <label className={label}>Mobile<input className={field} value={ot.mobile} onChange={(e) => setOtField("mobile", e.target.value)} /></label>
                <label className={`${label} col-span-2`}>Name<input className={field} value={ot.customerName} onChange={(e) => setOtField("customerName", e.target.value)} /></label>
                <label className={`${label} col-span-2`}>Address line 1<input className={field} value={ot.address1} onChange={(e) => setOtField("address1", e.target.value)} placeholder="street, building, apartment" /></label>
                <label className={`${label} col-span-2`}>Address line 2<input className={field} value={ot.address2} onChange={(e) => setOtField("address2", e.target.value)} placeholder="city, country" /></label>
                <label className={`${label} col-span-2`}>Additional notes<input className={field} value={ot.additionalNotes} onChange={(e) => setOtField("additionalNotes", e.target.value)} /></label>
                <label className={`${label} col-span-2`}>Remarks<input className={field} value={ot.remarks} onChange={(e) => setOtField("remarks", e.target.value)} /></label>
                <label className={label}>Order value ({cur})<input className={field} type="number" value={ot.orderValue} onChange={(e) => setOtField("orderValue", Number(e.target.value))} /></label>
                <label className={label}>Shipping ({cur})<input className={field} type="number" value={ot.shipping} onChange={(e) => setOtField("shipping", Number(e.target.value))} /></label>
                <label className={label}>Courier
                  <select className={field} value={ot.courier} onChange={(e) => setOtField("courier", e.target.value)}>
                    {COURIER_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className={label}>Paid
                  <select className={field} value={ot.paid} onChange={(e) => setOtField("paid", e.target.value)}>
                    <option>Yes</option><option>No</option><option>COD</option>
                  </select>
                </label>
                <label className="col-span-2 flex items-center gap-2 text-[12px] font-medium text-[#6F5325]">
                  <input type="checkbox" className="size-4 accent-[#B08343]" checked={paidTotal} onChange={(e) => setPaidTotal(e.target.checked)} />
                  Show TOTAL as “PAID” (paid order — flat AED 30 shipping)
                </label>
              </div>
              <div className="px-5 pb-3.5 text-right text-sm text-[#8A8175]">
                Total: <b className="font-serif text-[17px] text-[#6F5325]">{paidTotal ? "PAID" : `${cur} ${ontrackTotal.toFixed(2)}`}</b>
              </div>
            </>
          ) : (
            <div className="px-5 py-4">
              {intlLoading || !intl ? (
                <div className="flex items-center gap-2 py-8 text-[13px] text-[#8A8175]"><Loader2 size={15} className="animate-spin" /> Loading order items…</div>
              ) : (
                <>
                  {intlError && <div className="mb-3 rounded-lg bg-[#FBF3E6] px-3 py-2 text-[12px] text-[#8A6A2C]">{intlError}</div>}
                  <div className="grid grid-cols-2 gap-x-3.5 gap-y-3">
                    <label className={label}>Invoice #<input className={field} value={intl.invoiceNo} onChange={(e) => setIntlField("invoiceNo", e.target.value)} /></label>
                    <label className={label}>Customer ID<input className={field} value={intl.customerId} onChange={(e) => setIntlField("customerId", e.target.value)} /></label>
                    <label className={label}>Date<input className={field} value={intl.date} onChange={(e) => setIntlField("date", e.target.value)} /></label>
                    <label className={label}>Ship date<input className={field} value={intl.shipDate} onChange={(e) => setIntlField("shipDate", e.target.value)} /></label>
                    <label className={`${label} col-span-2`}>Name (ship &amp; bill to)<input className={field} value={intl.name} onChange={(e) => setIntlField("name", e.target.value)} /></label>
                    <label className={`${label} col-span-2`}>Address<textarea className={`${field} min-h-[52px] resize-y`} value={intl.address} onChange={(e) => setIntlField("address", e.target.value)} /></label>
                    <label className={label}>Tel<input className={field} value={intl.tel} onChange={(e) => setIntlField("tel", e.target.value)} /></label>
                    <label className={label}>Email<input className={field} value={intl.email} onChange={(e) => setIntlField("email", e.target.value)} /></label>
                    <label className={label}>Terms<input className={field} value={intl.terms} onChange={(e) => setIntlField("terms", e.target.value)} /></label>
                    <label className={label}>Shipping (AED)<input className={field} type="number" value={intl.shipping} onChange={(e) => setIntlField("shipping", Number(e.target.value))} /></label>
                  </div>

                  {/* Line items */}
                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#8A8175]">Items</span>
                      <button className="inline-flex items-center gap-1 rounded-md border border-[#EAE3D6] px-2 py-1 text-[11px] font-medium text-[#6F5325] hover:bg-[#FBF3E6]" onClick={addItem}><Plus size={12} /> Add</button>
                    </div>
                    <div className="flex flex-col gap-2">
                      {intl.items.map((it, i) => (
                        <div key={i} className="grid grid-cols-[1fr_54px_80px_24px] items-center gap-2">
                          <input className={field} value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} placeholder="description — origin note" />
                          <input className={`${field} text-center`} type="number" value={it.qty} onChange={(e) => setItem(i, { qty: Number(e.target.value) })} title="qty" />
                          <input className={`${field} text-right`} type="number" value={it.unitPrice} onChange={(e) => setItem(i, { unitPrice: Number(e.target.value) })} title="unit price AED" />
                          <button className="flex size-6 items-center justify-center rounded-md text-[#B0A48F] hover:bg-[#F9ECE7] hover:text-[#A6472F]" onClick={() => removeItem(i)} title="remove"><Trash2 size={13} /></button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col items-end gap-0.5 border-t border-dashed border-[#EAE3D6] pt-3 text-[13px] text-[#8A8175]">
                    <div>Subtotal: <b className="text-[#1F1B16]">AED {intlSubtotal.toFixed(2)}</b></div>
                    <div>Total: <b className="font-serif text-[17px] text-[#6F5325]">AED {intlTotal.toFixed(2)}</b></div>
                  </div>
                </>
              )}
            </div>
          )}

          <footer className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2.5 border-t border-[#EAE3D6] bg-white/95 px-5 py-3.5 backdrop-blur">
            {isNonUae(order) && (
              <button
                className="mr-auto inline-flex items-center gap-1.5 rounded-lg border border-[#D6CCBA] bg-transparent px-[13px] py-2 text-[13px] font-medium text-[#1F1B16] disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!hasAwb || busy !== null}
                onClick={printAwb}
                title={hasAwb ? "Print the SMSA AWB label" : "Ship this order first to get an AWB"}
              >
                <Truck size={14} /> Print AWB{hasAwb ? ` · ${order.awb_number}` : ""}
              </button>
            )}
            <button className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6CCBA] bg-transparent px-[15px] py-2 text-[13px] font-medium text-[#1F1B16]" onClick={onClose} disabled={busy !== null}>Cancel</button>
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6CCBA] bg-transparent px-[15px] py-2 text-[13px] font-medium text-[#1F1B16] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy !== null || (template === "intl" && !intl)}
              onClick={() => produce("download")}
            >
              {busy === "download" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#B08343] bg-[#B08343] px-[15px] py-2 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy !== null || (template === "intl" && !intl)}
              onClick={() => produce("print")}
            >
              {busy === "print" ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} Print invoice
            </button>
          </footer>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
