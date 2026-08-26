

// components/inventory/drift-panel.tsx  — REPLACES the broken one
"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

type Summary = {
items: Array<{
  sku: string; name: string;
  zohoStock: number;
  stores: Array<{ storeId: string; quantity: number | null; listed: boolean; tracking: boolean;   }>;
  status: string;
  maxDiff: number;
  presentOn: string[];
}>;
};

export function DriftPanel({ onSelectSku }: { onSelectSku?: (sku: string) => void }) {
const [rows, setRows] = useState<Summary["items"]>([]);
const [pushing, setPushing] = useState<string | null>(null);
const [loaded, setLoaded] = useState(false);

const load = async () => {
  try {
    const r = await fetch("/api/inventory/summary", { cache: "no-store" });
    const data: Summary = await r.json();

    // ONLY genuine mismatches: SKU is listed on the channel AND its qty
    // differs from Zoho. "Not listed" is a coverage gap, handled by the
    // existing coverage panel — do not conflate the two.
    const drifted = data.items
      .filter((it) => it.status === "stock_mismatch")
      .filter((it) => it.stores.some((s) => s.listed 
      // && s.tracking
       && s.quantity !== null && s.quantity !== it.zohoStock))
      .sort((a, b) => b.maxDiff - a.maxDiff)
      .slice(0, 40);

    setRows(drifted);
  } finally { setLoaded(true); }
};
useEffect(() => { load(); const id = setInterval(load, 20_000); return () => clearInterval(id); }, []);

const push = async (sku: string) => {
  setPushing(sku);
  try {
    const res = await fetch(`/api/inventory/sku/${encodeURIComponent(sku)}/push`, { method: "POST" });
    if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
    toast.success(`${sku} pushed to matching stores`);
    await load();
  } catch (e) {
    toast.error(`Push failed: ${(e as Error).message}`);
  } finally { setPushing(null); }
};

if (!loaded) return null;

return (
  <div className="drift">
    <div className="drift-head">
      <span className="drift-title">
        <AlertTriangle size={13} /> Stock drift
        <b className="drift-count">{rows.length}</b>
      </span>
      <span className="drift-sub">
        {rows.length === 0
          ? "Every SKU that's listed on a store matches Zoho."
          : "Stores that carry this SKU show a different qty than Zoho."}
      </span>
    </div>

    {rows.length === 0 ? (
      <div className="drift-empty"><Check size={14} /> Nothing to reconcile.</div>
    ) : (
      <ul className="drift-list">
        {rows.map((r) => (
          <li key={r.sku} className="drift-row" onClick={() => onSelectSku?.(r.sku)}>
            <div className="drift-sku-cell">
              <span className="mono">{r.sku}</span>
              <span className="drift-name">{r.name}</span>
            </div>
            <div className="drift-cells">
              <span className="drift-pill zoho">Zoho <b>{r.zohoStock}</b></span>
              {/* ONLY render channels that actually carry this SKU.
                  Absent channels are a coverage story, not a drift story. */}
              {r.stores.filter((s) => s.listed).map((s) => {
                const diff = (s.quantity ?? 0) - r.zohoStock;
                return (
                  <span key={s.storeId} className={`drift-pill ${diff !== 0 ? "off" : ""}`}>
                    {s.storeId.replace("shopify_", "").toUpperCase()} <b>{s.quantity ?? "—"}</b>
                    {diff !== 0 && <em>{diff > 0 ? "+" : ""}{diff}</em>}
                  </span>
                );
              })}
            </div>
            <button
              className="drift-btn"
              disabled={pushing === r.sku}
              onClick={(e) => { e.stopPropagation(); push(r.sku); }}
            >
              {pushing === r.sku ? <Loader2 size={11} className="spin" /> : "Push"}
            </button>
          </li>
        ))}
      </ul>
    )}
  </div>
);
}