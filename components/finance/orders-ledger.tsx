// "use client";

// /* Order ledger — expandable rows (not inline-editable; a costly action like
//    invoice generation gets an explicit button, never a click meant for
//    reading). Each row opens to product images, address, and the pack-and-ship
//    status buttons. Animated with framer-motion so status changes and row
//    expansion read as live, not as a page reflow.

//    Ledger-specific styling is tailwind; shared design-system classes (btn,
//    pill, tab, store-badge, mono, empty) still come from the workspace CSS,
//    which this always renders inside — so the --gold/--line/etc. tokens resolve
//    in the arbitrary-value classes below. */

// import React, { useCallback, useEffect, useState } from "react";
// import { AnimatePresence, motion } from "framer-motion";
// import {
//   Check, ChevronDown, Loader2, MapPin, Package, PackageCheck,
//   PackageOpen, Phone, Printer, Truck, Search,
// } from "lucide-react";
// import { toast } from "sonner";
// import type { OrderRow } from "@/lib/types/orders";
// import { ORDER_STATUS_META } from "@/lib/types/orders";
// import { LOCATION_GROUPS, locationGroupFor } from "@/lib/orders-locations";
// import { InvoiceModal } from "@/components/finance/invoice-modal";
// import { ShipModal } from "@/components/finance/ship-modal";

// // A "Ship" button only makes sense for international orders (SMSA covers
// // KSA-domestic + beyond; Ontrack already handles UAE-local through the
// // store's own courier flow) that don't already have an AWB.
// function isShippable(o: OrderRow): boolean {
//   return (o.country || "").trim().toUpperCase() !== "AE" && !o.awb_number;
// }

// const formatOrderDate = (iso: string | null) =>
//   iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

// const aed2 = (v: number) =>
//   new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", minimumFractionDigits: 2 }).format(v);

// const STAGES = [
//   { key: "processing", label: "Processing", icon: Package },
//   { key: "packed", label: "Packed", icon: PackageOpen },
//   { key: "shipped", label: "Shipped", icon: Truck },
//   { key: "delivered", label: "Delivered", icon: PackageCheck },
// ] as const;

// const STAGE_PILL: Record<string, string> = {
//   processing: "bg-[#F3EFE7] text-[var(--gold-deep)]",
//   packed: "bg-[var(--info-wash)] text-[var(--info)]",
//   shipped: "bg-[var(--warn-wash)] text-[var(--warn)]",
//   delivered: "bg-[var(--ok-wash)] text-[var(--ok)]",
// };

// type LineItem = { title: string; sku: string; qty: number; total_aed: number; image_url?: string; stock?: number | null };
// type OrderDetail = OrderRow & { line_items: LineItem[]; settled_at: string | null };

// function daysSince(iso: string | null): number {
//   if (!iso) return 0;
//   return Math.max(Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000), 0);
// }

// // The real settlement chain, shown on expand instead of a blunt collapsed-row
// // badge — a fresh order awaiting its payout file reads as "waiting Nd", not
// // as broken.
// function SettlementTracker({ order, settledAt }: { order: OrderRow; settledAt: string | null | undefined }) {
//   const payoutSeen = order.in_payout_file;
//   const settled = order.finance_status === "SETTLED";
//   const steps = [
//     { label: "Order placed", done: true, sub: formatOrderDate(order.order_date) },
//     { label: "Payout file seen", done: payoutSeen, sub: payoutSeen ? "✓" : `waiting ${daysSince(order.order_date)}d` },
//     { label: "Bank settled", done: settled, sub: settled && settledAt ? formatOrderDate(settledAt) : "—" },
//   ];
//   return (
//     <div>
//       <h4 className="mb-2.5 text-[10.5px] uppercase tracking-[.06em] text-[var(--muted)]">Settlement</h4>
//       <div className="flex items-center gap-2">
//         {steps.map((s, i) => (
//           <div key={s.label} className="flex items-center">
//             {i > 0 && <div className="mx-1 h-px w-6" style={{ background: s.done || steps[i - 1].done ? "var(--gold)" : "var(--line)" }} />}
//             <div className="flex flex-col items-center gap-1">
//               <div
//                 className={`flex size-6 items-center justify-center rounded-full border-[1.5px] text-[10.5px] font-semibold ${
//                   s.done
//                     ? "border-[var(--gold)] bg-[var(--gold-wash)] text-[var(--gold-deep)]"
//                     : "border-[var(--line-strong)] bg-[var(--card)] text-[var(--muted)]"
//                 }`}
//               >
//                 {s.done ? <Check size={12} /> : i + 1}
//               </div>
//               <span className="whitespace-nowrap text-[10px] text-[var(--muted)]">{s.label}</span>
//               <span className="whitespace-nowrap text-[10.5px] font-medium">{s.sub}</span>
//             </div>
//           </div>
//         ))}
//       </div>
//     </div>
//   );
// }

// function StageTracker({ order, onChanged }: { order: OrderRow; onChanged: (stage: string) => void }) {
//   const [updating, setUpdating] = useState<string | null>(null);
//   const currentIdx = STAGES.findIndex((s) => s.key === order.fulfillment_stage);

//   const advance = async (stage: string) => {
//     if (stage === order.fulfillment_stage) return;
//     setUpdating(stage);
//     try {
//       const res = await fetch(`/api/orders/${order.uid}/status`, {
//         method: "PATCH",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ stage }),
//       });
//       if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "update failed");
//       onChanged(stage);
//       toast.success(`#${order.order_number} → ${STAGES.find((s) => s.key === stage)?.label}`);
//     } catch (e) {
//       toast.error(`Status update failed: ${(e as Error).message}`);
//     } finally {
//       setUpdating(null);
//     }
//   };

//   return (
//     <div className="flex items-center">
//       {STAGES.map((s, i) => {
//         const Icon = s.icon;
//         const done = currentIdx >= 0 && i <= currentIdx;
//         const active = s.key === order.fulfillment_stage;
//         return (
//           <div key={s.key} className="flex items-center">
//             {i > 0 && (
//               <motion.div
//                 className="mx-0.5 h-0.5 w-7"
//                 initial={false}
//                 animate={{ backgroundColor: i <= currentIdx ? "var(--gold)" : "var(--line)" }}
//                 transition={{ duration: 0.3 }}
//               />
//             )}
//             <motion.button
//               className={`relative flex size-[30px] shrink-0 items-center justify-center rounded-full border-[1.5px] disabled:cursor-wait ${
//                 active
//                   ? "border-[var(--gold)] text-[var(--gold-deep)] shadow-[0_0_0_3px_var(--gold-wash)]"
//                   : done
//                     ? "border-[var(--gold)] bg-[var(--gold-wash)] text-[var(--gold-deep)]"
//                     : "border-[var(--line-strong)] bg-[var(--card)] text-[var(--muted)]"
//               }`}
//               onClick={() => advance(s.key)}
//               whileTap={{ scale: 0.92 }}
//               whileHover={{ scale: 1.05 }}
//               disabled={updating !== null}
//               title={s.label}
//             >
//               {updating === s.key ? (
//                 <Loader2 size={14} className="animate-spin" />
//               ) : done ? (
//                 <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 15 }}>
//                   <Check size={14} />
//                 </motion.span>
//               ) : (
//                 <Icon size={14} />
//               )}
//             </motion.button>
//           </div>
//         );
//       })}
//     </div>
//   );
// }

