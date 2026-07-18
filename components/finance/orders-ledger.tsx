"use client";

/* Order ledger — expandable rows (not inline-editable; a costly action like
   invoice generation gets an explicit button, never a click meant for
   reading). Each row opens to product images, address, and the pack-and-ship
   status buttons. Animated with framer-motion so status changes and row
   expansion read as live, not as a page reflow.

   Ledger-specific styling is tailwind; shared design-system classes (btn,
   pill, tab, store-badge, mono, empty) still come from the workspace CSS,
   which this always renders inside — so the --gold/--line/etc. tokens resolve
   in the arbitrary-value classes below. */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check, ChevronDown, Loader2, MapPin, Package, PackageCheck,
  PackageOpen, Phone, Printer, Truck, Search,
} from "lucide-react";
import { toast } from "sonner";
import type { OrderRow } from "@/lib/types/orders";
import { ORDER_STATUS_META } from "@/lib/types/orders";
import { LOCATION_GROUPS, locationGroupFor } from "@/lib/orders-locations";
import { InvoiceModal } from "@/components/finance/invoice-modal";
import { ShipModal } from "@/components/finance/ship-modal";

// A "Ship" button only makes sense for international orders (SMSA covers
// KSA-domestic + beyond; Ontrack already handles UAE-local through the
// store's own courier flow) that don't already have an AWB.
function isShippable(o: OrderRow): boolean {
  return (o.country || "").trim().toUpperCase() !== "AE" && !o.awb_number;
}

const formatOrderDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const aed2 = (v: number) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", minimumFractionDigits: 2 }).format(v);

const STAGES = [
  { key: "processing", label: "Processing", icon: Package },
  { key: "packed", label: "Packed", icon: PackageOpen },
  { key: "shipped", label: "Shipped", icon: Truck },
  { key: "delivered", label: "Delivered", icon: PackageCheck },
] as const;

const STAGE_PILL: Record<string, string> = {
  processing: "bg-[#F3EFE7] text-[var(--gold-deep)]",
  packed: "bg-[var(--info-wash)] text-[var(--info)]",
  shipped: "bg-[var(--warn-wash)] text-[var(--warn)]",
  delivered: "bg-[var(--ok-wash)] text-[var(--ok)]",
};

type LineItem = { title: string; sku: string; qty: number; total_aed: number; image_url?: string; stock?: number | null };
type OrderDetail = OrderRow & { line_items: LineItem[] };

function StageTracker({ order, onChanged }: { order: OrderRow; onChanged: (stage: string) => void }) {
  const [updating, setUpdating] = useState<string | null>(null);
  const currentIdx = STAGES.findIndex((s) => s.key === order.fulfillment_stage);

  const advance = async (stage: string) => {
    if (stage === order.fulfillment_stage) return;
    setUpdating(stage);
    try {
      const res = await fetch(`/api/orders/${order.uid}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "update failed");
      onChanged(stage);
      toast.success(`#${order.order_number} → ${STAGES.find((s) => s.key === stage)?.label}`);
    } catch (e) {
      toast.error(`Status update failed: ${(e as Error).message}`);
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div className="flex items-center">
      {STAGES.map((s, i) => {
        const Icon = s.icon;
        const done = currentIdx >= 0 && i <= currentIdx;
        const active = s.key === order.fulfillment_stage;
        return (
          <div key={s.key} className="flex items-center">
            {i > 0 && (
              <motion.div
                className="mx-0.5 h-0.5 w-7"
                initial={false}
                animate={{ backgroundColor: i <= currentIdx ? "var(--gold)" : "var(--line)" }}
                transition={{ duration: 0.3 }}
              />
            )}
            <motion.button
              className={`relative flex size-[30px] shrink-0 items-center justify-center rounded-full border-[1.5px] disabled:cursor-wait ${
                active
                  ? "border-[var(--gold)] text-[var(--gold-deep)] shadow-[0_0_0_3px_var(--gold-wash)]"
                  : done
                    ? "border-[var(--gold)] bg-[var(--gold-wash)] text-[var(--gold-deep)]"
                    : "border-[var(--line-strong)] bg-[var(--card)] text-[var(--muted)]"
              }`}
              onClick={() => advance(s.key)}
              whileTap={{ scale: 0.92 }}
              whileHover={{ scale: 1.05 }}
              disabled={updating !== null}
              title={s.label}
            >
              {updating === s.key ? (
                <Loader2 size={14} className="animate-spin" />
              ) : done ? (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 15 }}>
                  <Check size={14} />
                </motion.span>
              ) : (
                <Icon size={14} />
              )}
            </motion.button>
          </div>
        );
      })}
    </div>
  );
}

