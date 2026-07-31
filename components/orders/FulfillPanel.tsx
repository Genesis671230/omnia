// components/orders/FulfillPanel.tsx
"use client";
import { useState, useEffect } from "react";
import { CheckCircle2, Loader2, Warehouse, FileText, Package, Truck, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { FulfillmentOption } from "@/lib/repositories/inventory-reservations.repository";

const FLOW = ["new", "confirmed", "reserved", "invoiced", "labeled", "dispatched"] as const;
type Stage = typeof FLOW[number];

export function FulfillPanel({ order, onStageChange, onInvoiceRequested, onLabelRequested }: {
  order: { uid: string; order_number: string; fulfillment_stage: string | null; gateway: string; financial_status: string };
  onStageChange: (s: Stage) => void;
  onInvoiceRequested: () => void;   // opens your existing InvoiceModal
  onLabelRequested: () => void;     // opens your existing ShipModal
}) {
  const [options, setOptions] = useState<FulfillmentOption[] | null>(null);
  const [selectedWh, setSelectedWh] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const rawStage = (order.fulfillment_stage || "new") as Stage;
  const stage = FLOW.includes(rawStage) ? rawStage : "new";
  const idx = FLOW.indexOf(stage);

  useEffect(() => {
    if (stage === "confirmed" && !options) {
      fetch(`/api/orders/${order.uid}/fulfillment-options`)
        .then(r => r.json()).then(d => setOptions(d.options))
        .catch(e => toast.error(`Load options: ${e.message}`));
    }
  }, [stage, order.uid]);

  async function post(action: string, body?: any): Promise<any> {
    setBusy(action);
    try {
      const res = await fetch(`/api/orders/${order.uid}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        toast.error(data.error || `${action} failed`);
        return data;
      }
      return data;
    } finally { setBusy(null); }
  }

  async function confirm() {
    const d = await post("confirm");
    if (d?.ok) { onStageChange("confirmed"); toast.success("Confirmed"); }
  }
  async function reserve() {
    if (!selectedWh) return;
    const d = await post("reserve", { warehouse_id: selectedWh });
    if (d?.ok) {
      onStageChange("reserved");
      toast.success(`Reserved from ${d.warehouse_name}`);
    } else if (d?.failures) {
      const msg = d.failures.map((f: any) =>
        `${f.sku}: need ${f.need}, have ${f.have ?? "?"}`).join("; ");
      toast.error(msg);
    }
  }
  async function markDispatched() {
    const d = await post("dispatch");
    if (d?.ok) { onStageChange("dispatched"); toast.success("Dispatched"); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, background: "#faf7ee", borderRadius: 10, border: "1px solid #e6dfc8" }}>
      <StepRow n={1} label="Confirm order" done={idx > 0} active={idx === 0}
        icon={<CheckCircle2 size={14} />} busy={busy === "confirm"}
        action={idx === 0 ? confirm : undefined} />

      <StepRow n={2} label="Reserve inventory" done={idx > 1} active={idx === 1}
        icon={<Warehouse size={14} />} busy={busy === "reserve"}
        action={idx === 1 && selectedWh ? reserve : undefined}
        actionLabel={selectedWh
          ? `Reserve from ${options?.find(o => o.warehouse_id === selectedWh)?.warehouse_name || "…"}`
          : "Pick a warehouse first"}>
        {idx === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {options === null && <span style={{ fontSize: 12, color: "#8a7a4c" }}>Checking stock…</span>}
            {options?.map(o => (
              <button key={o.warehouse_id}
                onClick={() => o.can_fulfill && setSelectedWh(o.warehouse_id)}
                disabled={!o.can_fulfill}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 12px", borderRadius: 8, fontSize: 12.5,
                  border: `1.5px solid ${selectedWh === o.warehouse_id ? "#a89159" : "#e6dfc8"}`,
                  background: selectedWh === o.warehouse_id ? "#f1ebd8" : "white",
                  cursor: o.can_fulfill ? "pointer" : "not-allowed",
                  opacity: o.can_fulfill ? 1 : 0.5, textAlign: "left",
                }}>
                <span>{o.warehouse_name}</span>
                {o.can_fulfill
                  ? <span style={{ color: "#3d8262", fontSize: 11, fontWeight: 600 }}>Available ✓</span>
                  : <span style={{ color: "#c0392b", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                      <XCircle size={11} /> {o.blockers.length} blocker{o.blockers.length !== 1 ? "s" : ""}
                    </span>}
              </button>
            ))}
          </div>
        )}
      </StepRow>

      <StepRow n={3} label="Generate invoice" done={idx > 2} active={idx === 2}
        icon={<FileText size={14} />}
        action={idx === 2 ? onInvoiceRequested : undefined}
        actionLabel="Open invoice modal" />

      <StepRow n={4} label="Generate AWB / label" done={idx > 3} active={idx === 3}
        icon={<Package size={14} />}
        action={idx === 3 ? onLabelRequested : undefined}
        actionLabel="Open shipping modal" />

      <StepRow n={5} label="Mark dispatched" done={idx > 4} active={idx === 4}
        icon={<Truck size={14} />} busy={busy === "dispatch"}
        action={idx === 4 ? markDispatched : undefined}
        actionLabel="Confirm handed to SMSA" />
    </div>
  );
}

function StepRow({ n, label, done, active, icon, action, actionLabel, busy, children }: any) {
  return (
    <div style={{
      padding: 10, borderRadius: 8,
      background: done ? "rgba(75,158,122,.08)" : active ? "white" : "transparent",
      border: `1px solid ${done ? "rgba(75,158,122,.3)" : active ? "#a89159" : "#e6dfc8"}`,
      opacity: !done && !active ? 0.5 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 11,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: done ? "#4b9e7a" : active ? "#a89159" : "#e6dfc8",
          color: "white", fontSize: 11, fontWeight: 700,
        }}>
          {done ? <CheckCircle2 size={13} /> : n}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13, color: "#3d3d3a" }}>
          {icon} {label}
        </span>
      </div>
      {children}
      {active && action && (
        <button onClick={action} disabled={busy}
          style={{
            marginTop: 10, padding: "7px 14px", borderRadius: 8, border: "none",
            background: "#5a4b1e", color: "#f1ebd8", fontSize: 12.5, fontWeight: 500,
            cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1,
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
          {busy && <Loader2 size={12} className="spin" />}
          {actionLabel || label}
        </button>
      )}
    </div>
  );
}