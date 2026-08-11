"use client";
import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, Loader2, Warehouse, FileText, Package, Truck, XCircle,
  Clock, User, ExternalLink, Download, ShieldCheck, BadgeCheck, RotateCw,
  Printer, ArrowUpRight, ChevronDown, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import type { OrderRow } from "@/lib/types/orders";
import type { FinanceStatus, ZohoState } from "@/lib/hooks/use-order-actions";

const C = {
  paper: "#F7F3EA", card: "#FFFFFF", raise: "#FBF8F1",
  line: "#EBE5D6", line2: "#DED6C2",
  ink: "#1C1913", body: "#5C5647", dim: "#8C8574", faint: "#B0A896",
  mint: "#3E8F63", mintBg: "#E7F1EA", mintEdge: "#BEDDC9",
  amber: "#B67C1E", amberBg: "#F7EDD7", amberEdge: "#E4CE9A",
  coral: "#C15540", coralBg: "#F7E7E1", coralEdge: "#E6C1B4",
  stone: "#7C7565", stoneBg: "#F0ECE1", stoneEdge: "#DCD4C4",
  gild: "#9A7526",
};

// The full lifecycle: sourced from confirmed → shipped-and-tracked
const FLOW = [
  { key: "confirmed",  label: "Confirm order",   icon: CheckCircle2, verb: "Confirm" },
  { key: "reserved",   label: "Reserve stock",   icon: Warehouse,    verb: "Reserve" },
  { key: "invoiced",   label: "Generate invoice", icon: FileText,     verb: "Generate invoice" },
  { key: "labeled",    label: "Generate AWB",    icon: Package,      verb: "Generate label" },
  { key: "shipped",    label: "Handed to SMSA",  icon: Truck,        verb: "Mark dispatched" },
] as const;
type StageKey = typeof FLOW[number]["key"];

type Attachment = {
  id: string; kind: string; provider: string;
  external_ref: string | null; url: string;
  created_at: string; created_by: string; metadata: any;
};

type Event = {
  id: string; actor: string; kind: string;
  from_state: string | null; to_state: string | null;
  payload: any; created_at: string;
};

type FulfillmentOption = {
  warehouse_id: string; warehouse_name: string;
  can_fulfill: boolean; blockers: any[];
};

