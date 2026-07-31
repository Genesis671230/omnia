"use client";
import { useEffect, useState } from "react";
import { TrendingUp, Zap } from "lucide-react";

type StoreHealth = {
  channel: string; storeId: string;
  totalQty: number; skuCount: number;
  events24h: number; lastActivity: string | null; isPulsing: boolean;
};

const STORE_META: Record<string, { label: string; accent: string }> = {
  UAE: { label: "Omnia UAE", accent: "#4b9e7a" },
  KSA: { label: "Omnia KSA", accent: "#c98a1a" },
  WA:  { label: "Omnia WA",  accent: "#3a7bc2" },
  WOO: { label: "WooCommerce", accent: "#7a3b8f" },
};

function agoShort(iso: string | null): string {
  if (!iso) return "—";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

export function StorePulseRow() {
  const [rows, setRows] = useState<StoreHealth[]>([]);

  useEffect(() => {
    const load = () =>
      fetch("/api/inventory/store-health").then((r) => r.json()).then((d) => setRows(d.health ?? []));
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="pulse-row">
      {rows.map((r) => {
        const meta = STORE_META[r.storeId] ?? { label: r.storeId, accent: "#888" };
        return (
          <div key={r.channel} className="pulse-card">
            <div className="pulse-head">
              <span className="pulse-dot-wrap">
                <span
                  className={`pulse-dot ${r.isPulsing ? "on" : ""}`}
                  style={{ background: r.isPulsing ? meta.accent : "#c9c2b6" }}
                />
                {r.isPulsing && <span className="pulse-ring" style={{ borderColor: meta.accent }} />}
              </span>
              <span className="pulse-label">{meta.label}</span>
              <span className="pulse-ago">{agoShort(r.lastActivity)}</span>
            </div>
            <div className="pulse-big">{r.totalQty.toLocaleString()}</div>
            <div className="pulse-meta">
              <span>{r.skuCount.toLocaleString()} SKUs</span>
              <span className="pulse-events">
                <Zap size={10} /> {r.events24h} today
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}