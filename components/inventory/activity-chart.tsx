"use client";
import { useEffect, useState } from "react";

type Bucket = {
  time: string;
  shopify_uae: number; shopify_ksa: number; shopify_wa: number;
  woo: number; zoho: number;
};

const COLORS = {
  shopify_uae: "#4b9e7a",
  shopify_ksa: "#c98a1a",
  shopify_wa:  "#3a7bc2",
  woo:         "#7a3b8f",
  zoho:        "#8a6240",
};
const LABELS = {
  shopify_uae: "UAE", shopify_ksa: "KSA", shopify_wa: "WA",
  woo: "WOO", zoho: "Zoho",
};

export function ActivityChart() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);

  useEffect(() => {
    const load = () =>
      fetch("/api/inventory/activity").then((r) => r.json()).then((d) => setBuckets(d.buckets ?? []));
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  const max = Math.max(1, ...buckets.map((b) => b.shopify_uae + b.shopify_ksa + b.shopify_wa + b.woo + b.zoho));
  const total = buckets.reduce((s, b) => s + b.shopify_uae + b.shopify_ksa + b.shopify_wa + b.woo + b.zoho, 0);

  return (
    <div className="activity">
      <div className="activity-head">
        <span className="activity-title">Activity · last 4 hours</span>
        <span className="activity-total">{total} events</span>
      </div>
      <div className="activity-bars">
        {buckets.map((b) => {
          const sum = b.shopify_uae + b.shopify_ksa + b.shopify_wa + b.woo + b.zoho;
          const h = (sum / max) * 100;
          return (
            <div key={b.time} className="activity-col" title={`${new Date(b.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${sum}`}>
              <div className="activity-stack" style={{ height: `${h}%` }}>
                {(["shopify_uae", "shopify_ksa", "shopify_wa", "woo", "zoho"] as const).map((k) => {
                  const seg = sum > 0 ? (b[k] / sum) * 100 : 0;
                  return seg > 0 ? (
                    <div key={k} style={{ height: `${seg}%`, background: COLORS[k] }} />
                  ) : null;
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="activity-legend">
        {(Object.keys(LABELS) as Array<keyof typeof LABELS>).map((k) => (
          <span key={k} className="al">
            <i style={{ background: COLORS[k] }} />
            {LABELS[k]}
          </span>
        ))}
      </div>
    </div>
  );
}