export function FulfillmentSpine({
  order, detail, onStageChanged, onFinanceChanged, onInvoice, onShip,
  actions, zoho, setZoho, wrap,
}: any) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [options, setOptions] = useState<FulfillmentOption[] | null>(null);
  const [selectedWh, setSelectedWh] = useState<string | null>(null);
  const [busyStep, setBusyStep] = useState<StageKey | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const stage = (order.fulfillment_stage || "new") as StageKey | "new" | "processing";
  const idx = FLOW.findIndex((s) => s.key === stage);

  const load = useCallback(async () => {
    try {
      const [a, e] = await Promise.all([
        fetch(`/api/orders/${order.uid}/attachments`).then((r) => r.json()),
        fetch(`/api/orders/${order.uid}/events`).then((r) => r.json()),
      ]);
      setAttachments(a.attachments ?? []);
      setEvents(e.events ?? []);
    } catch {}
  }, [order.uid]);
  useEffect(() => { load(); }, [load]);

  // Load fulfillment options when it's time to reserve
  useEffect(() => {
    if (idx === 0 && !options) {
      fetch(`/api/orders/${order.uid}/fulfillment-options`)
        .then((r) => r.json()).then((d) => setOptions(d.options ?? []))
        .catch((e) => toast.error(`load options: ${e.message}`));
    }
  }, [idx, order.uid, options]);

  async function post(path: string, body: any = {}): Promise<any> {
    const res = await fetch(`/api/orders/${order.uid}/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `${path} failed (${res.status})`);
    }
    return data;
  }

  const run = async (step: StageKey, fn: () => Promise<void>) => {
    setBusyStep(step);
    try { await fn(); await load(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusyStep(null); }
  };

  const stepActions: Record<StageKey, () => Promise<void>> = {
    confirmed: async () => {
      await post("confirm");
      onStageChanged("confirmed");
      toast.success("Order confirmed");
    },
    reserved: async () => {
      if (!selectedWh) { toast.error("Pick a warehouse"); return; }
      const d = await post("reserve", { warehouse_id: selectedWh });
      onStageChanged("reserved");
      toast.success(`Reserved from ${d.warehouse_name}`);
    },
    invoiced: async () => {
      // Opens your existing InvoiceModal, which on success posts to /invoice
      onInvoice();
    },
    labeled: async () => {
      // Opens your existing ShipModal, which on success posts to /ship
      onShip();
    },
    shipped: async () => {
      await post("dispatch");
      onStageChanged("shipped");
      toast.success("Marked dispatched");
    },
  };

  const invoicePdf = attachments.find((a) => a.kind === "invoice_pdf");
  const awbLabel = attachments.find((a) => a.kind === "awb_label");
  const zohoInv = attachments.find((a) => a.kind === "zoho_invoice") ??
    (zoho?.invoiceId ? { url: zoho.invoiceUrl, external_ref: zoho.invoiceId, kind: "zoho_invoice" } as any : null);

  return (
    <div style={{ marginTop: 22, paddingTop: 20, borderTop: `1px solid ${C.line}`, display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── the spine ── */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: C.faint, fontWeight: 700 }}>Fulfilment</span>
          {events.length > 0 && (
            <button onClick={() => setHistoryOpen((v) => !v)} style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              background: "none", border: "none", cursor: "pointer",
              fontSize: 11.5, color: C.dim,
            }}>
              <Clock size={11} /> {events.length} event{events.length !== 1 ? "s" : ""}
              <ChevronDown size={11} style={{ transform: historyOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
            </button>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: `repeat(${FLOW.length}, 1fr)`, gap: 0, position: "relative" }}>
          {/* progress line */}
          <div style={{ position: "absolute", top: 18, left: 24, right: 24, height: 2, background: C.line2, zIndex: 0 }} />
          <motion.div
            initial={{ scaleX: 0 }} animate={{ scaleX: Math.max(0, idx) / (FLOW.length - 1) }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            style={{ position: "absolute", top: 18, left: 24, right: 24, height: 2, background: C.gild, zIndex: 0, transformOrigin: "left" }}
          />

          {FLOW.map((step, i) => {
            const done = idx > i;
            const active = idx + 1 === i;
            const busy = busyStep === step.key;
            const StepIcon = step.icon;
            return (
              <div key={step.key} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, zIndex: 1 }}>
                <motion.button
                  disabled={!active || busy}
                  onClick={() => active && run(step.key, stepActions[step.key])}
                  whileHover={active ? { scale: 1.06 } : {}}
                  whileTap={active ? { scale: 0.94 } : {}}
                  style={{
                    width: 36, height: 36, borderRadius: "50%",
                    display: "grid", placeItems: "center",
                    background: done ? C.gild : active ? C.card : C.raise,
                    border: `1.5px solid ${done ? C.gild : active ? C.gild : C.line2}`,
                    color: done ? "#fff" : active ? C.gild : C.faint,
                    cursor: active && !busy ? "pointer" : "default",
                    boxShadow: active ? "0 0 0 4px rgba(154,117,38,.12)" : "none",
                    transition: "all .2s",
                  }}
                >
                  {busy ? <Loader2 size={15} className="spin" /> : done ? <CheckCircle2 size={15} /> : <StepIcon size={15} />}
                </motion.button>
                <span style={{ fontSize: 10.5, color: active ? C.ink : done ? C.dim : C.faint, textAlign: "center", fontWeight: active ? 600 : 400, lineHeight: 1.2 }}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* active-step control panel */}
        <AnimatePresence mode="wait">
          {idx === 0 && (
            <motion.div key="reserve-panel"
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              style={{ marginTop: 16, padding: 14, background: C.raise, border: `1px solid ${C.line}`, borderRadius: 12 }}>
              <div style={{ fontSize: 11.5, color: C.dim, marginBottom: 10 }}>Choose the warehouse to fulfil this order from:</div>
              {options === null ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: C.dim }}>
                  <Loader2 size={13} className="spin" /> Checking stock across warehouses…
                </div>
              ) : options.length === 0 ? (
                <div style={{ fontSize: 12, color: C.coral }}>No warehouses available for this order.</div>
              ) : (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {options.map((o) => (
                    <button key={o.warehouse_id}
                      onClick={() => o.can_fulfill && setSelectedWh(o.warehouse_id)}
                      disabled={!o.can_fulfill}
                      style={{
                        display: "flex", flexDirection: "column", gap: 4, minWidth: 200,
                        padding: "10px 14px", borderRadius: 10, textAlign: "left",
                        background: selectedWh === o.warehouse_id ? C.mintBg : C.card,
                        border: `1.5px solid ${selectedWh === o.warehouse_id ? C.mint : C.line2}`,
                        cursor: o.can_fulfill ? "pointer" : "not-allowed",
                        opacity: o.can_fulfill ? 1 : 0.5,
                      }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{o.warehouse_name}</span>
                      {o.can_fulfill ? (
                        <span style={{ fontSize: 11, color: C.mint, display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <CheckCircle2 size={11} /> All items available
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: C.coral, display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <XCircle size={11} /> {o.blockers.length} SKU{o.blockers.length !== 1 ? "s" : ""} short
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {selectedWh && (
                <button onClick={() => run("reserved", stepActions.reserved)} disabled={busyStep === "reserved"}
                  style={{
                    marginTop: 12, padding: "8px 16px", borderRadius: 8, border: "none",
                    background: C.gild, color: "#fff", fontSize: 12.5, fontWeight: 600,
                    cursor: busyStep === "reserved" ? "wait" : "pointer",
                    display: "inline-flex", alignItems: "center", gap: 6,
                  }}>
                  {busyStep === "reserved" && <Loader2 size={12} className="spin" />}
                  Reserve from {options?.find((o) => o.warehouse_id === selectedWh)?.warehouse_name}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── documents strip ── */}
      {(invoicePdf || awbLabel || zohoInv) && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: 12, background: C.raise, border: `1px solid ${C.line}`, borderRadius: 12 }}>
          <span style={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: C.faint, fontWeight: 700, alignSelf: "center", marginRight: 4 }}>Documents</span>
          {invoicePdf && (
            <DocChip href={invoicePdf.url} icon={<Printer size={12} />} label="Invoice PDF"
              sub={new Date(invoicePdf.created_at).toLocaleDateString("en-GB")} color={C.gild} />
          )}
          {awbLabel && (
            <DocChip href={awbLabel.url} icon={<Package size={12} />} label={`AWB ${awbLabel.external_ref}`}
              sub="SMSA label" color={C.mint} />
          )}
          {zohoInv && (
            <DocChip href={zohoInv.url} icon={<ExternalLink size={12} />} label={`Zoho ${zohoInv.external_ref}`}
              sub="Books" color={C.amber} />
          )}
        </div>
      )}

      {/* ── secondary actions (finance / zoho / cancel / refund) ── */}
      <SecondaryActions order={order} actions={actions} zoho={zoho} setZoho={setZoho}
        onFinanceChanged={onFinanceChanged} onInvoice={onInvoice} wrap={wrap} reload={load} />

      {/* ── event history ── */}
      <AnimatePresence>
        {historyOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            style={{ overflow: "hidden" }}>
            <EventLog events={events} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DocChip({ href, icon, label, sub, color }: any) {
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      padding: "6px 12px", borderRadius: 999,
      background: C.card, border: `1px solid ${C.line2}`,
      textDecoration: "none", color: C.ink, fontSize: 12,
    }}>
      <span style={{ color, display: "inline-flex" }}>{icon}</span>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <span style={{ color: C.faint, fontSize: 10.5 }}>· {sub}</span>
      <Download size={11} color={C.faint} />
    </a>
  );
}

function SecondaryActions({ order, actions, zoho, setZoho, onFinanceChanged, wrap, reload }: any) {
  const [confirm, setConfirm] = useState<null | "cancel" | "refund">(null);
  const settled = order.finance_status === "SETTLED";
  const isException = Boolean(order.ship_error);
  const zohoPushed = Boolean(zoho?.invoiceId);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
      {isException ? (
        <MiniBtn onClick={() => wrap(actions.setFinanceStatus("AWAITING_BANK"), "Cleared").then((r: any) => r && onFinanceChanged("AWAITING_BANK"))}
          icon={<ShieldCheck size={12} />} label="Clear exception" busy={actions.pending === "finance"} />
      ) : !settled ? (
        <MiniBtn tone="mint" onClick={() => wrap(actions.setFinanceStatus("SETTLED"), "Marked settled").then((r: any) => r && onFinanceChanged("SETTLED"))}
          icon={<BadgeCheck size={12} />} label="Mark settled" busy={actions.pending === "finance"} />
      ) : (
        <MiniBtn onClick={() => wrap(actions.setFinanceStatus("AWAITING_BANK"), "Reverted").then((r: any) => r && onFinanceChanged("AWAITING_BANK"))}
          icon={<RotateCw size={12} />} label="Unsettle" busy={actions.pending === "finance"} />
      )}

      {!zohoPushed && (
        <MiniBtn onClick={() => wrap(actions.pushToZoho(), "Pushed to Zoho").then((r: any) => { if (r) { setZoho({ invoiceId: r.invoiceId, invoiceUrl: r.invoiceUrl, syncedAt: new Date().toISOString() }); reload(); } })}
          icon={<ArrowUpRight size={12} />} label="Push to Zoho" busy={actions.pending === "zoho"} />
      )}

      {confirm ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 10px", borderRadius: 10, background: C.coralBg, border: `1px solid ${C.coralEdge}` }}>
          <AlertTriangle size={11} color={C.coral} />
          <span style={{ fontSize: 11.5, color: C.coral, fontWeight: 600 }}>{confirm === "cancel" ? "Cancel order?" : "Refund order?"}</span>
          <button onClick={() => {
            const fn = confirm === "cancel" ? actions.cancelOrder() : actions.refundOrder();
            wrap(fn, confirm === "cancel" ? "Order cancelled" : "Refund issued").then(() => reload());
            setConfirm(null);
          }} style={{ background: C.coral, color: "#fff", border: "none", borderRadius: 6, padding: "4px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            Confirm
          </button>
          <button onClick={() => setConfirm(null)} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 11 }}>Keep</button>
        </span>
      ) : (
        <>
          <MiniBtn tone="danger" onClick={() => setConfirm("refund")}
            icon={<RotateCw size={12} />} label="Refund"
            disabled={order.finance_status === "COD_PENDING"} />
          <MiniBtn onClick={() => setConfirm("cancel")}
            icon={<XCircle size={12} />} label="Cancel" />
        </>
      )}
    </div>
  );
}

function MiniBtn({ onClick, icon, label, tone = "ghost", busy, disabled }: any) {
  const styles: Record<string, React.CSSProperties> = {
    ghost:  { color: C.ink,   background: C.card,   border: `1px solid ${C.line2}` },
    mint:   { color: C.mint,  background: C.mintBg, border: `1px solid ${C.mintEdge}` },
    danger: { color: C.coral, background: C.coralBg, border: `1px solid ${C.coralEdge}` },
  };
  return (
    <button onClick={onClick} disabled={busy || disabled}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 8, fontSize: 11.5, fontWeight: 600,
        cursor: busy || disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, ...styles[tone] }}>
      {busy ? <Loader2 size={11} className="spin" /> : icon} {label}
    </button>
  );
}

function EventLog({ events }: { events: Event[] }) {
  return (
    <div style={{ marginTop: 8, padding: 14, background: C.raise, border: `1px solid ${C.line}`, borderRadius: 12 }}>
      <div style={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: C.faint, fontWeight: 700, marginBottom: 10 }}>
        Audit trail
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {events.map((e) => (
          <div key={e.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, paddingBottom: 8, borderBottom: `1px dashed ${C.line}` }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: C.card, border: `1px solid ${C.line2}`, display: "grid", placeItems: "center", flexShrink: 0 }}>
              <EventIcon kind={e.kind} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, color: C.ink, fontWeight: 600 }}>{humanizeKind(e.kind)}</span>
                {e.from_state && e.to_state && (
                  <span style={{ fontSize: 11, color: C.dim }}>{e.from_state} → {e.to_state}</span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, fontSize: 11, color: C.faint }}>
                <User size={10} /> <span>{e.actor}</span>
                <span>·</span>
                <span>{new Date(e.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              {e.payload && Object.keys(e.payload).length > 0 && (
                <div style={{ fontSize: 10.5, color: C.dim, marginTop: 3, fontFamily: "monospace" }}>
                  {Object.entries(e.payload).slice(0, 3).map(([k, v]) => (
                    <span key={k} style={{ marginRight: 8 }}>{k}: <b>{typeof v === "object" ? JSON.stringify(v).slice(0, 40) : String(v).slice(0, 40)}</b></span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EventIcon({ kind }: { kind: string }) {
  const map: Record<string, any> = {
    stage_change: CheckCircle2,
    "reservation.created": Warehouse,
    "invoice.generated": FileText,
    "awb.generated": Package,
    "order.cancelled": XCircle,
    "order.refunded": RotateCw,
    "zoho.pushed": ArrowUpRight,
    "finance.updated": BadgeCheck,
  };
  const Ico = map[kind] || Clock;
  return <Ico size={11} color={C.dim} />;
}

function humanizeKind(kind: string): string {
  const map: Record<string, string> = {
    stage_change: "Stage changed",
    "reservation.created": "Stock reserved",
    "reservation.released": "Reservation released",
    "invoice.generated": "Invoice generated",
    "awb.generated": "AWB generated",
    "order.cancelled": "Order cancelled",
    "order.refunded": "Refund issued",
    "zoho.pushed": "Pushed to Zoho",
    "finance.updated": "Finance status updated",
  };
  return map[kind] || kind;
}