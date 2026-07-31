"use client";
import { useEffect, useRef, useState } from "react";

type Event = {
  id: number; sku: string; source: string; event_type: string;
  delta: number | null; new_qty: number | null; occurred_at: string; raw: any;
};

type Props = { onSelectSku?: (sku: string) => void };

const SOURCE_LABEL: Record<string, string> = {
  shopify_uae: "UAE", shopify_ksa: "KSA", shopify_wa: "WA",
  woo: "WOO", zoho: "Zoho", reconciler: "sync", master: "master",
};

const SOURCE_COLOR: Record<string, string> = {
  shopify_uae: "#4b9e7a", shopify_ksa: "#c98a1a", shopify_wa: "#3a7bc2",
  woo: "#7a3b8f", zoho: "#8a6240", reconciler: "#666", master: "#666",
};

function eventText(e: Event): string {
  if (e.event_type === "order_decrement") return `sold ${Math.abs(e.delta ?? 0)}`;
  if (e.event_type === "refund")           return `refunded +${e.delta ?? 0}`;
  if (e.event_type === "restock")          return `restocked +${e.delta ?? 0}`;
  if (e.event_type === "manual_adjust")    return `adjusted ${(e.delta ?? 0) > 0 ? "+" : ""}${e.delta ?? 0}`;
  if (e.event_type === "reconcile_push")   return `pushed to ${e.new_qty ?? "?"}`;
  if (e.event_type === "reconcile_correction") return `corrected to ${e.new_qty ?? "?"}`;
  if (e.event_type === "snapshot") {
    if (e.delta != null) return `${e.delta > 0 ? "+" : ""}${e.delta} → ${e.new_qty ?? "?"}`;
    return `at ${e.new_qty ?? "?"}`;
  }
  return e.event_type;
}

export function LiveEventsTicker({ onSelectSku }: Props) {
  const [events, setEvents] = useState<Event[]>([]);
  const [connected, setConnected] = useState(false);
  const [flashIds, setFlashIds] = useState<Set<number>>(new Set());
  const sinceRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/inventory/events/stream?since=${sinceRef.current}`, { cache: "no-store" });
        const data = await res.json();
        setConnected(true);
        if (data.events?.length) {
          sinceRef.current = Math.max(sinceRef.current, data.highWatermark);
          const newIds = new Set<number>(data.events.map((e: Event) => e.id));
          setEvents((prev) => {
            const seen = new Set(prev.map((e) => e.id));
            const fresh = data.events.filter((e: Event) => !seen.has(e.id));
            return [...fresh, ...prev].slice(0, 60);
          });
          // Only flash NEW arrivals — not initial load.
          if (sinceRef.current > 0 && data.events.length < 20) {
            setFlashIds((prev) => new Set([...prev, ...newIds]));
            setTimeout(() => {
              setFlashIds((prev) => {
                const next = new Set(prev);
                newIds.forEach((id) => next.delete(id));
                return next;
              });
            }, 900);
          }
        }
      } catch {
        setConnected(false);
      }
      const nextDelay = document.visibilityState === "hidden" ? 10_000 : 2000;
      timer = setTimeout(tick, nextDelay);
    }
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  return (
    <div className="ticker">
      <div className="ticker-head">
        <span className="ticker-title">Live stock events</span>
        <span className={`ticker-live ${connected ? "on" : ""}`}>
          <span className="ticker-live-dot" />
          {connected ? "live" : "reconnecting"}
        </span>
      </div>
      <ul className="ticker-list">
        {events.length === 0 && (
          <li className="ticker-empty">
            <span>Watching all four stores.</span>
            <span className="ticker-empty-sub">Events appear as syncs run. Press <b>Sync now</b> above to trigger one.</span>
          </li>
        )}
        {events.map((e) => (
          <li
            key={e.id}
            className={`ticker-row ${flashIds.has(e.id) ? "flash" : ""}`}
            onClick={() => onSelectSku?.(e.sku)}
          >
            <span className="ticker-time">
              {new Date(e.occurred_at).toLocaleTimeString([], { hour12: false })}
            </span>
            <span
              className="ticker-source"
              style={{ background: `${SOURCE_COLOR[e.source]}22`, color: SOURCE_COLOR[e.source] }}
            >
              {SOURCE_LABEL[e.source] ?? e.source}
            </span>
            <span className="ticker-sku">{e.sku}</span>
            <span className="ticker-what">{eventText(e)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}