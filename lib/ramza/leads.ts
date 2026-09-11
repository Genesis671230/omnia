import { supabase } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/integrations/telegram";
import type { LeadInput } from "@/lib/ramza/validation";

export type LeadAttribution = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  fbc?: string;
  fbp?: string;
  referrer?: string;
  landing_path?: string;
};

const clip = (v: string | undefined, n: number) => (v ?? "").slice(0, n);

/** Returns the new row id, or null if a matching email was seen in the last 24h. */
export async function insertLead(
  input: LeadInput,
  attr: LeadAttribution,
  eventId: string,
  userAgent: string,
): Promise<{ id: string } | { deduped: true } | { error: string }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from("leads")
    .select("id")
    .eq("email", input.email)
    .gte("created_at", since)
    .limit(1);
  if (recent && recent.length > 0) return { deduped: true };

  const { data, error } = await supabase
    .from("leads")
    .insert({
      name: input.name,
      whatsapp: input.whatsapp,
      email: input.email,
      store_url: input.storeUrl,
      gateways: input.gateways,
      monthly_orders: input.monthlyOrders,
      accounting_tool: input.accountingTool,
      utm_source: clip(attr.utm_source, 200),
      utm_medium: clip(attr.utm_medium, 200),
      utm_campaign: clip(attr.utm_campaign, 200),
      utm_content: clip(attr.utm_content, 200),
      fbc: clip(attr.fbc, 400),
      fbp: clip(attr.fbp, 200),
      referrer: clip(attr.referrer, 500),
      landing_path: clip(attr.landing_path, 300),
      event_id: eventId,
      user_agent: userAgent.slice(0, 400),
      source: "ramza-landing",
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: data.id };
}

export async function notifyLead(input: LeadInput, attr: LeadAttribution): Promise<void> {
  const line = [
    "<b>New RAMZA payout-audit request</b>",
    `${escapeHtml(input.name)} — ${escapeHtml(input.storeUrl || "no store URL")}`,
    `${escapeHtml(input.email)} · ${escapeHtml(input.whatsapp)}`,
    `Gateways: ${input.gateways.map(escapeHtml).join(", ") || "none listed"}`,
    `~${escapeHtml(input.monthlyOrders)} orders/mo · books: ${escapeHtml(input.accountingTool)}`,
    attr.utm_campaign || attr.utm_source
      ? `Campaign: ${escapeHtml(attr.utm_source || "?")} / ${escapeHtml(attr.utm_campaign || "?")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  await sendTelegramMessage(line).catch(() => {});
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
