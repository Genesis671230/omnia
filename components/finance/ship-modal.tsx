// "use client";

// /* SMSA "Confirm Ship" modal — a real external side effect (SMSA issues an
//    actual AWB), so it only ever fires from an explicit button click, never
//    from opening a row. City is a dropdown sourced from SMSA's own list — free
//    text is never accepted, since SMSA silently rejects or misroutes
//    unrecognized city strings.

//    Portaled to document.body (see invoice-modal for why) with self-contained
//    hex colors. */

// import { useEffect, useState } from "react";
// import { createPortal } from "react-dom";
// import { AnimatePresence, motion } from "framer-motion";
// import { AlertTriangle, Loader2, Printer, Truck, X } from "lucide-react";
// import { toast } from "sonner";

// type ShippableOrder = {
//   uid: string;
//   order_number: string;
//   customer_name: string;
//   customer_phone: string;
//   city: string;
//   country: string;
//   gateway: string;
//   gross_aed: number;
//   currency: string;
// };

// type SubmitState = "idle" | "submitting" | "success" | "error";

// const field =
//   "rounded-lg border border-[#EAE3D6] bg-[#FBF8F1] px-2.5 py-2 text-[13px] text-[#1F1B16] outline-none focus:border-[#B08343] disabled:opacity-70";
// const label = "flex flex-col gap-1 text-[11px] font-medium text-[#8A8175]";

// export function ShipModal({ order, onClose, onShipped }: {
//   order: ShippableOrder;
//   onClose: () => void;
//   onShipped: (awb: string, labelUrl: string) => void;
// }) {
//   const [mounted, setMounted] = useState(false);
//   useEffect(() => setMounted(true), []);

//   const [cities, setCities] = useState<string[]>([]);
//   const [city, setCity] = useState("");
//   const [weight, setWeight] = useState("");
//   const [packageCount, setPackageCount] = useState(1);
//   const [address1, setAddress1] = useState("");
//   const [address2, setAddress2] = useState([order.city, order.country].filter(Boolean).join(", "));
//   const [state, setState] = useState<SubmitState>("idle");
//   const [error, setError] = useState("");
//   const [awb, setAwb] = useState("");
//   const [labelUrl, setLabelUrl] = useState("");

//   const isCod = order.gateway === "COD";

//   useEffect(() => {
//     fetch("/api/smsa/cities")
//       .then((r) => r.json())
//       .then((d) => setCities((d.cities ?? []).map((c: { city: string }) => c.city).sort()))
//       .catch(() => setCities([]));
//   }, []);

//   const submit = async () => {
//     if (!city) { setError("Pick a city from the list."); setState("error"); return; }
//     if (!weight || Number(weight) <= 0) { setError("Package weight is required."); setState("error"); return; }

//     setState("submitting");
//     setError("");
//     try {
//       const res = await fetch(`/api/orders/${order.uid}/ship`, {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           weight: Number(weight), packageCount, city, address1, address2,
//           codAmount: isCod ? order.gross_aed : undefined,
//         }),
//       });
//       const json = await res.json();
//       if (!json.success) throw new Error(json.error || `HTTP ${res.status}`);
//       setAwb(json.awb);
//       setLabelUrl(json.labelUrl);
//       setState("success");
//       onShipped(json.awb, json.labelUrl);
//       toast.success(`AWB ${json.awb} issued`);
//       setTimeout(onClose, 4000);
//     } catch (e) {
//       setError((e as Error).message);
//       setState("error");
//     }
//   };

//   const locked = state === "submitting" || state === "success";

//   if (!mounted) return null;

//   return createPortal(
//     <AnimatePresence>
//       <motion.div
//         className="fixed inset-0 z-[80] flex items-center justify-center p-5"
//         style={{ background: "rgba(31,27,22,.45)" }}
//         initial={{ opacity: 0 }}
//         animate={{ opacity: 1 }}
//         exit={{ opacity: 0 }}
//         transition={{ duration: 0.18 }}
//         onClick={locked ? undefined : onClose}
//       >
//         <motion.div
//           className="w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-[0_24px_60px_rgba(0,0,0,.25)]"
//           initial={{ opacity: 0, y: 16, scale: 0.98 }}
//           animate={{ opacity: 1, y: 0, scale: 1 }}
//           exit={{ opacity: 0, y: 16, scale: 0.98 }}
//           transition={{ duration: 0.2, ease: "easeOut" }}
//           onClick={(e) => e.stopPropagation()}
//         >
//           <header className="flex items-center gap-2.5 border-b border-[#EAE3D6] px-5 py-4 text-sm font-semibold">
//             <span className="inline-flex items-center gap-2 text-[#6F5325]"><Truck size={16} /> Ship via SMSA · #{order.order_number}</span>
//             {!locked && <button className="ml-auto rounded-md p-1 text-[#8A8175] hover:bg-[#FBF3E6] hover:text-[#6F5325]" onClick={onClose}><X size={16} /></button>}
//           </header>

