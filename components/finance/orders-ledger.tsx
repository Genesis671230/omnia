"use client";

/* Order ledger — expandable rows (not inline-editable; a costly action like
   invoice generation gets an explicit button, never a click meant for
   reading). Each row opens to product images, address, and the pack-and-ship
   status buttons. Animated with framer-motion so status changes and row
   expansion read as live, not as a page reflow. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check, ChevronDown, Loader2, MapPin, Package, PackageCheck,
  PackageOpen, Phone, Printer, Truck, Search,
} from "lucide-react";
import { toast } from "sonner";
import type { OrderRow } from "@/lib/types/orders";
import { ORDER_STATUS_META } from "@/lib/types/orders";
import { InvoiceModal, INVOICE_MODAL_CSS } from "@/components/finance/invoice-modal";
import { ShipModal, SHIP_MODAL_CSS } from "@/components/finance/ship-modal";

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

// Known cities per emirate/region, for the location filter dropdown. Matched
// case-insensitively against the order's `city` field, which is free text
// synced from Shopify/Woo — not every order will match a known group, so an
// unmatched order still shows up under "All locations".
const LOCATION_GROUPS: Record<string, string[]> = {
  "Dubai": ["dubai"],
  "Abu Dhabi": ["abu dhabi", "abudhabi"],
  "Sharjah": ["sharjah"],
  "Riyadh": ["riyadh"],
  "Jeddah": ["jeddah", "jedda"],
  "Other UAE": ["ajman", "fujairah", "ras al khaimah", "rak", "umm al quwain"],
  "Other KSA": ["dammam", "khobar", "mecca", "makkah", "medina"],
};

function locationGroupFor(city: string): string | null {
  const c = (city || "").toLowerCase();
  for (const [group, keywords] of Object.entries(LOCATION_GROUPS)) {
    if (keywords.some((k) => c.includes(k))) return group;
  }
  return null;
}

const STAGES = [
  { key: "processing", label: "Processing", icon: Package },
  { key: "packed", label: "Packed", icon: PackageOpen },
  { key: "shipped", label: "Shipped", icon: Truck },
  { key: "delivered", label: "Delivered", icon: PackageCheck },
] as const;

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
    <div className="stage-tracker">
      {STAGES.map((s, i) => {
        const Icon = s.icon;
        const done = currentIdx >= 0 && i <= currentIdx;
        const active = s.key === order.fulfillment_stage;
        return (
          <div key={s.key} className="stage-item">
            {i > 0 && (
              <motion.div
                className="stage-line"
                initial={false}
                animate={{ backgroundColor: i <= currentIdx ? "var(--gold)" : "var(--line)" }}
                transition={{ duration: 0.3 }}
              />
            )}
            <motion.button
              className={`stage-btn ${done ? "done" : ""} ${active ? "active" : ""}`}
              onClick={() => advance(s.key)}
              whileTap={{ scale: 0.92 }}
              whileHover={{ scale: 1.05 }}
              disabled={updating !== null}
              title={s.label}
            >
              {updating === s.key ? (
                <Loader2 size={14} className="spin" />
              ) : done ? (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 15 }}>
                  <Check size={14} />
                </motion.span>
              ) : (
                <Icon size={14} />
              )}
            </motion.button>
            <span className={`stage-label ${active ? "active" : ""}`}>{s.label}</span>
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
      className="row-expand"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      style={{ overflow: "hidden" }}
    >
      <div className="row-expand-inner">
        <div className="expand-grid">
          <div className="expand-col">
            <h4>Ship to</h4>
            <div className="ship-info">
              <div><Phone size={12} /> {order.customer_phone || "—"}</div>
              <div><MapPin size={12} /> {[order.city, order.country].filter(Boolean).join(", ") || "—"}</div>
              {order.courier && <div className="courier-chip">{order.courier}{order.tracking_number ? ` · ${order.tracking_number}` : ""}</div>}
            </div>
          </div>

          <div className="expand-col span2">
            <h4>Items</h4>
            {loadingDetail ? (
              <div className="quiet-row"><Loader2 size={14} className="spin" /> Loading items…</div>
            ) : !detail?.line_items?.length ? (
              <div className="quiet-row">No line items on this order.</div>
            ) : (
              <div className="item-strip">
                {detail.line_items.slice(0, 8).map((li, i) => (
                  <motion.div
                    key={`${li.sku}-${i}`}
                    className="item-card"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    {li.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={li.image_url} alt={li.title} className="item-img" loading="lazy" />
                    ) : (
                      <div className="item-img placeholder"><Package size={18} /></div>
                    )}
                    <div className="item-meta">
                      <span className="item-title" title={li.title}>{li.title}</span>
                      <span className="item-sub">×{li.qty} · {aed2(li.total_aed)}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="expand-footer">
          <StageTracker order={order} onChanged={onStageChanged} />
          <div className="expand-actions">
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

export function OrdersLedger({ orders, loading }: { orders: OrderRow[]; loading: boolean }) {
  const [store, setStore] = useState("All");
  const [location, setLocation] = useState("All locations");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<OrderRow | null>(null);
  const [shipFor, setShipFor] = useState<OrderRow | null>(null);
  // Patches from status changes / a completed shipment, applied on top of
  // the fetched order so the row updates in place without a full refetch.
  const [overrides, setOverrides] = useState<Record<string, Partial<OrderRow>>>({});

  const stores = ["All", "WA", "UAE", "KSA", "WOO"];
  const locations = ["All locations", ...Object.keys(LOCATION_GROUPS)];

  const rows = useMemo(() => orders.filter((o) => {
    if (store !== "All" && o.store_id !== store) return false;
    if (location !== "All locations" && locationGroupFor(o.city) !== location) return false;
    const haystack = `${o.order_number} ${o.customer_name} ${o.gateway} ${o.city} ${o.country} ${o.customer_phone}`.toLowerCase();
    return haystack.includes(q.toLowerCase());
  }), [orders, store, location, q]);

  const patch = useCallback((uid: string, fields: Partial<OrderRow>) => {
    setOverrides((prev) => ({ ...prev, [uid]: { ...prev[uid], ...fields } }));
  }, []);

  if (loading) return <div className="empty"><Loader2 size={18} className="spin" /> Loading orders…</div>;
  if (orders.length === 0) {
    return (
      <div className="empty">
        No orders in Supabase yet. Hit <b>Sync stores</b> to pull WA / UAE / KSA Shopify and WooCommerce orders.
      </div>
    );
  }

  return (
    <>
      <div className="filters">
        <div className="search-wrap">
          <Search size={14} />
          <input className="search" placeholder="Search number, customer, city, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="tabs" style={{ margin: 0 }}>
          {stores.map((s, index) => (
            <button key={`${s} ${index}`} className={store === s ? "tab on" : "tab"} onClick={() => setStore(s)}>{s}</button>
          ))}
        </div>
        <select className="loc-select" value={location} onChange={(e) => setLocation(e.target.value)}>
          {locations.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      <div className="order-cards">
        {rows.map((o) => {
          const displayOrder = { ...o, ...overrides[o.uid] };
          const stage = displayOrder.fulfillment_stage ?? "processing";
          const m = ORDER_STATUS_META[o.finance_status];
          const isOpen = expanded === o.uid;
          const group = locationGroupFor(o.city);
          return (
            <div key={o.uid} className={`order-card ${isOpen ? "open" : ""}`}>
              <button className="order-card-head" onClick={() => setExpanded(isOpen ? null : o.uid)}>
                <div className="oc-order">
                  <span className="mono">#{o.order_number}</span>
                  <span className="store-badge">{o.store_id}</span>
                  <span className="oc-date">{formatOrderDate(o.order_date)}</span>
                </div>
                <div className="oc-customer" dir="auto">{o.customer_name || "—"}</div>
                <div className="oc-location">
                  <MapPin size={12} />
                  {group ?? [o.city, o.country].filter(Boolean).join(", ") ?? "—"}
                </div>
                <div className="oc-gateway">{o.gateway}</div>
                <span className={`stage-pill ${stage}`}>
                  {STAGES.find((s) => s.key === stage)?.label ?? stage}
                </span>
                <span className={`pill ${m.tone}`}>{m.label}</span>
                <span className="mono oc-amount">{aed2(Number(o.gross_aed))}</span>
                <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }} className="chev">
                  <ChevronDown size={16} />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <ExpandedOrder
                    order={displayOrder}
                    onStageChanged={(newStage) => patch(o.uid, { fulfillment_stage: newStage })}
                    onInvoice={() => setInvoiceFor(o)}
                    onShip={() => setShipFor(displayOrder)}
                  />
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <p className="table-note">{rows.length} of {orders.length} orders · settlement comes only from a bank-confirmed payout, never from the store's own "paid" flag.</p>

      {invoiceFor && <InvoiceModal order={invoiceFor} onClose={() => setInvoiceFor(null)} />}
      {shipFor && (
        <ShipModal
          order={shipFor}
          onClose={() => setShipFor(null)}
          onShipped={(awb, labelUrl) => patch(shipFor.uid, { awb_number: awb, label_url: labelUrl, courier: "SMSA", fulfillment_stage: "shipped" })}
        />
      )}

      <style jsx global>{ORDERS_LEDGER_CSS}</style>
      <style jsx global>{INVOICE_MODAL_CSS}</style>
      <style jsx global>{SHIP_MODAL_CSS}</style>
    </>
  );
}

const ORDERS_LEDGER_CSS = `
  .search-wrap { position: relative; display: flex; align-items: center; }
  .search-wrap svg { position: absolute; left: 11px; color: var(--muted); pointer-events: none; }
  .search-wrap .search { padding-left: 32px; }
  .loc-select { border: 1px solid var(--line); background: var(--card); border-radius: 8px; padding: 8px 12px; font-size: 12.5px; color: var(--ink); margin-left: auto; }

  .order-cards { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; }
  .order-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; transition: border-color .15s, box-shadow .15s; }
  .order-card.open { border-color: var(--gold); box-shadow: 0 4px 18px rgba(176,131,67,.12); }
  .order-card-head {
    width: 100%; border: 0; background: transparent; cursor: pointer; padding: 13px 16px;
    display: grid; grid-template-columns: 130px 1fr 150px 90px 100px 110px 90px 20px;
    align-items: center; gap: 12px; text-align: left; font-size: 13px;
  }
  .oc-order { display: flex; flex-direction: column; gap: 2px; }
  .oc-order .store-badge { width: fit-content; }
  .oc-date { font-size: 10.5px; color: var(--muted); }
  .oc-customer { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .oc-location { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .oc-gateway { color: var(--muted); font-size: 12.5px; }
  .oc-amount { text-align: right; font-weight: 600; }

  .stage-pill { font-size: 10.5px; font-weight: 600; padding: 3px 9px; border-radius: 999px; text-align: center; text-transform: uppercase; letter-spacing: .03em; }
  .stage-pill.processing { background: #F3EFE7; color: var(--gold-deep); }
  .stage-pill.packed { background: var(--info-wash, #E8F1F3); color: var(--info, #2E6B7A); }
  .stage-pill.shipped { background: var(--warn-wash); color: var(--warn); }
  .stage-pill.delivered { background: var(--ok-wash); color: var(--ok); }

  .row-expand-inner { padding: 4px 18px 18px; border-top: 1px solid var(--line); }
  .expand-grid { display: grid; grid-template-columns: 220px 1fr; gap: 20px; padding-top: 16px; }
  .expand-col h4 { margin: 0 0 10px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  .ship-info { display: flex; flex-direction: column; gap: 7px; font-size: 13px; }
  .ship-info > div { display: flex; align-items: center; gap: 7px; }
  .courier-chip { display: inline-flex; width: fit-content; background: var(--gold-wash); color: var(--gold-deep); font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 6px; margin-top: 2px; }

  .item-strip { display: flex; gap: 10px; flex-wrap: wrap; }
  .item-card { display: flex; flex-direction: column; gap: 6px; width: 96px; }
  .item-img { width: 96px; height: 96px; object-fit: cover; border-radius: 10px; border: 1px solid var(--line); background: var(--cream); }
  .item-img.placeholder { display: flex; align-items: center; justify-content: center; color: var(--muted); }
  .item-meta { display: flex; flex-direction: column; gap: 1px; }
  .item-title { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item-sub { font-size: 10.5px; color: var(--muted); }
  .quiet-row { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12.5px; padding: 8px 0; }

  .expand-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 18px; padding-top: 16px; border-top: 1px dashed var(--line); gap: 16px; flex-wrap: wrap; }
  .expand-actions { display: flex; gap: 8px; }

  .stage-tracker { display: flex; align-items: center; }
  .stage-item { display: flex; align-items: center; }
  .stage-item:first-child .stage-line { display: none; }
  .stage-line { width: 28px; height: 2px; margin: 0 2px; }
  .stage-btn {
    width: 30px; height: 30px; border-radius: 50%; border: 1.5px solid var(--line-strong);
    background: var(--card); color: var(--muted); display: flex; align-items: center; justify-content: center;
    cursor: pointer; flex-shrink: 0; position: relative;
  }
  .stage-btn.done { background: var(--gold-wash); border-color: var(--gold); color: var(--gold-deep); }
  .stage-btn.active { border-color: var(--gold); color: var(--gold-deep); box-shadow: 0 0 0 3px var(--gold-wash); }
  .stage-btn:disabled { cursor: wait; }
  .stage-item { flex-direction: column; }
  .stage-label { display: none; }
  @media (min-width: 900px) {
    .stage-item { flex-direction: row; }
  }

  .btn.small { padding: 6px 12px; font-size: 12px; }
`;