function ExpandedOrder({ order, onStageChanged, onInvoice, onShip }: {
  order: OrderRow;
  onStageChanged: (stage: string) => void;
  onInvoice: () => void;
  onShip: () => void;
}) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/orders/${order.uid}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setDetail(d.order); })
      .catch(() => { if (!cancelled) setDetail(null); })
      .finally(() => { if (!cancelled) setLoadingDetail(false); });
    return () => { cancelled = true; };
  }, [order.uid]);

  return (
    <motion.div
      className="overflow-hidden"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <div className="border-t border-[var(--line)] px-[18px] pb-[18px] pt-1">
        <div className="grid grid-cols-1 gap-5 pt-4 md:grid-cols-[220px_1fr]">
          <div>
            <h4 className="mb-2.5 text-[10.5px] uppercase tracking-[.06em] text-[var(--muted)]">Ship to</h4>
            <div className="flex flex-col gap-[7px] text-[13px]">
              <div className="flex items-center gap-[7px]"><Phone size={12} /> {order.customer_phone || "—"}</div>
              <div className="flex items-center gap-[7px]"><MapPin size={12} /> {[order.city, order.country].filter(Boolean).join(", ") || "—"}</div>
              {order.courier && (
                <div className="mt-0.5 inline-flex w-fit items-center rounded-md bg-[var(--gold-wash)] px-2.5 py-[3px] text-[11px] font-semibold text-[var(--gold-deep)]">
                  {order.courier}{order.tracking_number ? ` · ${order.tracking_number}` : ""}
                </div>
              )}
            </div>
          </div>

          <div>
            <h4 className="mb-2.5 text-[10.5px] uppercase tracking-[.06em] text-[var(--muted)]">Items</h4>
            {loadingDetail ? (
              <div className="flex items-center gap-2 py-2 text-[12.5px] text-[var(--muted)]"><Loader2 size={14} className="animate-spin" /> Loading items…</div>
            ) : !detail?.line_items?.length ? (
              <div className="flex items-center gap-2 py-2 text-[12.5px] text-[var(--muted)]">No line items on this order.</div>
            ) : (
              <div className="flex flex-wrap gap-2.5">
                {detail.line_items.slice(0, 8).map((li, i) => (
                  <motion.div
                    key={`${li.sku}-${i}`}
                    className="flex w-24 flex-col gap-1.5"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    {li.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={li.image_url} alt={li.title} className="size-24 rounded-[10px] border border-[var(--line)] bg-[var(--cream)] object-cover" loading="lazy" />
                    ) : (
                      <div className="flex size-24 items-center justify-center rounded-[10px] border border-[var(--line)] bg-[var(--cream)] text-[var(--muted)]"><Package size={18} /></div>
                    )}
                    <div className="flex flex-col gap-px">
                      <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px]" title={li.title}>{li.title}</span>
                      <span className="text-[10.5px] text-[var(--muted)]">×{li.qty} · {aed2(li.total_aed)}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-[18px] flex flex-wrap items-center justify-between gap-4 border-t border-dashed border-[var(--line)] pt-4">
          <StageTracker order={order} onChanged={onStageChanged} />
          <div className="flex gap-2">
            {order.awb_number ? (
              <a className="btn small" href={`/api/orders/${order.uid}/label`} target="_blank" rel="noreferrer">
                <Truck size={13} /> AWB {order.awb_number}
              </a>
            ) : isShippable(order) ? (
              <button className="btn small" onClick={onShip}>
                <Truck size={13} /> Ship
              </button>
            ) : null}
            <button className="btn primary small" onClick={onInvoice}>
              <Printer size={13} /> Invoice
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

const OrderCard = React.memo(function OrderCard({
  order, displayOrder, isOpen, isSelected, onToggleSelect, onToggleExpand, onStageChanged, onInvoice, onShip,
}: {
  order: OrderRow; displayOrder: OrderRow; isOpen: boolean; isSelected: boolean;
  onToggleSelect: (uid: string) => void; onToggleExpand: (uid: string) => void;
  onStageChanged: (stage: string) => void; onInvoice: () => void; onShip: () => void;
}) {
  const stage = displayOrder.fulfillment_stage ?? "processing";
  const m = ORDER_STATUS_META[order.finance_status];
  const group = locationGroupFor(order.city);
  return (
    <div
      className={`overflow-hidden rounded-[14px] border bg-[var(--card)] transition-[border-color,box-shadow] ${
        isOpen ? "border-[var(--gold)] shadow-[0_4px_18px_rgba(176,131,67,.12)]" : "border-[var(--line)]"
      }`}
    >
      <div className="flex items-center gap-1.5 pl-3.5">
        <input
          type="checkbox"
          className="size-4 shrink-0 cursor-pointer accent-[var(--gold)]"
          checked={isSelected}
          onChange={() => onToggleSelect(order.uid)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select order #${order.order_number}`}
        />
        <button
          className="grid w-full grid-cols-[130px_1fr_150px_90px_100px_110px_90px_20px] items-center gap-3 px-4 py-[13px] text-left text-[13px]"
          onClick={() => onToggleExpand(order.uid)}
        >
          <div className="flex flex-col gap-0.5">
            <span className="mono">#{order.order_number}</span>
            <span className="store-badge w-fit">{order.store_id}</span>
            <span className="text-[10.5px] text-[var(--muted)]">{formatOrderDate(order.order_date)}</span>
          </div>
          <div className="overflow-hidden text-ellipsis whitespace-nowrap" dir="auto">{order.customer_name || "—"}</div>
          <div className="flex items-center gap-[5px] overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-[var(--muted)]">
            <MapPin size={12} />
            {group ?? [order.city, order.country].filter(Boolean).join(", ") ?? "—"}
          </div>
          <div className="text-[12.5px] text-[var(--muted)]">{order.gateway}</div>
          <span className={`rounded-full px-2.5 py-[3px] text-center text-[10.5px] font-semibold uppercase tracking-[.03em] ${STAGE_PILL[stage] ?? STAGE_PILL.processing}`}>
            {STAGES.find((s) => s.key === stage)?.label ?? stage}
          </span>
          <span className={`pill ${m.tone}`}>{m.label}</span>
          <span className="mono text-right font-semibold">{aed2(Number(order.gross_aed))}</span>
          <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-[var(--muted)]">
            <ChevronDown size={16} />
          </motion.span>
        </button>
      </div>
      <AnimatePresence initial={false}>
        {isOpen && (
          <ExpandedOrder
            order={displayOrder}
            onStageChanged={onStageChanged}
            onInvoice={onInvoice}
            onShip={onShip}
          />
        )}
      </AnimatePresence>
    </div>
  );
}, (prev, next) =>
  prev.order === next.order &&
  prev.displayOrder.fulfillment_stage === next.displayOrder.fulfillment_stage &&
  prev.displayOrder.awb_number === next.displayOrder.awb_number &&
  prev.displayOrder.label_url === next.displayOrder.label_url &&
  prev.displayOrder.courier === next.displayOrder.courier &&
  prev.isOpen === next.isOpen &&
  prev.isSelected === next.isSelected,
);

const PAGE_SIZE = 50;

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Orders still waiting behind the one currently open in InvoiceModal —
  // "generate N invoices" doesn't skip the per-order confirmation step, it
  // just chains it: closing (cancel or generate) advances to the next one.
  const [invoiceQueue, setInvoiceQueue] = useState<OrderRow[]>([]);
  // Patches from status changes / a completed shipment, applied on top of
  // the fetched page so a row updates in place without a full refetch.
  const [overrides, setOverrides] = useState<Record<string, Partial<OrderRow>>>({});

  const stores = ["All", "WA", "UAE", "KSA", "WOO"];
  const locations = ["All locations", ...Object.keys(LOCATION_GROUPS)];
  const dateWindows = [
    { label: "30d", days: 30 }, { label: "90d", days: 90 },
    { label: "1yr", days: 365 }, { label: "All time", days: 0 },
  ];

  // Debounce free-text search only — store/location/days/page changes fetch
  // immediately, a keystroke doesn't.
  useEffect(() => {
    const id = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(id);
  }, [q]);

  // Any filter change resets to page 1 — only page-button clicks should
  // change `page` on their own.
  useEffect(() => { setPage(1); }, [store, location, days, qDebounced]);

  useEffect(() => {
    let cancelledFetch = false;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), days: String(days) });
    if (store !== "All") params.set("store", store);
    if (location !== "All locations") params.set("location", location);
    if (qDebounced) params.set("q", qDebounced);
    fetch(`/api/orders?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelledFetch) return;
        setOrders(d.orders ?? []);
        setTotal(d.total ?? 0);
      })
      .catch(() => { if (!cancelledFetch) { setOrders([]); setTotal(0); } })
      .finally(() => { if (!cancelledFetch) setLoading(false); });
    return () => { cancelledFetch = true; };
  }, [page, store, location, days, qDebounced]);

  const rows = orders;
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const patch = useCallback((uid: string, fields: Partial<OrderRow>) => {
    setOverrides((prev) => ({ ...prev, [uid]: { ...prev[uid], ...fields } }));
  }, []);

  const toggleSelect = useCallback((uid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  }, []);

  const startBulkInvoice = () => {
    const chosen = rows.filter((o) => selected.has(o.uid));
    if (chosen.length === 0) return;
    setInvoiceFor(chosen[0]);
    setInvoiceQueue(chosen.slice(1));
  };

  // Fires on Cancel and on a successful generate (generate() calls onClose
  // itself) — either way, move to the next queued order, or finish up.
  const advanceInvoiceQueue = () => {
    if (invoiceQueue.length > 0) {
      const [next, ...rest] = invoiceQueue;
      setInvoiceFor(next);
      setInvoiceQueue(rest);
    } else {
      setInvoiceFor(null);
      setSelected(new Set());
    }
  };

  if (loading && orders.length === 0) return <div className="empty"><Loader2 size={18} className="animate-spin" /> Loading orders…</div>;
  if (!loading && total === 0) {
    const filtered = store !== "All" || location !== "All locations" || qDebounced !== "" || days !== 30;
    return (
      <div className="empty">
        {filtered
          ? "No orders match these filters."
          : <>No orders in Supabase yet. Hit <b>Sync stores</b> to pull WA / UAE / KSA Shopify and WooCommerce orders.</>}
      </div>
    );
  }

  return (
    <>
      <div className="filters">
        <div className="relative flex items-center">
          <Search size={14} className="pointer-events-none absolute left-[11px] text-[var(--muted)]" />
          <input className="search pl-8" placeholder="Search number, customer, city, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="tabs" style={{ margin: 0 }}>
          {stores.map((s, index) => (
            <button key={`${s} ${index}`} className={store === s ? "tab on" : "tab"} onClick={() => setStore(s)}>{s}</button>
          ))}
        </div>
        <div className="tabs ml-auto" style={{ margin: 0 }}>
          {dateWindows.map((w) => (
            <button key={w.label} className={days === w.days ? "tab on" : "tab"} onClick={() => setDays(w.days)}>{w.label}</button>
          ))}
        </div>
        <select className="rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-[12.5px] text-[var(--ink)]" value={location} onChange={(e) => setLocation(e.target.value)}>
          {locations.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      {selected.size > 0 && (
        <div className="mt-2.5 flex items-center gap-3 rounded-xl border border-[var(--gold)] bg-[var(--gold-wash)] px-4 py-2.5 text-[13px] font-medium text-[var(--gold-deep)]">
          <span>{selected.size} selected</span>
          <button className="btn primary small ml-auto" onClick={startBulkInvoice}>
            <Printer size={13} /> Generate {selected.size} invoice{selected.size > 1 ? "s" : ""}
          </button>
          <button className="btn ghost small" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="mt-1 flex flex-col gap-2.5">
        {rows.map((o) => {
          const displayOrder = { ...o, ...overrides[o.uid] };
          const isOpen = expanded === o.uid;
          return (
            <OrderCard
              key={o.uid}
              order={o}
              displayOrder={displayOrder}
              isOpen={isOpen}
              isSelected={selected.has(o.uid)}
              onToggleSelect={toggleSelect}
              onToggleExpand={(uid) => setExpanded(isOpen ? null : uid)}
              onStageChanged={(newStage) => patch(o.uid, { fulfillment_stage: newStage })}
              onInvoice={() => setInvoiceFor(displayOrder)}
              onShip={() => setShipFor(displayOrder)}
            />
          );
        })}
      </div>

      <p className="table-note">Page {page} of {totalPages} · {total} orders total · settlement comes only from a bank-confirmed payout, never from the store's own "paid" flag.</p>

      {totalPages > 1 && (
        <div className="mt-2 flex items-center justify-center gap-3">
          <button className="btn ghost small" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(p - 1, 1))}>
            Prev
          </button>
          <span className="text-[12.5px] text-[var(--muted)]">Page {page} of {totalPages}</span>
          <button className="btn ghost small" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(p + 1, totalPages))}>
            Next
          </button>
        </div>
      )}

      {invoiceFor && (
        <InvoiceModal order={invoiceFor} onClose={advanceInvoiceQueue} queueRemaining={invoiceQueue.length} />
      )}
      {shipFor && (
        <ShipModal
          order={shipFor}
          onClose={() => setShipFor(null)}
          onShipped={(awb, labelUrl) => patch(shipFor.uid, { awb_number: awb, label_url: labelUrl, courier: "SMSA", fulfillment_stage: "shipped" })}
        />
      )}
    </>
  );
}