//           {state === "success" ? (
//             <div className="flex flex-col items-center gap-2.5 px-5 pb-[26px] pt-[30px] text-center">
//               <motion.div
//                 className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#F0F5EF] text-[#4B7A54]"
//                 initial={{ scale: 0 }}
//                 animate={{ scale: 1 }}
//                 transition={{ type: "spring", stiffness: 400, damping: 15 }}
//               >
//                 <Truck size={22} />
//               </motion.div>
//               <div className="font-serif text-[19px] text-[#1F1B16]">AWB {awb}</div>
//               <p className="text-[13px] text-[#8A8175]">Shipment issued. Label is ready to print.</p>
//               <a className="inline-flex items-center gap-1.5 rounded-lg border border-[#B08343] bg-[#B08343] px-[15px] py-2 text-[13px] font-medium text-white" href={labelUrl} target="_blank" rel="noreferrer">
//                 <Printer size={14} /> Print Label
//               </a>
//             </div>
//           ) : (
//             <>
//               <div className="grid grid-cols-2 gap-x-3.5 gap-y-3 px-5 pb-3 pt-[18px]">
//                 <label className={`${label} col-span-2`}>Customer<input className={field} value={order.customer_name} disabled /></label>
//                 <label className={`${label} col-span-2`}>Phone<input className={field} value={order.customer_phone} disabled /></label>
//                 <label className={`${label} col-span-2`}>Address line 1
//                   <input className={field} value={address1} onChange={(e) => setAddress1(e.target.value)} placeholder="street, building, apartment" disabled={locked} />
//                 </label>
//                 <label className={`${label} col-span-2`}>Address line 2
//                   <input className={field} value={address2} onChange={(e) => setAddress2(e.target.value)} disabled={locked} />
//                 </label>
//                 <label className={`${label} col-span-2`}>City (SMSA-recognized only)
//                   <select className={field} value={city} onChange={(e) => setCity(e.target.value)} disabled={locked}>
//                     <option value="">{cities.length ? "Select a city…" : "Loading cities…"}</option>
//                     {cities.map((c) => <option key={c} value={c}>{c}</option>)}
//                   </select>
//                 </label>
//                 <label className={label}>Weight (kg)<input className={field} type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} disabled={locked} /></label>
//                 <label className={label}>Packages<input className={field} type="number" min={1} value={packageCount} onChange={(e) => setPackageCount(Number(e.target.value))} disabled={locked} /></label>
//                 {isCod && (
//                   <label className={`${label} col-span-2`}>COD amount (read-only)
//                     <input className={field} value={`${order.currency} ${order.gross_aed.toFixed(2)}`} disabled />
//                   </label>
//                 )}
//                 <label className={`${label} col-span-2`}>Reference (order uid, fixed)
//                   <input className={field} value={order.uid} disabled />
//                 </label>
//               </div>

//               {state === "error" && (
//                 <div className="mx-5 mb-3.5 flex items-start gap-2 rounded-lg bg-[#F9ECE7] px-3 py-2.5 text-[12.5px] text-[#A6472F]">
//                   <AlertTriangle size={14} />
//                   <span>{error}</span>
//                 </div>
//               )}

//               <footer className="flex justify-end gap-2.5 border-t border-[#EAE3D6] px-5 py-3.5">
//                 <button className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6CCBA] bg-transparent px-[15px] py-2 text-[13px] font-medium text-[#1F1B16] disabled:opacity-60" onClick={onClose} disabled={locked}>Cancel</button>
//                 <button
//                   className="inline-flex items-center gap-1.5 rounded-lg border border-[#B08343] bg-[#B08343] px-[15px] py-2 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
//                   disabled={locked}
//                   onClick={submit}
//                 >
//                   {state === "submitting" ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
//                   {state === "submitting" ? "Shipping…" : "Confirm Ship"}
//                 </button>
//               </footer>
//             </>
//           )}
//         </motion.div>
//       </motion.div>
//     </AnimatePresence>,
//     document.body,
//   );
// }





"use client";

/* SMSA "Confirm Ship" modal — Vault restyle. Same real side-effect core:
   SMSA issues an actual AWB, so it only fires on an explicit Confirm click;
   city is a dropdown from SMSA's own list (free text is silently misrouted).

   New: the success state carries follow-on actions, so the operator can push
   the freshly-shipped order to Zoho Books or mark it settled without hunting
   for the row again. Portaled to document.body; self-contained hex colors. */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowUpRight, ExternalLink, Loader2, Printer, Truck, X } from "lucide-react";
