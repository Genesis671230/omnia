"use client";

/* Editable Ontrack-style invoice generator. Opens from an order row, prefills
   what the order actually has (name, phone, city/country, order value), and
   collects what it doesn't (street address, a customer ID) before generating
   the PDF — see lib/invoice.ts for why those fields aren't auto-filled. */

import { useState } from "react";
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

export function InvoiceModal({ order, onClose }: { order: OrderForInvoice; onClose: () => void }) {
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

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/orders/${order.uid}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, orderNumber: order.order_number, total, currency: order.currency || "AED" }),
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

  return (
    <AnimatePresence>
      <motion.div className="inv-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
        <motion.div
          className="inv-modal"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
        >
          <header>
            <span><FileText size={16} /> Invoice · #{order.order_number}</span>
            <button className="icon-btn" onClick={onClose}><X size={16} /></button>
          </header>

          <div className="inv-grid">
            <label>Invoice No#<input value={fields.invoiceNo} onChange={(e) => set("invoiceNo", e.target.value)} /></label>
            <label>Customer ID<input value={fields.customerId} onChange={(e) => set("customerId", e.target.value)} placeholder="optional" /></label>
            <label>Date<input value={fields.date} onChange={(e) => set("date", e.target.value)} /></label>
            <label>Mobile<input value={fields.mobile} onChange={(e) => set("mobile", e.target.value)} /></label>
            <label className="span2">Name<input value={fields.customerName} onChange={(e) => set("customerName", e.target.value)} /></label>
            <label className="span2">Address line 1<input value={fields.address1} onChange={(e) => set("address1", e.target.value)} placeholder="street, building, apartment" /></label>
            <label className="span2">Address line 2<input value={fields.address2} onChange={(e) => set("address2", e.target.value)} placeholder="city, country" /></label>
            <label className="span2">Additional notes<input value={fields.additionalNotes} onChange={(e) => set("additionalNotes", e.target.value)} /></label>
            <label className="span2">Remarks<input value={fields.remarks} onChange={(e) => set("remarks", e.target.value)} /></label>

            <label>Order value ({order.currency || "AED"})
              <input type="number" value={fields.orderValue} onChange={(e) => set("orderValue", Number(e.target.value))} />
            </label>
            <label>Shipping ({order.currency || "AED"})
              <input type="number" value={fields.shipping} onChange={(e) => set("shipping", Number(e.target.value))} />
            </label>

            <label>Courier
              <select value={fields.courier} onChange={(e) => set("courier", e.target.value)}>
                {COURIER_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>Paid
              <select value={fields.paid} onChange={(e) => set("paid", e.target.value)}>
                <option>Yes</option><option>No</option><option>COD</option>
              </select>
            </label>
          </div>

          <div className="inv-total">Total: <b>{order.currency || "AED"} {total.toFixed(2)}</b></div>

          <footer>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={generating} onClick={generate}>
              {generating ? <Loader2 size={14} className="spin" /> : <Printer size={14} />}
              {generating ? "Generating…" : "Generate PDF"}
            </button>
          </footer>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export const INVOICE_MODAL_CSS = `
  .inv-overlay { position: fixed; inset: 0; background: rgba(31,27,22,.45); display: flex; align-items: center; justify-content: center; z-index: 60; padding: 20px; }
  .inv-modal { background: var(--card); border-radius: 16px; width: 100%; max-width: 560px; max-height: 90vh; overflow-y: auto; box-shadow: 0 24px 60px rgba(0,0,0,.25); }
  .inv-modal header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--line); font-weight: 600; font-size: 14px; }
  .inv-modal header span { display: inline-flex; align-items: center; gap: 8px; color: var(--gold-deep); }
  .icon-btn { border: 0; background: transparent; cursor: pointer; color: var(--muted); padding: 4px; border-radius: 6px; }
  .icon-btn:hover { background: var(--gold-wash); color: var(--gold-deep); }
  .inv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 14px; padding: 18px 20px; }
  .inv-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--muted); font-weight: 500; }
  .inv-grid label.span2 { grid-column: span 2; }
  .inv-grid input, .inv-grid select { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 13px; color: var(--ink); background: var(--cream); }
  .inv-grid input:focus, .inv-grid select:focus { outline: none; border-color: var(--gold); }
  .inv-total { padding: 0 20px 14px; text-align: right; font-size: 14px; color: var(--muted); }
  .inv-total b { color: var(--gold-deep); font-size: 17px; font-family: Georgia, serif; }
  .inv-modal footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--line); }
  .btn.ghost { background: transparent; border: 1px solid var(--line-strong); color: var(--ink); }
  .btn.primary { background: var(--gold); border-color: var(--gold); color: #fff; }
  .btn.primary:disabled { opacity: .6; cursor: not-allowed; }
`;
