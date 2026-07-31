// components/inventory/webhook-health-strip.tsx
import { supabase } from "@/lib/supabase";

async function getHealth() {
  const { data } = await supabase.from("webhook_heartbeat").select("*");
  return data ?? [];
}

const FEEDS = [
  { source: "shopify_uae", topic: "inventory_levels/update", label: "UAE inv", maxMin: 240 },
  { source: "shopify_uae", topic: "orders/create",           label: "UAE orders", maxMin: 360 },
  { source: "shopify_ksa", topic: "inventory_levels/update", label: "KSA inv", maxMin: 240 },
  { source: "shopify_ksa", topic: "orders/create",           label: "KSA orders", maxMin: 720 },
  { source: "shopify_wa",  topic: "inventory_levels/update", label: "WA inv",  maxMin: 360 },
  { source: "shopify_wa",  topic: "orders/create",           label: "WA orders", maxMin: 360 },
  { source: "woo",         topic: "product-updated",         label: "WOO prod", maxMin: 720 },
  { source: "woo",         topic: "order-created",           label: "WOO orders", maxMin: 360 },
  { source: "zoho",        topic: "item-updated",            label: "Zoho items", maxMin: 180 },
];

export async function WebhookHealthStrip() {
  const hb = await getHealth();
  return (
    <div className="grid grid-cols-9 gap-2 rounded-lg border border-neutral-800 p-3">
      {FEEDS.map((f) => {
        const row = hb.find((h) => h.source === f.source && h.topic === f.topic);
        const silentMin = row ? (Date.now() - new Date(row.last_seen).getTime()) / 60000 : Infinity;
        const state = !row ? "dead" : silentMin > f.maxMin ? "dead" : silentMin > f.maxMin / 2 ? "warn" : "ok";
        return (
          <div key={f.label} className="flex flex-col items-start gap-1">
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${
                state === "ok" ? "bg-emerald-500"
                  : state === "warn" ? "bg-amber-500" : "bg-red-500 animate-pulse"
              }`} />
              <span className="text-xs">{f.label}</span>
            </div>
            <span className="font-mono text-[10px] text-neutral-500">
              {row ? `${Math.round(silentMin)}m ago` : "never"}
            </span>
          </div>
        );
      })}
    </div>
  );
}