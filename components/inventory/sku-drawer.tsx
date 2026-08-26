"use client";
import { useEffect, useState } from "react";
import { X, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

type SkuDetail = {
  sku: string; name: string;
  zoho: { available_stock: number; stock_on_hand: number };
  stores: { channel: string; quantity: number | null; product_status: string }[];
  recentEvents: any[];
};

export function SkuDrawer({ sku, onClose }: { sku: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<SkuDetail | null>(null);
  const [pushing, setPushing] = useState(false);

  useEffect(() => {
    if (!sku) return;
    setDetail(null);
    const load = () =>
      fetch(`/api/inventory/sku/${encodeURIComponent(sku)}`).then((r) => r.json()).then(setDetail);
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [sku]);

  const push = async () => {
    if (!sku) return;
    setPushing(true);
    try {
      const res = await fetch(`/api/inventory/sku/${encodeURIComponent(sku)}/push`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      toast.success(`${sku} pushed to all stores`);
    } catch (e) {
      toast.error(`Push failed: ${(e as Error).message}`);
    } finally { setPushing(false); }
  };

  if (!sku) return null;

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <div className="drawer-sku mono">{sku}</div>
            <div className="drawer-name">{detail?.name ?? "…"}</div>
          </div>
          <button className="drawer-close" onClick={onClose}><X size={16} /></button>
        </div>

        {!detail ? (
          <div className="drawer-loading"><Loader2 size={16} className="spin" /> Loading…</div>
        ) : (
          <>
            <div className="drawer-grid">
              <div className="drawer-cell zoho">
                <span className="drawer-lbl">Zoho available</span>
                <b>{detail.zoho.available_stock}</b>
                <em>on hand {detail.zoho.stock_on_hand}</em>
              </div>
              {detail.stores.map((s) => {
                const diff = (s.quantity ?? 0) - detail.zoho.available_stock;
                return (
                  <div key={s.channel} className={`drawer-cell ${diff !== 0 ? "off" : ""}`}>
                    <span className="drawer-lbl">{s.channel.replace("shopify_", "").toUpperCase()}</span>
                    <b>{s.quantity ?? "—"}</b>
                    {/* <em>{diff === 0 ? "in sync" : `${diff > 0 ? "+" : ""}${diff} vs Zoho`}</em> */}
                  </div>
                );
              })}
            </div>

            <button className="drawer-push" onClick={push} disabled={pushing}>
              {pushing ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
              Push Zoho qty to all stores
            </button>

            <div className="drawer-section-title">Recent activity</div>
            <ul className="drawer-events">
              {detail.recentEvents.map((e: any) => (
                <li key={e.id}>
                  <span className="drawer-evt-time">
                    {new Date(e.occurred_at).toLocaleTimeString([], { hour12: false })}
                  </span>
                  <span className="drawer-evt-src">{e.source.replace("shopify_", "").toUpperCase()}</span>
                  <span className="drawer-evt-what">
                    {e.event_type === "order_decrement" && `Order #${e.correlation ?? "?"} · ${Math.abs(e.delta ?? 0)} sold`}
                    {e.event_type === "reconcile_push" && `Auto-corrected to ${e.new_qty}`}
                    {e.event_type === "snapshot" && (e.delta != null ? `Changed ${e.delta > 0 ? "+" : ""}${e.delta} → ${e.new_qty}` : `Snapshot at ${e.new_qty}`)}
                    {e.event_type === "manual_adjust" && `Manual adjust ${e.delta ?? 0}`}
                  </span>
                </li>
              ))}
              {detail.recentEvents.length === 0 && (
                <li className="drawer-evt-empty">No activity yet.</li>
              )}
            </ul>
          </>
        )}
      </aside>
    </>
  );
}