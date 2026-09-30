import { NextResponse } from "next/server";
import { validateCtLead } from "@/lib/ramza/validation";
import { insertCtLead, notifyCtLead, type LeadAttribution } from "@/lib/ramza/leads";
import { sendCapiLead } from "@/lib/ramza/meta";

/* Public intake for the RAMZA Corporate Tax penalty form (hero + /ramza/contact).
   Same defences as /api/lead: honeypot, 24h email dedupe, Meta CAPI Lead with
   the browser Pixel's event_id. Public via middleware PUBLIC_PATHS ("/api/lead/…"). */

export const dynamic = "force-dynamic";

const s = (v: unknown, max: number) => (typeof v === "string" ? v : "").trim().slice(0, max);

function pickAttribution(v: unknown): LeadAttribution {
  const a = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    utm_source: s(a.utm_source, 200), utm_medium: s(a.utm_medium, 200), utm_campaign: s(a.utm_campaign, 200),
    utm_content: s(a.utm_content, 200), fbc: s(a.fbc, 400), fbp: s(a.fbp, 200),
    referrer: s(a.referrer, 500), landing_path: s(a.landing_path, 300),
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const b = body as Record<string, unknown>;

  if (s(b.company_website, 200)) return NextResponse.json({ ok: true, event_id: s(b.eventId, 80) }); // honeypot

  const result = validateCtLead(b);
  if (!result.ok) return NextResponse.json({ errors: result.errors }, { status: 400 });

  const attr = pickAttribution(b.attribution);
  const eventId = s(b.eventId, 80) || crypto.randomUUID();
  const userAgent = s(request.headers.get("user-agent"), 400);
  const clientIp = s(request.headers.get("x-forwarded-for"), 100).split(",")[0].trim() || undefined;

  const inserted = await insertCtLead(result.value, attr, eventId, userAgent);
  if ("error" in inserted) {
    console.error("[ramza/lead/ct] insert failed:", inserted.error);
    return NextResponse.json({ error: "Could not save your request. Please message us on WhatsApp." }, { status: 500 });
  }
  if ("deduped" in inserted) return NextResponse.json({ ok: true, deduped: true, event_id: eventId });

  void notifyCtLead(result.value, attr);
  void sendCapiLead({
    eventId, email: result.value.email, phone: result.value.whatsapp, fbc: attr.fbc, fbp: attr.fbp,
    clientIp, userAgent, sourceUrl: s(request.headers.get("referer"), 500) || undefined,
  }).then((r) => { if (!r.ok) console.warn("[ramza/lead/ct] CAPI:", r.error); });

  return NextResponse.json({ ok: true, id: inserted.id, event_id: eventId });
}
