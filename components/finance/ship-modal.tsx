"use client";

/* SMSA "Confirm Ship" modal — a real external side effect (SMSA issues an
   actual AWB), so it only ever fires from an explicit button click, never
   from opening a row. City is a dropdown sourced from SMSA's own list —
   free text is never accepted, since SMSA silently rejects or misroutes
   unrecognized city strings. */

import { useEffect, useState } from "react";
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

export function ShipModal({ order, onClose, onShipped }: {
  order: ShippableOrder;
  onClose: () => void;
  onShipped: (awb: string, labelUrl: string) => void;
}) {
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

  return (
    <AnimatePresence>
      <motion.div className="inv-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={locked ? undefined : onClose}>
        <motion.div
          className="inv-modal ship-modal"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
        >
          <header>
            <span><Truck size={16} /> Ship via SMSA · #{order.order_number}</span>
            {!locked && <button className="icon-btn" onClick={onClose}><X size={16} /></button>}
          </header>

          {state === "success" ? (
            <div className="ship-success">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 15 }} className="awb-badge">
                <Truck size={22} />
              </motion.div>
              <div className="awb-number">AWB {awb}</div>
              <p className="quiet">Shipment issued. Label is ready to print.</p>
              <a className="btn primary" href={labelUrl} target="_blank" rel="noreferrer">
                <Printer size={14} /> Print Label
              </a>
            </div>
          ) : (
            <>
              <div className="inv-grid">
                <label className="span2">Customer<input value={order.customer_name} disabled /></label>
                <label className="span2">Phone<input value={order.customer_phone} disabled /></label>
                <label className="span2">Address line 1
                  <input value={address1} onChange={(e) => setAddress1(e.target.value)} placeholder="street, building, apartment" disabled={locked} />
                </label>
                <label className="span2">Address line 2
                  <input value={address2} onChange={(e) => setAddress2(e.target.value)} disabled={locked} />
                </label>
                <label className="span2">City (SMSA-recognized only)
                  <select value={city} onChange={(e) => setCity(e.target.value)} disabled={locked}>
                    <option value="">{cities.length ? "Select a city…" : "Loading cities…"}</option>
                    {cities.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label>Weight (kg)<input type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} disabled={locked} /></label>
                <label>Packages<input type="number" min={1} value={packageCount} onChange={(e) => setPackageCount(Number(e.target.value))} disabled={locked} /></label>
                {isCod && (
                  <label className="span2">COD amount (read-only)
                    <input value={`${order.currency} ${order.gross_aed.toFixed(2)}`} disabled />
                  </label>
                )}
                <label className="span2">Reference (order uid, fixed)
                  <input value={order.uid} disabled />
                </label>
              </div>

              {state === "error" && (
                <div className="ship-error">
                  <AlertTriangle size={14} />
                  <span>{error}</span>
                </div>
              )}

              <footer>
                <button className="btn ghost" onClick={onClose} disabled={locked}>Cancel</button>
                <button className="btn primary" disabled={locked} onClick={submit}>
                  {state === "submitting" ? <Loader2 size={14} className="spin" /> : <Truck size={14} />}
                  {state === "submitting" ? "Shipping…" : "Confirm Ship"}
                </button>
              </footer>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export const SHIP_MODAL_CSS = `
  .ship-modal .inv-grid { padding-top: 18px; }
  .ship-error { display: flex; align-items: flex-start; gap: 8px; margin: 0 20px 14px; padding: 10px 12px; background: var(--bad-wash); color: var(--bad); border-radius: 8px; font-size: 12.5px; }
  .ship-success { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 30px 20px 26px; text-align: center; }
  .awb-badge { width: 52px; height: 52px; border-radius: 50%; background: var(--ok-wash); color: var(--ok); display: flex; align-items: center; justify-content: center; }
  .awb-number { font-family: Georgia, serif; font-size: 19px; color: var(--ink); }
`;