// function ExpandedOrder({ order, onStageChanged, onInvoice, onShip }: {
//   order: OrderRow;
//   onStageChanged: (stage: string) => void;
//   onInvoice: () => void;
//   onShip: () => void;
// }) {
//   const [detail, setDetail] = useState<OrderDetail | null>(null);
//   const [loadingDetail, setLoadingDetail] = useState(true);

//   useEffect(() => {
//     let cancelled = false;
//     fetch(`/api/orders/${order.uid}`)
//       .then((r) => r.json())
//       .then((d) => { if (!cancelled) setDetail(d.order); })
//       .catch(() => { if (!cancelled) setDetail(null); })
//       .finally(() => { if (!cancelled) setLoadingDetail(false); });
//     return () => { cancelled = true; };
//   }, [order.uid]);

//   return (
//     <motion.div
//       className="overflow-hidden"
//       initial={{ height: 0, opacity: 0 }}
//       animate={{ height: "auto", opacity: 1 }}
//       exit={{ height: 0, opacity: 0 }}
//       transition={{ duration: 0.25, ease: "easeOut" }}
//     >
//       <div className="border-t border-[var(--line)] px-[18px] pb-[18px] pt-1">
//         <div className="grid grid-cols-1 gap-5 pt-4 md:grid-cols-[220px_1fr]">
//           <div>
//             <h4 className="mb-2.5 text-[10.5px] uppercase tracking-[.06em] text-[var(--muted)]">Ship to</h4>
//             <div className="flex flex-col gap-[7px] text-[13px]">
//               <div className="flex items-center gap-[7px]"><Phone size={12} /> {order.customer_phone || "—"}</div>
//               <div className="flex items-center gap-[7px]"><MapPin size={12} /> {[order.city, order.country].filter(Boolean).join(", ") || "—"}</div>
//               {order.courier && (
//                 <div className="mt-0.5 inline-flex w-fit items-center rounded-md bg-[var(--gold-wash)] px-2.5 py-[3px] text-[11px] font-semibold text-[var(--gold-deep)]">
//                   {order.courier}{order.tracking_number ? ` · ${order.tracking_number}` : ""}
//                 </div>
//               )}
//             </div>
//           </div>

//           <div>
//             <h4 className="mb-2.5 text-[10.5px] uppercase tracking-[.06em] text-[var(--muted)]">Items</h4>
//             {loadingDetail ? (
//               <div className="flex items-center gap-2 py-2 text-[12.5px] text-[var(--muted)]"><Loader2 size={14} className="animate-spin" /> Loading items…</div>
//             ) : !detail?.line_items?.length ? (
//               <div className="flex items-center gap-2 py-2 text-[12.5px] text-[var(--muted)]">No line items on this order.</div>
//             ) : (
//               <div className="flex flex-wrap gap-2.5">
//                 {detail.line_items.slice(0, 8).map((li, i) => (
//                   <motion.div
//                     key={`${li.sku}-${i}`}
//                     className="flex w-24 flex-col gap-1.5"
//                     initial={{ opacity: 0, y: 8 }}
//                     animate={{ opacity: 1, y: 0 }}
//                     transition={{ delay: i * 0.03 }}
//                   >
//                     {li.image_url ? (
//                       // eslint-disable-next-line @next/next/no-img-element
//                       <img src={li.image_url} alt={li.title} className="size-24 rounded-[10px] border border-[var(--line)] bg-[var(--cream)] object-cover" loading="lazy" />
//                     ) : (
//                       <div className="flex size-24 items-center justify-center rounded-[10px] border border-[var(--line)] bg-[var(--cream)] text-[var(--muted)]"><Package size={18} /></div>
//                     )}
//                     <div className="flex flex-col gap-px">
//                       <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px]" title={li.title}>{li.title}</span>
//                       <span className="text-[10.5px] text-[var(--muted)]">×{li.qty} · {aed2(li.total_aed)}</span>
//                     </div>
//                   </motion.div>
//                 ))}
//               </div>
//             )}
//           </div>
//         </div>

//         <div className="mt-[18px] border-t border-dashed border-[var(--line)] pt-4">
//           <SettlementTracker order={order} settledAt={detail?.settled_at} />
//         </div>

//         <div className="mt-[18px] flex flex-wrap items-center justify-between gap-4 border-t border-dashed border-[var(--line)] pt-4">
//           <StageTracker order={order} onChanged={onStageChanged} />
//           <div className="flex gap-2">
//             {order.awb_number ? (
//               <a className="btn small" href={`/api/orders/${order.uid}/label`} target="_blank" rel="noreferrer">
//                 <Truck size={13} /> AWB {order.awb_number}
//               </a>
//             ) : isShippable(order) ? (
//               <button className="btn small" onClick={onShip}>
//                 <Truck size={13} /> Ship
//               </button>
//             ) : null}
//             <button className="btn primary small" onClick={onInvoice}>
//               <Printer size={13} /> Invoice
//             </button>
//           </div>
//         </div>
//       </div>
//     </motion.div>
//   );
// }

// const OrderCard = React.memo(function OrderCard({
//   order, displayOrder, isOpen, isSelected, onToggleSelect, onToggleExpand, onStageChanged, onInvoice, onShip,
// }: {
//   order: OrderRow; displayOrder: OrderRow; isOpen: boolean; isSelected: boolean;
//   onToggleSelect: (uid: string) => void; onToggleExpand: (uid: string) => void;
//   onStageChanged: (stage: string) => void; onInvoice: () => void; onShip: () => void;
// }) {
//   const stage = displayOrder.fulfillment_stage ?? "processing";
//   const m = ORDER_STATUS_META[order.finance_status];
//   const group = locationGroupFor(order.city);
//   return (
//     <div
//       className={`overflow-hidden rounded-[14px] border bg-[var(--card)] transition-[border-color,box-shadow] ${
//         isOpen ? "border-[var(--gold)] shadow-[0_4px_18px_rgba(176,131,67,.12)]" : "border-[var(--line)]"
//       }`}
//     >
//       <div className="flex items-center gap-1.5 pl-3.5">
//         <input
//           type="checkbox"
//           className="size-4 shrink-0 cursor-pointer accent-[var(--gold)]"
//           checked={isSelected}
//           onChange={() => onToggleSelect(order.uid)}
//           onClick={(e) => e.stopPropagation()}
//           aria-label={`Select order #${order.order_number}`}
//         />
//         <button
//           className="grid w-full grid-cols-[130px_1fr_150px_90px_100px_110px_90px_20px] items-center gap-3 px-4 py-[13px] text-left text-[13px]"
//           onClick={() => onToggleExpand(order.uid)}
//         >
//           <div className="flex flex-col gap-0.5">
//             <span className="mono">#{order.order_number}</span>
//             <span className="store-badge w-fit">{order.store_id}</span>
//             <span className="text-[10.5px] text-[var(--muted)]">{formatOrderDate(order.order_date)}</span>
//           </div>
//           <div className="overflow-hidden text-ellipsis whitespace-nowrap" dir="auto">{order.customer_name || "—"}</div>
//           <div className="flex items-center gap-[5px] overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-[var(--muted)]">
//             <MapPin size={12} />
//             {group ?? [order.city, order.country].filter(Boolean).join(", ") ?? "—"}
//           </div>
//           <div className="text-[12.5px] text-[var(--muted)]">{order.gateway}</div>
//           <span className={`rounded-full px-2.5 py-[3px] text-center text-[10.5px] font-semibold uppercase tracking-[.03em] ${STAGE_PILL[stage] ?? STAGE_PILL.processing}`}>
//             {STAGES.find((s) => s.key === stage)?.label ?? stage}
//           </span>
//           <span className={`pill ${m.tone}`}>{m.label}</span>
//           <span className="mono text-right font-semibold">{aed2(Number(order.gross_aed))}</span>
//           <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-[var(--muted)]">
//             <ChevronDown size={16} />
//           </motion.span>
//         </button>
//       </div>
//       <AnimatePresence initial={false}>
//         {isOpen && (
//           <ExpandedOrder
//             order={displayOrder}
//             onStageChanged={onStageChanged}
//             onInvoice={onInvoice}
//             onShip={onShip}
//           />
//         )}
//       </AnimatePresence>
//     </div>
//   );
// }, (prev, next) =>
//   prev.order === next.order &&
//   prev.displayOrder.fulfillment_stage === next.displayOrder.fulfillment_stage &&
//   prev.displayOrder.awb_number === next.displayOrder.awb_number &&
//   prev.displayOrder.label_url === next.displayOrder.label_url &&
//   prev.displayOrder.courier === next.displayOrder.courier &&
//   prev.isOpen === next.isOpen &&
//   prev.isSelected === next.isSelected,
// );

