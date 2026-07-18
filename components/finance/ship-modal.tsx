"use client";

/* SMSA "Confirm Ship" modal — a real external side effect (SMSA issues an
   actual AWB), so it only ever fires from an explicit button click, never
   from opening a row. City is a dropdown sourced from SMSA's own list — free
   text is never accepted, since SMSA silently rejects or misroutes
   unrecognized city strings.

   Portaled to document.body (see invoice-modal for why) with self-contained
   hex colors. */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Loader2, Printer, Truck, X } from "lucide-react";
import { toast } from "sonner";

type ShippableOrder = {
  uid: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  city: string;
  country: string;
  gateway: string;
  gross_aed: number;
  currency: string;
};

type SubmitState = "idle" | "submitting" | "success" | "error";

const field =
  "rounded-lg border border-[#EAE3D6] bg-[#FBF8F1] px-2.5 py-2 text-[13px] text-[#1F1B16] outline-none focus:border-[#B08343] disabled:opacity-70";
const label = "flex flex-col gap-1 text-[11px] font-medium text-[#8A8175]";

export function ShipModal({ order, onClose, onShipped }: {
  order: ShippableOrder;
  onClose: () => void;
  onShipped: (awb: string, labelUrl: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [cities, setCities] = useState<string[]>([]);
  const [city, setCity] = useState("");
  const [weight, setWeight] = useState("");
  const [packageCount, setPackageCount] = useState(1);
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState([order.city, order.country].filter(Boolean).join(", "));
  const [state, setState] = useState<SubmitState>("idle");
  const [error, setError] = useState("");
  const [awb, setAwb] = useState("");
  const [labelUrl, setLabelUrl] = useState("");

  const isCod = order.gateway === "COD";

  useEffect(() => {
    fetch("/api/smsa/cities")
      .then((r) => r.json())
      .then((d) => setCities((d.cities ?? []).map((c: { city: string }) => c.city).sort()))
      .catch(() => setCities([]));
  }, []);

  const submit = async () => {
    if (!city) { setError("Pick a city from the list."); setState("error"); return; }
    if (!weight || Number(weight) <= 0) { setError("Package weight is required."); setState("error"); return; }

    setState("submitting");
    setError("");
    try {
      const res = await fetch(`/api/orders/${order.uid}/ship`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weight: Number(weight), packageCount, city, address1, address2,
          codAmount: isCod ? order.gross_aed : undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || `HTTP ${res.status}`);
      setAwb(json.awb);
      setLabelUrl(json.labelUrl);
      setState("success");
      onShipped(json.awb, json.labelUrl);
      toast.success(`AWB ${json.awb} issued`);
      setTimeout(onClose, 4000);
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  };

  const locked = state === "submitting" || state === "success";

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
        onClick={locked ? undefined : onClose}
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
            <span className="inline-flex items-center gap-2 text-[#6F5325]"><Truck size={16} /> Ship via SMSA · #{order.order_number}</span>
            {!locked && <button className="ml-auto rounded-md p-1 text-[#8A8175] hover:bg-[#FBF3E6] hover:text-[#6F5325]" onClick={onClose}><X size={16} /></button>}
          </header>

          {state === "success" ? (
            <div className="flex flex-col items-center gap-2.5 px-5 pb-[26px] pt-[30px] text-center">
              <motion.div
                className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#F0F5EF] text-[#4B7A54]"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 15 }}
              >
                <Truck size={22} />
              </motion.div>
              <div className="font-serif text-[19px] text-[#1F1B16]">AWB {awb}</div>
              <p className="text-[13px] text-[#8A8175]">Shipment issued. Label is ready to print.</p>
              <a className="inline-flex items-center gap-1.5 rounded-lg border border-[#B08343] bg-[#B08343] px-[15px] py-2 text-[13px] font-medium text-white" href={labelUrl} target="_blank" rel="noreferrer">
                <Printer size={14} /> Print Label
              </a>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-3.5 gap-y-3 px-5 pb-3 pt-[18px]">
                <label className={`${label} col-span-2`}>Customer<input className={field} value={order.customer_name} disabled /></label>
                <label className={`${label} col-span-2`}>Phone<input className={field} value={order.customer_phone} disabled /></label>
                <label className={`${label} col-span-2`}>Address line 1
                  <input className={field} value={address1} onChange={(e) => setAddress1(e.target.value)} placeholder="street, building, apartment" disabled={locked} />
                </label>
                <label className={`${label} col-span-2`}>Address line 2
                  <input className={field} value={address2} onChange={(e) => setAddress2(e.target.value)} disabled={locked} />
                </label>
                <label className={`${label} col-span-2`}>City (SMSA-recognized only)
                  <select className={field} value={city} onChange={(e) => setCity(e.target.value)} disabled={locked}>
                    <option value="">{cities.length ? "Select a city…" : "Loading cities…"}</option>
                    {cities.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className={label}>Weight (kg)<input className={field} type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} disabled={locked} /></label>
                <label className={label}>Packages<input className={field} type="number" min={1} value={packageCount} onChange={(e) => setPackageCount(Number(e.target.value))} disabled={locked} /></label>
                {isCod && (
                  <label className={`${label} col-span-2`}>COD amount (read-only)
                    <input className={field} value={`${order.currency} ${order.gross_aed.toFixed(2)}`} disabled />
                  </label>
                )}
                <label className={`${label} col-span-2`}>Reference (order uid, fixed)
                  <input className={field} value={order.uid} disabled />
                </label>
              </div>

              {state === "error" && (
                <div className="mx-5 mb-3.5 flex items-start gap-2 rounded-lg bg-[#F9ECE7] px-3 py-2.5 text-[12.5px] text-[#A6472F]">
                  <AlertTriangle size={14} />
                  <span>{error}</span>
                </div>
              )}

              <footer className="flex justify-end gap-2.5 border-t border-[#EAE3D6] px-5 py-3.5">
                <button className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6CCBA] bg-transparent px-[15px] py-2 text-[13px] font-medium text-[#1F1B16] disabled:opacity-60" onClick={onClose} disabled={locked}>Cancel</button>
                <button
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#B08343] bg-[#B08343] px-[15px] py-2 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={locked}
                  onClick={submit}
                >
                  {state === "submitting" ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
                  {state === "submitting" ? "Shipping…" : "Confirm Ship"}
                </button>
              </footer>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
