// app/api/workers/webhook-health/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Max silence per feed before we alert. Set generously; tighten with data.
const MAX_SILENCE_MIN: Record<string, number> = {
  "shopify_uae:inventory_levels/update": 240,  // 4h — quiet stores can be legit
  "shopify_uae:orders/create":           360,  // 6h
  "shopify_ksa:inventory_levels/update": 240,
  "shopify_ksa:orders/create":           720,  // KSA lower volume
  "shopify_wa:inventory_levels/update":  360,
  "shopify_wa:orders/create":            360,
  "woo:product-updated":                 720,
  "woo:order-created":                   360,
  "zoho:item-updated":                   180,  // items get touched constantly
};

export async function GET() {
  const { data: hb } = await supabase.from("webhook_heartbeat").select("*");
  const now = Date.now();
  const dead: any[] = [];

  for (const [key, maxMin] of Object.entries(MAX_SILENCE_MIN)) {
    const [source, topic] = key.split(":");
    const row = hb?.find((h) => h.source === source && h.topic === topic);
    if (!row) {
      dead.push({ source, topic, reason: "never_seen" });
      continue;
    }
    const silentMin = (now - new Date(row.last_seen).getTime()) / 60000;
    if (silentMin > maxMin) dead.push({ source, topic, silentMin: Math.round(silentMin), last: row.last_seen });
  }

  if (dead.length > 0) {
    // Push to Telegram — you already have the returns bot channel.
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_ALERT_CHAT_ID,
        text: `⚠️ Webhook silence detected:\n${dead.map((d) => `• ${d.source}/${d.topic}: ${d.reason ?? d.silentMin + "min"}`).join("\n")}`,
      }),
    });
  }

  return NextResponse.json({ checked: Object.keys(MAX_SILENCE_MIN).length, dead: dead.length, details: dead });
}