// const PAGE_SIZE = 50;

// export function OrdersLedger() {
//   const [store, setStore] = useState("All");
//   const [location, setLocation] = useState("All locations");
//   const [q, setQ] = useState("");
//   const [qDebounced, setQDebounced] = useState("");
//   const [days, setDays] = useState(30);
//   const [page, setPage] = useState(1);
//   const [orders, setOrders] = useState<OrderRow[]>([]);
//   const [total, setTotal] = useState(0);
//   const [loading, setLoading] = useState(true);
//   const [expanded, setExpanded] = useState<string | null>(null);
//   const [invoiceFor, setInvoiceFor] = useState<OrderRow | null>(null);
//   const [shipFor, setShipFor] = useState<OrderRow | null>(null);
//   const [selected, setSelected] = useState<Set<string>>(new Set());
//   // Orders still waiting behind the one currently open in InvoiceModal —
//   // "generate N invoices" doesn't skip the per-order confirmation step, it
//   // just chains it: closing (cancel or generate) advances to the next one.
//   const [invoiceQueue, setInvoiceQueue] = useState<OrderRow[]>([]);
//   // Patches from status changes / a completed shipment, applied on top of
//   // the fetched page so a row updates in place without a full refetch.
//   const [overrides, setOverrides] = useState<Record<string, Partial<OrderRow>>>({});

//   const stores = ["All", "WA", "UAE", "KSA", "WOO"];
//   const locations = ["All locations", ...Object.keys(LOCATION_GROUPS)];
//   const dateWindows = [
//     { label: "30d", days: 30 }, { label: "90d", days: 90 },
//     { label: "1yr", days: 365 }, { label: "All time", days: 0 },
//   ];

//   // Debounce free-text search only — store/location/days/page changes fetch
//   // immediately, a keystroke doesn't.
//   useEffect(() => {
//     const id = setTimeout(() => setQDebounced(q), 300);
//     return () => clearTimeout(id);
//   }, [q]);

//   // Any filter change resets to page 1 — only page-button clicks should
//   // change `page` on their own.
//   useEffect(() => { setPage(1); }, [store, location, days, qDebounced]);

//   useEffect(() => {
//     let cancelledFetch = false;
//     setLoading(true);
//     const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), days: String(days) });
//     if (store !== "All") params.set("store", store);
//     if (location !== "All locations") params.set("location", location);
//     if (qDebounced) params.set("q", qDebounced);
//     fetch(`/api/orders?${params.toString()}`)
//       .then((r) => r.json())
//       .then((d) => {
//         if (cancelledFetch) return;
//         setOrders(d.orders ?? []);
//         setTotal(d.total ?? 0);
//       })
//       .catch(() => { if (!cancelledFetch) { setOrders([]); setTotal(0); } })
//       .finally(() => { if (!cancelledFetch) setLoading(false); });
//     return () => { cancelledFetch = true; };
//   }, [page, store, location, days, qDebounced]);

//   const rows = orders;
//   const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

//   const patch = useCallback((uid: string, fields: Partial<OrderRow>) => {
//     setOverrides((prev) => ({ ...prev, [uid]: { ...prev[uid], ...fields } }));
//   }, []);

//   const toggleSelect = useCallback((uid: string) => {
//     setSelected((prev) => {
//       const next = new Set(prev);
//       if (next.has(uid)) next.delete(uid); else next.add(uid);
//       return next;
//     });
//   }, []);

//   const startBulkInvoice = () => {
//     const chosen = rows.filter((o) => selected.has(o.uid));
//     if (chosen.length === 0) return;
//     setInvoiceFor(chosen[0]);
//     setInvoiceQueue(chosen.slice(1));
//   };

//   // Fires on Cancel and on a successful generate (generate() calls onClose
//   // itself) — either way, move to the next queued order, or finish up.
//   const advanceInvoiceQueue = () => {
//     if (invoiceQueue.length > 0) {
//       const [next, ...rest] = invoiceQueue;
//       setInvoiceFor(next);
//       setInvoiceQueue(rest);
//     } else {
//       setInvoiceFor(null);
//       setSelected(new Set());
//     }
//   };

//   if (loading && orders.length === 0) return <div className="empty"><Loader2 size={18} className="animate-spin" /> Loading orders…</div>;
//   if (!loading && total === 0) {
//     const filtered = store !== "All" || location !== "All locations" || qDebounced !== "" || days !== 30;
//     return (
//       <div className="empty">
//         {filtered
//           ? "No orders match these filters."
//           : <>No orders in Supabase yet. Hit <b>Sync stores</b> to pull WA / UAE / KSA Shopify and WooCommerce orders.</>}
//       </div>
//     );
//   }

//   return (
//     <>
//       <div className="filters">
//         <div className="relative flex items-center">
//           <Search size={14} className="pointer-events-none absolute left-[11px] text-[var(--muted)]" />
//           <input className="search pl-8" placeholder="Search number, customer, city, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
//         </div>
//         <div className="tabs" style={{ margin: 0 }}>
//           {stores.map((s, index) => (
//             <button key={`${s} ${index}`} className={store === s ? "tab on" : "tab"} onClick={() => setStore(s)}>{s}</button>
//           ))}
//         </div>
//         <div className="tabs ml-auto" style={{ margin: 0 }}>
//           {dateWindows.map((w) => (
//             <button key={w.label} className={days === w.days ? "tab on" : "tab"} onClick={() => setDays(w.days)}>{w.label}</button>
//           ))}
//         </div>
//         <select className="rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-[12.5px] text-[var(--ink)]" value={location} onChange={(e) => setLocation(e.target.value)}>
//           {locations.map((l) => <option key={l} value={l}>{l}</option>)}
//         </select>
//       </div>

//       {selected.size > 0 && (
//         <div className="mt-2.5 flex items-center gap-3 rounded-xl border border-[var(--gold)] bg-[var(--gold-wash)] px-4 py-2.5 text-[13px] font-medium text-[var(--gold-deep)]">
//           <span>{selected.size} selected</span>
//           <button className="btn primary small ml-auto" onClick={startBulkInvoice}>
//             <Printer size={13} /> Generate {selected.size} invoice{selected.size > 1 ? "s" : ""}
//           </button>
//           <button className="btn ghost small" onClick={() => setSelected(new Set())}>Clear</button>
//         </div>
//       )}