import { toast } from "sonner";
import { useOrderActions, type ZohoState } from "@/lib/hooks/use-order-actions";

type ShippableOrder = {
  uid: string; order_number: string; customer_name: string; customer_phone: string;
  city: string; country: string; gateway: string; gross_aed: number; currency: string;
};
type SubmitState = "idle" | "submitting" | "success" | "error";

const C = {
  card: "#FFFFFF", raise: "#FBF8F1", line: "#EBE5D6", line2: "#DED6C2",
  ink: "#1C1913", body: "#5C5647", dim: "#8C8574", faint: "#B0A896",
  mint: "#3E8F63", mintBg: "#E7F1EA", mintEdge: "#BEDDC9",
  coral: "#C15540", coralBg: "#F7E7E1",
  gild: "#9A7526", gildSoft: "#B08A3C",
};
const field = "vault-sfield";
const labelCls = "vault-slabel";

export function ShipModal({ order, onClose, onShipped }: {
  order: ShippableOrder; onClose: () => void; onShipped: (awb: string, labelUrl: string) => void;
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

  const actions = useOrderActions(order.uid);
  const [zoho, setZoho] = useState<ZohoState>(null);
  const isCod = order.gateway === "COD";

  useEffect(() => {
    fetch("/api/smsa/cities").then((r) => r.json())
      .then((d) => setCities((d.cities ?? []).map((c: { city: string }) => c.city).sort()))
      .catch(() => setCities([]));
  }, []);

  const submit = async () => {
    if (!city) { setError("Pick a city from the list."); setState("error"); return; }
    if (!weight || Number(weight) <= 0) { setError("Package weight is required."); setState("error"); return; }
    setState("submitting"); setError("");
    try {
      const res = await fetch(`/api/orders/${order.uid}/ship`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weight: Number(weight), packageCount, city, address1, address2, codAmount: isCod ? order.gross_aed : undefined }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || `HTTP ${res.status}`);
      setAwb(json.awb); setLabelUrl(json.labelUrl); setState("success");
      onShipped(json.awb, json.labelUrl);
      toast.success(`AWB ${json.awb} issued`);
    } catch (e) { setError((e as Error).message); setState("error"); }
  };

  const locked = state === "submitting" || state === "success";
  const wrap = <T,>(p: Promise<T>, ok: string) => p.then((v) => { toast.success(ok); return v; }).catch((e: Error) => { toast.error(e.message); return undefined as T | undefined; });

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(28,25,19,.5)", backdropFilter: "blur(2px)" }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={locked ? undefined : onClose}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500&display=swap');
          .vault-sfield{border-radius:10px;border:1px solid ${C.line};background:${C.raise};padding:8px 10px;font-size:13px;color:${C.ink};outline:none;width:100%;}
          .vault-sfield:focus{border-color:${C.gildSoft};box-shadow:0 0 0 3px rgba(154,117,38,.1);}
          .vault-sfield:disabled{opacity:.7}
          .vault-slabel{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:600;color:${C.dim};}
          .vspin{animation:vsp2 1s linear infinite}@keyframes vsp2{to{transform:rotate(360deg)}}
        `}</style>

        <motion.div style={{ width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", borderRadius: 22, background: C.card, boxShadow: "0 30px 70px rgba(28,25,19,.35)", fontFamily: "'Inter',system-ui,sans-serif" }}
          initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }} transition={{ duration: 0.2, ease: "easeOut" }} onClick={(e) => e.stopPropagation()}>

          <header style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${C.line}`, padding: "16px 20px", fontWeight: 600, fontSize: 14 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: C.gild }}><Truck size={16} /> Ship via SMSA</span>
            <span style={{ fontFamily: "monospace", fontSize: 12.5, color: C.dim }}>#{order.order_number}</span>
            {!locked && <button style={{ marginLeft: "auto", borderRadius: 8, padding: 5, color: C.dim, background: "none", border: "none", cursor: "pointer" }} onClick={onClose}><X size={16} /></button>}
          </header>

          {state === "success" ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "30px 20px 26px", textAlign: "center" }}>
              <motion.div style={{ display: "flex", width: 52, height: 52, alignItems: "center", justifyContent: "center", borderRadius: "50%", background: C.mintBg, color: C.mint }}
                initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 15 }}><Truck size={22} /></motion.div>
              <div style={{ fontFamily: "'Newsreader',serif", fontSize: 22, color: C.ink }}>AWB {awb}</div>
              <p style={{ fontSize: 13, color: C.dim, margin: 0 }}>Shipment issued. Label is ready to print.</p>

              <a href={labelUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 10, border: `1px solid ${C.gild}`, background: C.gild, padding: "9px 15px", fontSize: 13, fontWeight: 600, color: "#fff", textDecoration: "none" }}>
                <Printer size={14} /> Print label
              </a>

              {/* follow-on actions */}
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                {zoho?.invoiceId ? (
                  <a href={zoho.invoiceUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 10, border: `1px solid ${C.line2}`, background: "rgba(154,117,38,.08)", padding: "8px 13px", fontSize: 12.5, fontWeight: 600, color: C.gild, textDecoration: "none" }}>
                    <ExternalLink size={13} /> Zoho · {zoho.invoiceId}
                  </a>
                ) : (
                  <button onClick={() => wrap(actions.pushToZoho(), "Pushed to Zoho Books").then((r) => r && setZoho({ invoiceId: r.invoiceId, invoiceUrl: r.invoiceUrl }))} disabled={actions.pending === "zoho"}
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 10, border: `1px solid ${C.line2}`, background: C.card, padding: "8px 13px", fontSize: 12.5, fontWeight: 600, color: C.ink, cursor: "pointer" }}>
                    {actions.pending === "zoho" ? <Loader2 size={13} className="vspin" /> : <ArrowUpRight size={13} />} Push to Zoho
                  </button>
                )}
                <button onClick={onClose} style={{ display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 10, border: `1px solid ${C.line2}`, background: C.card, padding: "8px 13px", fontSize: 12.5, fontWeight: 600, color: C.dim, cursor: "pointer" }}>Done</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px", padding: "18px 20px 12px" }}>
                <label className={labelCls} style={{ gridColumn: "span 2" }}>Customer<input className={field} value={order.customer_name} disabled /></label>
                <label className={labelCls} style={{ gridColumn: "span 2" }}>Phone<input className={field} value={order.customer_phone} disabled /></label>
                <label className={labelCls} style={{ gridColumn: "span 2" }}>Address line 1<input className={field} value={address1} onChange={(e) => setAddress1(e.target.value)} placeholder="street, building, apartment" disabled={locked} /></label>
                <label className={labelCls} style={{ gridColumn: "span 2" }}>Address line 2<input className={field} value={address2} onChange={(e) => setAddress2(e.target.value)} disabled={locked} /></label>
                <label className={labelCls} style={{ gridColumn: "span 2" }}>City (SMSA-recognized only)
                  <select className={field} value={city} onChange={(e) => setCity(e.target.value)} disabled={locked}>
                    <option value="">{cities.length ? "Select a city…" : "Loading cities…"}</option>
                    {cities.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className={labelCls}>Weight (kg)<input className={field} type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} disabled={locked} /></label>
                <label className={labelCls}>Packages<input className={field} type="number" min={1} value={packageCount} onChange={(e) => setPackageCount(Number(e.target.value))} disabled={locked} /></label>
                {isCod && <label className={labelCls} style={{ gridColumn: "span 2" }}>COD amount (read-only)<input className={field} value={`${order.currency} ${order.gross_aed.toFixed(2)}`} disabled /></label>}
                <label className={labelCls} style={{ gridColumn: "span 2" }}>Reference (order uid, fixed)<input className={field} value={order.uid} disabled /></label>
              </div>

              {state === "error" && (
                <div style={{ margin: "0 20px 14px", display: "flex", alignItems: "flex-start", gap: 8, borderRadius: 10, background: C.coralBg, padding: "10px 12px", fontSize: 12.5, color: C.coral }}>
                  <AlertTriangle size={14} /><span>{error}</span>
                </div>
              )}

              <footer style={{ display: "flex", justifyContent: "flex-end", gap: 10, borderTop: `1px solid ${C.line}`, padding: "14px 20px" }}>
                <button onClick={onClose} disabled={locked} style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 10, border: `1px solid ${C.line2}`, background: "transparent", padding: "8px 15px", fontSize: 13, fontWeight: 500, color: C.ink, cursor: "pointer", opacity: locked ? 0.6 : 1 }}>Cancel</button>
                <button onClick={submit} disabled={locked} style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 10, border: `1px solid ${C.gild}`, background: C.gild, padding: "8px 15px", fontSize: 13, fontWeight: 600, color: "#fff", cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.6 : 1 }}>
                  {state === "submitting" ? <Loader2 size={14} className="vspin" /> : <Truck size={14} />} {state === "submitting" ? "Shipping…" : "Confirm ship"}
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