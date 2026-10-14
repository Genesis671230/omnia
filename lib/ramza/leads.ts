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

/* Corporate Tax penalty lead — same table, dedupe and Telegram ping as the
   payout-audit form, tagged source = 'ramza-ct-penalty'. */
export async function insertCtLead(
  input: import("@/lib/ramza/validation").CtLeadInput,
  attr: LeadAttribution,
  eventId: string,
  userAgent: string,
): Promise<{ id: string } | { deduped: true } | { error: string }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from("leads").select("id").eq("email", input.email).eq("source", "ramza-ct-penalty").gte("created_at", since).limit(1);
  if (recent && recent.length > 0) return { deduped: true };

  const { data, error } = await supabase
    .from("leads")
    .insert({
      name: input.name,
      whatsapp: input.whatsapp,
      email: input.email,
      company: input.company,
      situation: input.situation,
      penalty_type: input.penaltyType,
      penalty_issued_on: input.penaltyIssuedOn,
      checker: input.checker,
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
      source: "ramza-ct-penalty",
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: data.id };
}

const SITUATION_LABEL: Record<string, string> = {
  file_return: "Needs the Corporate Tax return filed",
  einvoicing: "Wants e-invoicing set up (ASP + clean invoice data)",
  reconciliation: "Wants gateway payouts reconciled (Tabby/Tamara/Stripe/Telr → bank → books)",
  vat: "VAT registration / returns",
  books_behind: "Bookkeeping behind",
  got_penalty: "Received a penalty",
  missed_deadline: "Worried a deadline was missed",
  register_or_file: "Needs to register / file",
  other: "Other",
  pkg_complete: "Package: Complete Clean Close (books + accounting + e-invoicing + CT)",
  pkg_einvoicing: "Package: E-invoicing Ready (backlog close + ASP)",
  pkg_books: "Package: Bookkeeping & Accounting (monthly)",
  pkg_ct: "Package: Corporate Tax (registration + return)",
};

export async function notifyCtLead(input: import("@/lib/ramza/validation").CtLeadInput, attr: LeadAttribution): Promise<void> {
  const line = [
    `<b>New RAMZA lead — ${input.situation.startsWith("pkg_") ? "package" : input.situation === "einvoicing" ? "e-invoicing" : input.situation === "reconciliation" ? "reconciliation" : input.situation === "vat" ? "VAT" : "Corporate Tax"}</b>`,
    `${escapeHtml(input.name)} — ${escapeHtml(input.company)}`,
    `${escapeHtml(input.email)} · ${escapeHtml(input.whatsapp)}`,
    `${escapeHtml(SITUATION_LABEL[input.situation] ?? input.situation)}${input.penaltyType ? ` · ${escapeHtml(input.penaltyType)}` : ""}${input.penaltyIssuedOn ? ` · notice ${input.penaltyIssuedOn}` : ""}`,
    input.checker ? `Checker: ${escapeHtml(String(input.checker.headline ?? ""))}` : "",
    attr.utm_campaign || attr.utm_source ? `Campaign: ${escapeHtml(attr.utm_source || "?")} / ${escapeHtml(attr.utm_campaign || "?")}` : "",
    attr.landing_path ? `Page: ${escapeHtml(attr.landing_path)}` : "",
    waMe(input.whatsapp) ? `<a href="${waMe(input.whatsapp)}">Reply on WhatsApp</a> · inbox: /leads` : "",
  ].filter(Boolean).join("\n");
  await sendTelegramMessage(line).catch(() => {});
}

/** wa.me link for a UAE-style number (05x → 9715x); "" if it has no digits. */
function waMe(n: string): string {
  const d = n.replace(/[^\d]/g, "").replace(/^00/, "").replace(/^0(?=5)/, "971");
  return d ? `https://wa.me/${d}` : "";
}
