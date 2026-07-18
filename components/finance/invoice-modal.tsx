"use client";

/* Editable Ontrack-style invoice generator. Opens from an order row (ledger)
   or the dashboard spotlight, prefills what the order has (name, phone,
   city/country, order value), and collects what it doesn't (street address,
   a customer ID) before generating the PDF — see lib/invoice.ts for why those
   fields aren't auto-filled.

   Rendered through a portal into document.body so it escapes every ancestor
   stacking / overflow / opacity context (the dashboard dims .dash while it
   loads) — that's what makes it open reliably wherever it's triggered.
   Colors are self-contained hex (the finance --tokens live inside .wrap, not
   at :root, so a portaled node can't read them). */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, Loader2, Printer, X } from "lucide-react";
import { toast } from "sonner";
import { COURIER_OPTIONS, defaultCourier } from "@/lib/courier";

type OrderForInvoice = {
  uid: string;
  order_number: string;
  order_date: string | null;
  customer_name: string;
  customer_phone: string;
  city: string;
  country: string;
  gateway: string;
  gross_aed: number;
  currency: string;
};

const field =
  "rounded-lg border border-[#EAE3D6] bg-[#FBF8F1] px-2.5 py-2 text-[13px] text-[#1F1B16] outline-none focus:border-[#B08343]";
const label = "flex flex-col gap-1 text-[11px] font-medium text-[#8A8175]";

export function InvoiceModal({ order, onClose, queueRemaining = 0 }: { order: OrderForInvoice; onClose: () => void; queueRemaining?: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [fields, setFields] = useState({
    invoiceNo: order.order_number,
    customerId: "",
    date: order.order_date ? new Date(order.order_date).toLocaleDateString("en-GB") : new Date().toLocaleDateString("en-GB"),
    customerName: order.customer_name || "",
    address1: "",
    address2: [order.city, order.country].filter(Boolean).join(", "),
    mobile: order.customer_phone || "",
    additionalNotes: "",
    remarks: "",
    orderValue: order.gross_aed,
    shipping: 0,
    paid: order.gateway === "COD" ? "COD" : "Yes",
    courier: defaultCourier(order.country || "") as string,
  });
  const [generating, setGenerating] = useState(false);

  const set = <K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  const total = Number(fields.orderValue || 0) + Number(fields.shipping || 0);
  const cur = order.currency || "AED";

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/orders/${order.uid}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, orderNumber: order.order_number, total, currency: cur }),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `omnia-invoice-${order.order_number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Invoice generated");
      onClose();
    } catch (e) {
      toast.error(`Invoice generation failed: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  };

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
        onClick={onClose}
      >
        <motion.div
          className="w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-[0_24px_60px_rgba(0,0,0,.25)]"
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex items-center gap-2.5 border-b border-[#EAE3D6] px-5 py-4 text-sm font-semibold">
            <span className="inline-flex items-center gap-2 text-[#6F5325]"><FileText size={16} /> Invoice · #{order.order_number}</span>
            {queueRemaining > 0 && (
              <span className="rounded-full bg-[#F3EFE7] px-2.5 py-[3px] text-[11px] font-semibold text-[#8A8175]">{queueRemaining} more queued</span>
            )}
            <button className="ml-auto rounded-md p-1 text-[#8A8175] hover:bg-[#FBF3E6] hover:text-[#6F5325]" onClick={onClose}><X size={16} /></button>
          </header>

          <div className="grid grid-cols-2 gap-x-3.5 gap-y-3 px-5 py-[18px]">
            <label className={label}>Invoice No#<input className={field} value={fields.invoiceNo} onChange={(e) => set("invoiceNo", e.target.value)} /></label>
            <label className={label}>Customer ID<input className={field} value={fields.customerId} onChange={(e) => set("customerId", e.target.value)} placeholder="optional" /></label>
            <label className={label}>Date<input className={field} value={fields.date} onChange={(e) => set("date", e.target.value)} /></label>
            <label className={label}>Mobile<input className={field} value={fields.mobile} onChange={(e) => set("mobile", e.target.value)} /></label>
            <label className={`${label} col-span-2`}>Name<input className={field} value={fields.customerName} onChange={(e) => set("customerName", e.target.value)} /></label>
            <label className={`${label} col-span-2`}>Address line 1<input className={field} value={fields.address1} onChange={(e) => set("address1", e.target.value)} placeholder="street, building, apartment" /></label>
            <label className={`${label} col-span-2`}>Address line 2<input className={field} value={fields.address2} onChange={(e) => set("address2", e.target.value)} placeholder="city, country" /></label>
            <label className={`${label} col-span-2`}>Additional notes<input className={field} value={fields.additionalNotes} onChange={(e) => set("additionalNotes", e.target.value)} /></label>
            <label className={`${label} col-span-2`}>Remarks<input className={field} value={fields.remarks} onChange={(e) => set("remarks", e.target.value)} /></label>

            <label className={label}>Order value ({cur})
              <input className={field} type="number" value={fields.orderValue} onChange={(e) => set("orderValue", Number(e.target.value))} />
            </label>
            <label className={label}>Shipping ({cur})
              <input className={field} type="number" value={fields.shipping} onChange={(e) => set("shipping", Number(e.target.value))} />
            </label>

            <label className={label}>Courier
              <select className={field} value={fields.courier} onChange={(e) => set("courier", e.target.value)}>
                {COURIER_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className={label}>Paid
              <select className={field} value={fields.paid} onChange={(e) => set("paid", e.target.value)}>
                <option>Yes</option><option>No</option><option>COD</option>
              </select>
            </label>
          </div>

          <div className="px-5 pb-3.5 text-right text-sm text-[#8A8175]">
            Total: <b className="font-serif text-[17px] text-[#6F5325]">{cur} {total.toFixed(2)}</b>
          </div>

          <footer className="flex justify-end gap-2.5 border-t border-[#EAE3D6] px-5 py-3.5">
            <button className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6CCBA] bg-transparent px-[15px] py-2 text-[13px] font-medium text-[#1F1B16]" onClick={onClose}>Cancel</button>
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#B08343] bg-[#B08343] px-[15px] py-2 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={generating}
              onClick={generate}
            >
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
              {generating ? "Generating…" : "Generate PDF"}
            </button>
          </footer>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