//       <div className="mt-1 flex flex-col gap-2.5">
//         {rows.map((o) => {
//           const displayOrder = { ...o, ...overrides[o.uid] };
//           const isOpen = expanded === o.uid;
//           return (
//             <OrderCard
//               key={o.uid}
//               order={o}
//               displayOrder={displayOrder}
//               isOpen={isOpen}
//               isSelected={selected.has(o.uid)}
//               onToggleSelect={toggleSelect}
//               onToggleExpand={(uid) => setExpanded(isOpen ? null : uid)}
//               onStageChanged={(newStage) => patch(o.uid, { fulfillment_stage: newStage })}
//               onInvoice={() => setInvoiceFor(displayOrder)}
//               onShip={() => setShipFor(displayOrder)}
//             />
//           );
//         })}
//       </div>

//       <p className="table-note">Page {page} of {totalPages} · {total} orders total · settlement comes only from a bank-confirmed payout, never from the store's own "paid" flag.</p>

//       {totalPages > 1 && (
//         <div className="mt-2 flex items-center justify-center gap-3">
//           <button className="btn ghost small" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(p - 1, 1))}>
//             Prev
//           </button>
//           <span className="text-[12.5px] text-[var(--muted)]">Page {page} of {totalPages}</span>
//           <button className="btn ghost small" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(p + 1, totalPages))}>
//             Next
//           </button>
//         </div>
//       )}

//       {invoiceFor && (
//         <InvoiceModal order={invoiceFor} onClose={advanceInvoiceQueue} queueRemaining={invoiceQueue.length} />
//       )}
//       {shipFor && (
//         <ShipModal
//           order={shipFor}
//           onClose={() => setShipFor(null)}
//           onShipped={(awb, labelUrl) => patch(shipFor.uid, { awb_number: awb, label_url: labelUrl, courier: "SMSA", fulfillment_stage: "shipped" })}
//         />
//       )}
//     </>
//   );
// }









"use client";

/* Order ledger — "The Vault" treatment.

   Each order is a statement line, not a table row: product imagery on the
   left (real image_url from the lazy-fetched detail, falling back to a velvet
   placeholder), identity in the middle, the amount typeset in a serif on the
   right. Money is temperature-coded off finance_status:

     SETTLED        → mint   (bank-confirmed real)
     AWAITING_BANK  → amber  (money in transit, payout not yet cleared)
     MISSING_PAYOUT → stone  (reads "Processing" — usually just too new)
     COD_PENDING    → stone  (cash not yet collected)
     + a client-only EXCEPTION lane when ship_error is set

   The liquidity ribbon up top is the KPI surface: one proportional bar of the
   page's gross, split by money-state, clickable to filter. Expanding a row
   lazy-fetches line items (GET /api/orders/:uid) and reveals the settlement
   chain, the fulfilment stepper, and the finance/Zoho/refund actions.

   All shared design-system classes (btn, pill, tab, store-badge, mono, empty,
   search, filters, table-note, tabs) still come from the workspace CSS this
   renders inside. Ledger-specific styling is inline so --tokens don't need to
   resolve outside .wrap. */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check, ChevronDown, Loader2, MapPin, Package, PackageCheck, PackageOpen,
  Phone, Plus, Printer, Search, Truck, ArrowUpRight, BadgeCheck, RotateCw,
  ExternalLink, ShieldCheck, XCircle, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import type { OrderRow } from "@/lib/types/orders";
import { LOCATION_GROUPS, locationGroupFor } from "@/lib/orders-locations";
import { useOrderActions, type FinanceStatus, type ZohoState } from "@/lib/hooks/use-order-actions";
import { InvoiceModal } from "@/components/finance/invoice-modal";
import { ShipModal } from "@/components/finance/ship-modal";

// ── palette (self-contained; independent of workspace --tokens) ──
const C = {
  paper: "#F7F3EA", card: "#FFFFFF", raise: "#FBF8F1",
  line: "#EBE5D6", line2: "#DED6C2",
  ink: "#1C1913", body: "#5C5647", dim: "#8C8574", faint: "#B0A896",
  mint: "#3E8F63", mintBg: "#E7F1EA", mintEdge: "#BEDDC9",
  amber: "#B67C1E", amberBg: "#F7EDD7", amberEdge: "#E4CE9A",
  coral: "#C15540", coralBg: "#F7E7E1", coralEdge: "#E6C1B4",
  stone: "#7C7565", stoneBg: "#F0ECE1", stoneEdge: "#DCD4C4",
  gild: "#9A7526", gildSoft: "#B08A3C",
};

const money2 = (v: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const money0 = (v: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtShort = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const daysSince = (iso: string | null) =>
  iso ? Math.max(Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000), 0) : 0;

// velvet fallback when an item has no image_url yet
const VELVET =
  "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><defs><radialGradient id='v' cx='50%' cy='34%' r='80%'><stop offset='0%' stop-color='#2b2822'/><stop offset='55%' stop-color='#171410'/><stop offset='100%' stop-color='#0a0906'/></radialGradient><linearGradient id='m' x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stop-color='#fff7e0'/><stop offset='45%' stop-color='#e9cf87'/><stop offset='100%' stop-color='#b78f3e'/></linearGradient></defs><rect width='120' height='120' fill='url(#v)'/><g fill='none' stroke='url(#m)' stroke-width='2'><path d='M40 52 Q60 40 80 52'/></g><g fill='#efe6c9'><circle cx='60' cy='62' r='3'/><circle cx='50' cy='56' r='1.6'/><circle cx='70' cy='56' r='1.6'/></g></svg>`,
  );

// ── money-state derivation ──────────────────────────────────
type MoneyState = "SETTLED" | "AWAITING" | "PROCESSING" | "EXCEPTION";

function moneyStateOf(o: OrderRow): MoneyState {
  if (o.ship_error) return "EXCEPTION";
  switch (o.finance_status) {
    case "SETTLED": return "SETTLED";
    case "AWAITING_BANK": return "AWAITING";
    case "MISSING_PAYOUT":
    case "COD_PENDING":
    default: return "PROCESSING";
  }
}

const STATE_META: Record<MoneyState, { label: string; note: string; color: string; bg: string; edge: string }> = {
  SETTLED:    { label: "Settled",    note: "bank-confirmed", color: C.mint,  bg: C.mintBg,  edge: C.mintEdge },
  AWAITING:   { label: "In transit", note: "awaiting payout", color: C.amber, bg: C.amberBg, edge: C.amberEdge },
  PROCESSING: { label: "Processing", note: "too new to settle", color: C.stone, bg: C.stoneBg, edge: C.stoneEdge },
  EXCEPTION:  { label: "Exception",  note: "needs review",    color: C.coral, bg: C.coralBg, edge: C.coralEdge },
};

const STAGES = [
  { key: "processing", label: "Processing", Icon: Package },
  { key: "packed", label: "Packed", Icon: PackageOpen },
  { key: "shipped", label: "Shipped", Icon: Truck },
  { key: "delivered", label: "Delivered", Icon: PackageCheck },
] as const;
const stageIdx = (k: string) => STAGES.findIndex((s) => s.key === k);

