import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { validateReport, reportEmailHtml } from "@/lib/ramza/demo-report";
import { linkLead } from "@/lib/ramza/funnel.server";
import { sendEmail, emailConfigured } from "@/lib/integrations/email";
import { sendTelegramMessage } from "@/lib/integrations/telegram";
import { sendCapiLead } from "@/lib/ramza/meta";
import { whatsappHref } from "@/lib/ramza/ct-site";
import { RAMZA_ORIGIN } from "@/lib/ramza/site";
import { INDUSTRY_LABEL } from "@/lib/ramza/demo/coa";

/* Public: "Email me the full report" from the instant demo. Saves the lead
   (source ramza-demo), ties its funnel events to it, emails the report, pings
   Telegram and sends the Meta CAPI Lead (same event_id as the browser pixel). */

export const dynamic = "force-dynamic";
const s = (v: unknown, max: number) => (typeof v === "string" ? v : "").trim().slice(0, max);

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (s(b.company_website, 200)) return NextResponse.json({ ok: true }); // honeypot
  const v = validateReport(b);
  if (!v.ok) return NextResponse.json({ errors: v.errors }, { status: 400 });
  const r = v.value;
  const a = (b.attribution && typeof b.attribution === "object" ? b.attribution : {}) as Record<string, unknown>;
  const anonId = /^[a-zA-Z0-9-]{8,64}$/.test(s(b.anonId, 64)) ? s(b.anonId, 64) : "";
  const eventId = s(b.eventId, 80) || crypto.randomUUID();
  const userAgent = s(request.headers.get("user-agent"), 400);

  const { data, error } = await supabase.from("leads").insert({
    name: r.name, whatsapp: r.whatsapp, email: r.email, company: r.company, situation: "reconciliation",
    industry: r.industry, demo: r.summary, anon_id: anonId,
    utm_source: s(a.utm_source, 200), utm_medium: s(a.utm_medium, 200), utm_campaign: s(a.utm_campaign, 200), utm_content: s(a.utm_content, 200),
    fbc: s(a.fbc, 400), fbp: s(a.fbp, 200), referrer: s(a.referrer, 500), landing_path: s(a.landing_path, 300),
    event_id: eventId, user_agent: userAgent, source: "ramza-demo",
  }).select("id").single();
  if (error) {
    console.error("[ramza/report] insert failed:", error.message);
    return NextResponse.json({ error: "Could not save your request. Please message us on WhatsApp." }, { status: 500 });
  }
  await linkLead(anonId, data.id).catch(() => {});

  let emailed = false;
  if (emailConfigured()) {
    const sent = await sendEmail({
      to: r.email, subject: `Your RAMZA reconciliation report — ${r.summary.cleared} of ${r.summary.invoices} invoices cleared`,
      html: reportEmailHtml(r, { whatsapp: whatsappHref(`Hi RAMZA, I ran the ${INDUSTRY_LABEL[r.industry]} demo and want this set up.`), site: RAMZA_ORIGIN }),
      fromName: "RAMZA", replyTo: process.env.NEXT_PUBLIC_RAMZA_EMAIL || undefined,
    });
    emailed = sent.ok;
    if (sent.ok) await supabase.from("leads").update({ report_sent_at: new Date().toISOString() }).eq("id", data.id);
    else console.warn("[ramza/report] email:", sent.error);
  }

  const x = r.summary;
  void sendTelegramMessage([
    `<b>New RAMZA demo lead — ${INDUSTRY_LABEL[r.industry]}</b>`,
    `${esc(r.name)}${r.company ? ` — ${esc(r.company)}` : ""}`,
    `${esc(r.email)}${r.whatsapp ? ` · ${esc(r.whatsapp)}` : ""}`,
    `${x.source === "upload" ? "Ran their OWN file" : "Ran the demo"}: ${x.cleared}/${x.invoices} cleared · gross AED ${Math.round(x.grossAed).toLocaleString("en-US")} · fees AED ${Math.round(x.feeAed).toLocaleString("en-US")}`,
    a.utm_source || a.utm_campaign ? `Campaign: ${esc(s(a.utm_source, 60) || "?")} / ${esc(s(a.utm_campaign, 80) || "?")}` : "",
    emailed ? "Report emailed ✓" : "Report NOT emailed (email not configured)",
  ].filter(Boolean).join("\n")).catch(() => {});

  void sendCapiLead({
    eventId, email: r.email, phone: r.whatsapp || undefined, fbc: s(a.fbc, 400) || undefined, fbp: s(a.fbp, 200) || undefined,
    clientIp: s(request.headers.get("x-forwarded-for"), 100).split(",")[0].trim() || undefined, userAgent, sourceUrl: s(request.headers.get("referer"), 500) || undefined,
  }).then((c) => { if (!c.ok && c.error !== "meta not configured") console.warn("[ramza/report] CAPI:", c.error); });

  return NextResponse.json({ ok: true, id: data.id, emailed, event_id: eventId });
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