type LineItem = { title: string; sku: string; qty: number; total_aed: number; image_url?: string; stock?: number | null };
type OrderDetail = OrderRow & { line_items: LineItem[]; settled_at: string | null; customer_email?: string };

const isShippable = (o: OrderRow) => (o.country || "").trim().toUpperCase() !== "AE" && !o.awb_number;

const lbl: React.CSSProperties = { fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: C.faint, fontWeight: 700 };

// ── settlement chain ────────────────────────────────────────
function SettlementChain({ order, detail }: { order: OrderRow; detail: OrderDetail | null }) {
  const settled = order.finance_status === "SETTLED";
  const state = moneyStateOf(order);
  const col = STATE_META[state].color;
  const steps = [
    { label: "Order placed", done: true, sub: fmtShort(order.order_date) },
    { label: "Payout file seen", done: order.in_payout_file, sub: order.in_payout_file ? "matched" : `waiting ${daysSince(order.order_date)}d` },
    { label: "Bank settled", done: settled, sub: settled && detail?.settled_at ? fmtShort(detail.settled_at) : "in transit" },
  ];
  const filled = steps.filter((s) => s.done).length - 1;
  return (
    <div>
      <div style={lbl}>Settlement</div>
      <div style={{ position: "relative", marginTop: 18, height: 46 }}>
        <div style={{ position: "absolute", left: 6, right: 6, top: 6, height: 2, background: C.line2 }} />
        <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: filled / 2 }} transition={{ duration: 0.6, ease: "easeInOut" }}
          style={{ position: "absolute", left: 6, right: 6, top: 6, height: 2, transformOrigin: "left", background: col }} />
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          {steps.map((s, i) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", alignItems: i === 0 ? "flex-start" : i === 2 ? "flex-end" : "center", gap: 7, width: 120 }}>
              <motion.div animate={!s.done && s.label === "Bank settled" && state !== "PROCESSING" ? { opacity: [0.45, 1, 0.45] } : {}} transition={{ duration: 1.8, repeat: Infinity }}
                style={{ width: 13, height: 13, borderRadius: "50%", border: `1.5px solid ${s.done ? col : C.line2}`, background: s.done ? col : C.card, display: "grid", placeItems: "center", zIndex: 1 }}>
                {s.done && <Check size={8} color="#fff" strokeWidth={3} />}
              </motion.div>
              <span style={{ fontSize: 10.5, color: C.dim, whiteSpace: "nowrap" }}>{s.label}</span>
              <span style={{ fontSize: 11, color: s.done ? C.ink : C.faint, whiteSpace: "nowrap", fontFeatureSettings: "'tnum'" }}>{s.sub}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── fulfilment stepper (PATCH /status) ──────────────────────
function StageStepper({ order, busy, onAdvance }: { order: OrderRow; busy: boolean; onAdvance: (stage: string) => void }) {
  const [target, setTarget] = useState<string | null>(null);
  const cur = stageIdx(order.fulfillment_stage);
  const go = (k: string) => { if (k === order.fulfillment_stage) return; setTarget(k); onAdvance(k); };
  useEffect(() => { if (!busy) setTarget(null); }, [busy]);
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {STAGES.map((s, i) => {
        const done = cur >= 0 && i <= cur, active = s.key === order.fulfillment_stage, { Icon } = s;
        return (
          <div key={s.key} style={{ display: "flex", alignItems: "center" }}>
            {i > 0 && <div style={{ width: 26, height: 1.5, margin: "0 4px", background: i <= cur ? C.gildSoft : C.line2 }} />}
            <motion.button onClick={() => go(s.key)} disabled={busy} whileHover={{ scale: busy ? 1 : 1.1 }} whileTap={{ scale: 0.9 }} title={s.label}
              style={{ width: 30, height: 30, borderRadius: "50%", display: "grid", placeItems: "center", cursor: busy ? "wait" : "pointer",
                border: `1.5px solid ${done ? C.gildSoft : C.line2}`, background: active ? C.raise : done ? "rgba(154,117,38,.1)" : C.card,
                color: done ? C.gild : C.faint, boxShadow: active ? `0 0 0 3px rgba(154,117,38,.1)` : "none" }}>
              {busy && target === s.key ? <Loader2 size={13} className="spin" /> : done ? <Check size={13} /> : <Icon size={13} />}
            </motion.button>
          </div>
        );
      })}
    </div>
  );
}

// ── finance / zoho / refund action bar ──────────────────────
function ActionBar({
  order, onInvoice, onShip, onFinance, onZoho, onResyncZoho, onCancel, onRefund, zoho, pending,
}: {
  order: OrderRow;
  onInvoice: () => void; onShip: () => void;
  onFinance: (fs: FinanceStatus) => void; onZoho: () => void; onResyncZoho: () => void;
  onCancel: () => void; onRefund: () => void;
  zoho: ZohoState; pending: ReturnType<typeof useOrderActions>["pending"];
}) {
  const [confirm, setConfirm] = useState<null | "cancel" | "refund">(null);
  const settled = order.finance_status === "SETTLED";
  const isException = Boolean(order.ship_error);
  const zohoPushed = Boolean(zoho?.invoiceId);

  const chip = (opts: {
    onClick: () => void; icon: React.ReactNode; label: string;
    tone?: "ghost" | "mint" | "gild" | "danger"; loading?: boolean; disabled?: boolean; title?: string;
  }) => {
    const t = opts.tone || "ghost";
    const styles: Record<string, React.CSSProperties> = {
      ghost:  { color: C.ink,   background: C.card,   border: `1px solid ${C.line2}` },
      mint:   { color: C.mint,  background: C.mintBg, border: `1px solid ${C.mintEdge}` },
      gild:   { color: "#fff",  background: C.gild,   border: `1px solid ${C.gild}` },
      danger: { color: C.coral, background: C.coralBg, border: `1px solid ${C.coralEdge}` },
    };
    return (
      <button onClick={opts.onClick} disabled={opts.loading || opts.disabled} title={opts.title}
        style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 11, fontSize: 12.5, fontWeight: 600,
          cursor: opts.loading || opts.disabled ? "not-allowed" : "pointer", opacity: opts.disabled ? 0.5 : 1, whiteSpace: "nowrap", ...styles[t] }}>
        {opts.loading ? <Loader2 size={13} className="spin" /> : opts.icon} {opts.label}
      </button>
    );
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 9, alignItems: "center", justifyContent: "flex-end" }}>
      {/* Fulfilment side actions */}
      {order.awb_number
        ? chip({ onClick: onShip, icon: <Truck size={13} />, label: `AWB ${order.awb_number}`, title: "View / reprint the SMSA label" })
        : isShippable(order)
          ? chip({ onClick: onShip, icon: <Truck size={13} />, label: "Ship" })
          : null}

      {/* Finance-status actions */}
      {isException
        ? chip({ onClick: () => onFinance("AWAITING_BANK"), icon: <ShieldCheck size={13} />, label: "Clear exception", tone: "ghost", loading: pending === "finance", title: "Resolve the exception and return to awaiting-bank" })
        : !settled
          ? chip({ onClick: () => onFinance("SETTLED"), icon: <BadgeCheck size={13} />, label: "Mark settled", tone: "mint", loading: pending === "finance", title: "Force settled — use only when you've confirmed the bank payout by hand" })
          : chip({ onClick: () => onFinance("AWAITING_BANK"), icon: <RotateCw size={13} />, label: "Unsettle", tone: "ghost", loading: pending === "finance", title: "Revert a manual settle" })}

      {/* Zoho Books */}
      {zohoPushed
        ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 2px 2px 0" }}>
            <a href={zoho!.invoiceUrl} target="_blank" rel="noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 11, fontSize: 12.5, fontWeight: 600,
                color: C.gild, background: "rgba(154,117,38,.08)", border: `1px solid ${C.line2}`, textDecoration: "none", whiteSpace: "nowrap" }}>
              <ExternalLink size={13} /> Zoho · {zoho!.invoiceId}
            </a>
            {chip({ onClick: onResyncZoho, icon: <RotateCw size={13} />, label: "Re-sync", tone: "ghost", loading: pending === "zoho-sync", title: "Force a manual re-sync to Zoho Books" })}
          </span>
        )
        : chip({ onClick: onZoho, icon: <ArrowUpRight size={13} />, label: "Push to Zoho", tone: "ghost", loading: pending === "zoho", title: "Create the invoice in Zoho Books" })}

      {/* Invoice (PDF) */}
      {chip({ onClick: onInvoice, icon: <Printer size={13} />, label: "Invoice", tone: "gild" })}

      {/* Cancel / refund — two-step confirm inline */}
      {confirm ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 11, background: C.coralBg, border: `1px solid ${C.coralEdge}` }}>
          <AlertTriangle size={13} color={C.coral} />
          <span style={{ fontSize: 12, color: C.coral, fontWeight: 600 }}>{confirm === "cancel" ? "Cancel this order?" : "Refund this order?"}</span>
          <button onClick={() => { (confirm === "cancel" ? onCancel : onRefund)(); setConfirm(null); }}
            style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: C.coral, border: "none", borderRadius: 8, padding: "5px 11px", cursor: "pointer" }}>
            {pending === confirm ? <Loader2 size={12} className="spin" /> : "Confirm"}
          </button>
          <button onClick={() => setConfirm(null)} style={{ fontSize: 12, color: C.dim, background: "none", border: "none", cursor: "pointer" }}>Keep</button>
        </span>
      ) : (
        <>
          {chip({ onClick: () => setConfirm("refund"), icon: <RotateCw size={13} />, label: "Refund", tone: "danger", disabled: order.finance_status === "COD_PENDING", title: order.finance_status === "COD_PENDING" ? "Nothing collected to refund on a COD order" : "Refund via the gateway" })}
          {chip({ onClick: () => setConfirm("cancel"), icon: <XCircle size={13} />, label: "Cancel", tone: "ghost" })}
        </>
      )}
    </div>
  );
}

// ── expanded body ───────────────────────────────────────────
function ExpandedOrder({
  order, onStageChanged, onFinanceChanged, onInvoice, onShip,
}: {
  order: OrderRow;
  onStageChanged: (stage: string) => void;
  onFinanceChanged: (fs: FinanceStatus) => void;
  onInvoice: () => void; onShip: () => void;
}) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [zoho, setZoho] = useState<ZohoState>(null);
  const actions = useOrderActions(order.uid);

  useEffect(() => {
    let off = false;
    fetch(`/api/orders/${order.uid}`).then((r) => r.json())
      .then((d) => { if (!off) setDetail(d.order); })
      .catch(() => { if (!off) setDetail(null); })
      .finally(() => { if (!off) setLoadingDetail(false); });
    actions.getZoho().then((z) => { if (!off) setZoho(z); });
    return () => { off = true; };
  }, [order.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const wrap = <T,>(p: Promise<T>, ok: string): Promise<T | undefined> =>
    p.then((v) => { toast.success(ok); return v; }).catch((e: Error) => { toast.error(e.message); return undefined; });

  const items = detail?.line_items ?? [];

  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }} style={{ overflow: "hidden" }}>
      <div style={{ padding: "6px 24px 24px", marginLeft: 3 }}>
        {/* imagery + line items */}
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 20, marginBottom: 22, paddingBottom: 22, borderBottom: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", gap: 10 }}>
            {loadingDetail ? (
              <div style={{ width: 120, height: 120, borderRadius: 16, background: C.raise, display: "grid", placeItems: "center" }}>
                <Loader2 size={16} className="spin" color={C.faint} />
              </div>
            ) : items.length ? (
              items.slice(0, 3).map((li, i) => (
                <img key={`${li.sku}-${i}`} src={li.image_url || VELVET} alt={li.title} width={120} height={120}
                  loading="lazy" style={{ borderRadius: 16, display: "block", objectFit: "cover", background: C.ink, boxShadow: "0 10px 26px rgba(28,25,19,.22)" }} />
              ))
            ) : (
              <img src={VELVET} alt="" width={120} height={120} style={{ borderRadius: 16, boxShadow: "0 10px 26px rgba(28,25,19,.22)" }} />
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 10 }}>
            {loadingDetail ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.dim }}><Loader2 size={14} className="spin" /> Loading items…</div>
            ) : items.length ? (
              items.slice(0, 6).map((li, i) => (
                <div key={`${li.sku}-${i}`} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, paddingBottom: 8, borderBottom: `1px dashed ${C.line}` }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "'Newsreader',serif", fontSize: 16, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={li.title}>{li.title}</div>
                    <div style={{ fontSize: 11, color: C.faint, fontFamily: "monospace" }}>{li.sku} · ×{li.qty}{typeof li.stock === "number" ? ` · ${li.stock} in stock` : ""}</div>
                  </div>
                  <div style={{ fontFamily: "'Newsreader',serif", fontSize: 16, color: C.body, fontFeatureSettings: "'tnum'" }}>AED {money2(li.total_aed)}</div>
                </div>
              ))
            ) : (
              <div style={{ fontSize: 12.5, color: C.dim }}>No line items on this order.</div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 2, fontSize: 12, color: C.dim, flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Phone size={12} /> {order.customer_phone || "—"}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><MapPin size={12} /> {[order.city, order.country].filter(Boolean).join(", ") || "—"}</span>
              {order.awb_number && <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.gild }}><Truck size={12} /> {order.courier || "SMSA"} · {order.awb_number}</span>}
            </div>
            {order.ship_error && (
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: C.coral, background: C.coralBg, border: `1px solid ${C.coralEdge}`, borderRadius: 9, padding: "6px 10px", width: "fit-content" }}>
                <AlertTriangle size={12} /> {order.ship_error}
              </div>
            )}
          </div>
        </div>

        <SettlementChain order={order} detail={detail} />

        <div style={{ marginTop: 22, paddingTop: 20, borderTop: `1px solid ${C.line}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 18 }}>
          <div>
            <div style={{ ...lbl, marginBottom: 12 }}>Fulfilment</div>
            <StageStepper order={order} busy={actions.pending === "stage"}
              onAdvance={(stage) => wrap(actions.advanceStage(stage), `#${order.order_number} → ${STAGES.find((s) => s.key === stage)?.label}`).then((r) => { if (r) onStageChanged(stage); })} />
          </div>
          <div style={{ flex: 1, minWidth: 280, display: "flex", justifyContent: "flex-end" }}>
            <ActionBar
              order={order}
              zoho={zoho}
              pending={actions.pending}
              onInvoice={onInvoice}
              onShip={onShip}
              onFinance={(fs) => wrap(actions.setFinanceStatus(fs), fs === "SETTLED" ? "Marked settled" : "Finance status updated").then((r) => { if (r) onFinanceChanged(fs); })}
              onZoho={() => wrap(actions.pushToZoho(), "Pushed to Zoho Books").then((r) => { if (r) setZoho({ invoiceId: r.invoiceId, invoiceUrl: r.invoiceUrl, syncedAt: new Date().toISOString() }); })}
              onResyncZoho={() => wrap(actions.resyncZoho(), "Re-synced to Zoho").then((r) => { if (r) setZoho({ invoiceId: r.invoiceId, invoiceUrl: r.invoiceUrl, syncedAt: new Date().toISOString() }); })}
              onCancel={() => wrap(actions.cancelOrder(), "Order cancelled").then((r) => { if (r) onFinanceChanged(order.finance_status); })}
              onRefund={() => wrap(actions.refundOrder(), "Refund issued").then((r) => { if (r) onFinanceChanged(order.finance_status); })}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── statement line ──────────────────────────────────────────
const OrderCard = React.memo(function OrderCard({
  order, isOpen, onToggleExpand, onStageChanged, onFinanceChanged, onInvoice, onShip, index,
}: {
  order: OrderRow; isOpen: boolean;
  onToggleExpand: (uid: string) => void;
  onStageChanged: (stage: string) => void;
  onFinanceChanged: (fs: FinanceStatus) => void;
  onInvoice: () => void; onShip: () => void; index: number;
}) {
  const state = moneyStateOf(order);
  const s = STATE_META[state];
  const group = locationGroupFor(order.city);
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 8) * 0.04, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      style={{ position: "relative", background: C.card, borderRadius: 20, overflow: "hidden",
        border: `1px solid ${isOpen ? s.edge : C.line}`, boxShadow: isOpen ? "0 18px 44px rgba(28,25,19,.10)" : "0 1px 2px rgba(28,25,19,.04)", transition: "border-color .25s, box-shadow .25s" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: s.color, opacity: isOpen ? 1 : 0.55 }} />
      <button onClick={() => onToggleExpand(order.uid)}
        style={{ width: "100%", display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", gap: 20, padding: "18px 24px 18px 22px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "monospace", fontSize: 11.5, color: C.dim }}>#{order.order_number}</span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", color: C.gild, border: `1px solid ${C.line2}`, padding: "1px 6px", borderRadius: 5 }}>{order.store_id}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 600, color: s.color, background: s.bg, border: `1px solid ${s.edge}`, padding: "2px 8px", borderRadius: 999 }}>
              <span style={{ width: 5, height: 5, borderRadius: 1.5, background: s.color, transform: "rotate(45deg)" }} /> {s.label}
              <span style={{ color: C.faint, fontWeight: 500 }}>· {s.note}</span>
            </span>
          </div>
          <div dir="auto" style={{ fontFamily: "'Newsreader',serif", fontSize: 21, color: C.ink, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{order.customer_name || "—"}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 5, fontSize: 12, color: C.dim, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><MapPin size={11} /> {group ?? [order.city, order.country].filter(Boolean).join(", ") ?? "—"}</span>
            <span>{order.gateway}</span>
            <span>{fmtDate(order.order_date)}</span>
          </div>
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, justifyContent: "flex-end" }}>
            <span style={{ fontFamily: "'Newsreader',serif", fontStyle: "italic", fontSize: 14, color: C.faint }}>AED</span>
            <span style={{ fontFamily: "'Newsreader',serif", fontSize: 33, color: isOpen ? s.color : C.ink, letterSpacing: "-.01em", fontFeatureSettings: "'tnum'", transition: "color .25s" }}>{money2(Number(order.gross_aed))}</span>
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: C.dim, display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
            {STAGES.find((x) => x.key === order.fulfillment_stage)?.label ?? "Processing"}
            <motion.span animate={{ rotate: isOpen ? 45 : 0 }} transition={{ duration: 0.25 }} style={{ display: "grid", placeItems: "center" }}><Plus size={13} color={C.faint} /></motion.span>
          </div>
        </div>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <ExpandedOrder order={order} onStageChanged={onStageChanged} onFinanceChanged={onFinanceChanged} onInvoice={onInvoice} onShip={onShip} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}, (p, n) =>
  p.order === n.order && p.isOpen === n.isOpen && p.index === n.index &&
  p.onInvoice === n.onInvoice && p.onShip === n.onShip);

// ── liquidity ribbon ────────────────────────────────────────
function Ribbon({ buckets, total, active, onPick }: {
  buckets: Record<MoneyState, { sum: number; n: number }>; total: number;
  active: MoneyState | null; onPick: (s: MoneyState | null) => void;
}) {
  const order: MoneyState[] = ["SETTLED", "AWAITING", "PROCESSING", "EXCEPTION"];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={lbl}>Ledger on screen</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 8 }}>
            <span style={{ fontFamily: "'Newsreader',serif", fontStyle: "italic", fontSize: 16, color: C.dim }}>AED</span>
            <span style={{ fontFamily: "'Newsreader',serif", fontSize: 52, lineHeight: 0.88, color: C.ink, letterSpacing: "-.02em", fontFeatureSettings: "'tnum'" }}>{money0(total)}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
          {order.map((k) => {
            const s = STATE_META[k], b = buckets[k], on = active === k;
            if (!b.n) return null;
            return (
              <button key={k} onClick={() => onPick(on ? null : k)} style={{ background: "none", border: "none", cursor: "pointer", textAlign: "right", padding: 0, opacity: active && !on ? 0.4 : 1, transition: "opacity .2s" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "flex-end", marginBottom: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: s.color, transform: "rotate(45deg)" }} />
                  <span style={{ fontSize: 11, letterSpacing: ".07em", textTransform: "uppercase", color: C.dim }}>{s.label}</span>
                </div>
                <div style={{ fontFamily: "'Newsreader',serif", fontSize: 23, color: C.ink, fontFeatureSettings: "'tnum'" }}>{money0(b.sum)}</div>
                <div style={{ fontSize: 10.5, color: C.faint }}>{b.n} order{b.n !== 1 ? "s" : ""}</div>
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ display: "flex", gap: 3, height: 15, borderRadius: 8, overflow: "hidden", background: C.paper }}>
        {order.map((k) => {
          const s = STATE_META[k], b = buckets[k], pct = total ? (b.sum / total) * 100 : 0;
          if (!pct) return null;
          const on = !active || active === k;
          return (
            <motion.button key={k} onClick={() => onPick(active === k ? null : k)} initial={{ width: 0 }} animate={{ width: `${pct}%` }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} whileHover={{ filter: "brightness(1.06)" }} title={`${s.label} · ${pct.toFixed(0)}%`}
              style={{ position: "relative", border: "none", cursor: "pointer", borderRadius: 5, overflow: "hidden", background: on ? s.color : s.edge, opacity: on ? 1 : 0.55, transition: "opacity .25s" }}>
              {k === "AWAITING" && on && (
                <motion.div animate={{ x: ["-120%", "240%"] }} transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
                  style={{ position: "absolute", top: 0, bottom: 0, width: "38%", background: "linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent)" }} />
              )}
            </motion.button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 9, fontSize: 10.5, color: C.faint }}>
        <span>Money in transit shimmers until a bank payout confirms it.</span>
        <span>{((buckets.SETTLED.sum / total) * 100 || 0).toFixed(0)}% confirmed real</span>
      </div>
    </div>
  );
}

const PAGE_SIZE = 50;
const STORES = ["All", "WA", "UAE", "KSA", "WOO"];
const WINDOWS = [{ label: "1d", days: 1 },{ label: "7d", days: 7 },{ label: "30d", days: 30 }, { label: "90d", days: 90 }, { label: "1yr", days: 365 }, { label: "All time", days: 0 }];

export function OrdersLedger() {
  const [store, setStore] = useState("All");
  const [location, setLocation] = useState("All locations");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(1);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<OrderRow | null>(null);
  const [shipFor, setShipFor] = useState<OrderRow | null>(null);
  const [stateFilter, setStateFilter] = useState<MoneyState | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Partial<OrderRow>>>({});

  const locations = ["All locations", ...Object.keys(LOCATION_GROUPS)];

  useEffect(() => { const id = setTimeout(() => setQDebounced(q), 300); return () => clearTimeout(id); }, [q]);
  useEffect(() => { setPage(1); }, [store, location, days, qDebounced, stateFilter]);

  useEffect(() => {
    let off = false;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), days: String(days) });
    if (store !== "All") params.set("store", store);
    if (location !== "All locations") params.set("location", location);
    if (qDebounced) params.set("q", qDebounced);
    fetch(`/api/orders?${params.toString()}`).then((r) => r.json())
      .then((d) => { if (off) return; setOrders(d.orders ?? []); setTotal(d.total ?? 0); })
      .catch(() => { if (!off) { setOrders([]); setTotal(0); } })
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
  }, [page, store, location, days, qDebounced]);

  const merged = useMemo(() => orders.map((o) => ({ ...o, ...overrides[o.uid] })), [orders, overrides]);
  const rows = useMemo(() => stateFilter ? merged.filter((o) => moneyStateOf(o) === stateFilter) : merged, [merged, stateFilter]);

  const buckets = useMemo(() => {
    const b: Record<MoneyState, { sum: number; n: number }> = {
      SETTLED: { sum: 0, n: 0 }, AWAITING: { sum: 0, n: 0 }, PROCESSING: { sum: 0, n: 0 }, EXCEPTION: { sum: 0, n: 0 },
    };
    merged.forEach((o) => { const k = moneyStateOf(o); b[k].sum += Number(o.gross_aed); b[k].n += 1; });
    return b;
  }, [merged]);
  const ribbonTotal = useMemo(() => merged.reduce((a, o) => a + Number(o.gross_aed), 0), [merged]);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const patch = useCallback((uid: string, fields: Partial<OrderRow>) =>
    setOverrides((p) => ({ ...p, [uid]: { ...p[uid], ...fields } })), []);

  const onInvoice = useCallback((o: OrderRow) => setInvoiceFor(o), []);
  const onShip = useCallback((o: OrderRow) => setShipFor(o), []);

  if (loading && orders.length === 0)
    return <div className="empty" style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center", padding: 60, color: C.dim }}><Loader2 size={18} className="spin" /> Loading orders…</div>;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap');
        .spin{animation:vspin 1s linear infinite;}@keyframes vspin{to{transform:rotate(360deg)}}
        @media(prefers-reduced-motion:reduce){.spin{animation-duration:.01ms}}
      `}</style>

      {/* liquidity ribbon */}
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 24, padding: "26px 30px", marginBottom: 22, boxShadow: "0 1px 3px rgba(28,25,19,.05)" }}>
        <Ribbon buckets={buckets} total={ribbonTotal} active={stateFilter} onPick={setStateFilter} />
      </div>

      {/* filters — reuse workspace classes so they match the rest of the app */}
      <div className="filters">
        <div className="relative flex items-center">
          <Search size={14} className="pointer-events-none absolute left-[11px]" style={{ color: C.faint }} />
          <input className="search pl-8" placeholder="Search number, customer, city, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="tabs" style={{ margin: 0 }}>
          {STORES.map((s) => <button key={s} className={store === s ? "tab on" : "tab"} onClick={() => setStore(s)}>{s}</button>)}
        </div>
        <div className="tabs ml-auto" style={{ margin: 0 }}>
          {WINDOWS.map((w) => <button key={w.label} className={days === w.days ? "tab on" : "tab"} onClick={() => setDays(w.days)}>{w.label}</button>)}
        </div>
        <select className="rounded-lg border px-3 py-2 text-[12.5px]" style={{ borderColor: C.line, background: C.card, color: C.ink }} value={location} onChange={(e) => setLocation(e.target.value)}>
          {locations.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      {/* active money-state filter chip */}
      <AnimatePresence>
        {stateFilter && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden", marginTop: 10 }}>
            <button onClick={() => setStateFilter(null)} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 14px", borderRadius: 999, border: `1px solid ${STATE_META[stateFilter].edge}`, background: STATE_META[stateFilter].bg, cursor: "pointer", color: STATE_META[stateFilter].color, fontSize: 12.5, fontWeight: 600 }}>
              <span style={{ width: 6, height: 6, borderRadius: 2, background: STATE_META[stateFilter].color, transform: "rotate(45deg)" }} /> Showing {STATE_META[stateFilter].label.toLowerCase()} · clear ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ledger */}
      {!loading && rows.length === 0 ? (
        <div className="empty" style={{ marginTop: 14, padding: "56px 20px", textAlign: "center", color: C.dim, border: `1px dashed ${C.line2}`, borderRadius: 18, background: C.card }}>
          <Package size={22} style={{ marginBottom: 10, opacity: 0.5 }} />
          <div style={{ fontSize: 14 }}>
            {store !== "All" || location !== "All locations" || qDebounced || stateFilter || days !== 30
              ? "No orders match these filters."
              : <>No orders in Supabase yet. Hit <b>Sync stores</b> to pull WA / UAE / KSA Shopify and WooCommerce orders.</>}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((o, i) => (
            <OrderCard
              key={o.uid} order={o} index={i}
              isOpen={expanded === o.uid}
              onToggleExpand={(uid) => setExpanded(expanded === uid ? null : uid)}
              onStageChanged={(stage) => patch(o.uid, { fulfillment_stage: stage })}
              onFinanceChanged={(fs) => patch(o.uid, { finance_status: fs })}
              onInvoice={() => onInvoice(o)}
              onShip={() => onShip(o)}
            />
          ))}
        </div>
      )}

      <p className="table-note" style={{ marginTop: 20, fontSize: 11.5, color: C.faint, textAlign: "center" }}>
        Page {page} of {totalPages} · {total} orders · settlement comes only from a bank-confirmed payout, never from the store's own “paid” flag.
      </p>

      {totalPages > 1 && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
          <button className="btn ghost small" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(p - 1, 1))}>Prev</button>
          <span style={{ fontSize: 12.5, color: C.dim }}>Page {page} of {totalPages}</span>
          <button className="btn ghost small" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(p + 1, totalPages))}>Next</button>
        </div>
      )}

      {invoiceFor && <InvoiceModal order={invoiceFor as any} onClose={() => setInvoiceFor(null)} />}
      {shipFor && (
        <ShipModal
          order={shipFor as any}
          onClose={() => setShipFor(null)}
          onShipped={(awb, labelUrl) => patch(shipFor.uid, { awb_number: awb, label_url: labelUrl, courier: "SMSA", fulfillment_stage: "shipped" })}
        />
      )}
    </>
  );
}