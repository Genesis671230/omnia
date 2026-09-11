import { NextResponse } from "next/server";
import { validateLead } from "@/lib/ramza/validation";
import { insertLead, notifyLead, type LeadAttribution } from "@/lib/ramza/leads";
import { sendCapiLead } from "@/lib/ramza/meta";

/* Public intake for the RAMZA free-payout-audit form (/ramza). Unauthenticated
   by design — see middleware PUBLIC_PATHS. Defences: honeypot + 24h email
   dedupe. Fires the Meta Conversions API `Lead` event with the same event_id
   the browser Pixel uses so the two dedupe. */

export const dynamic = "force-dynamic";

const s = (v: unknown, max: number) =>
  (typeof v === "string" ? v : "").trim().slice(0, max);

function pickAttribution(v: unknown): LeadAttribution {
  const a = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    utm_source: s(a.utm_source, 200),
    utm_medium: s(a.utm_medium, 200),
    utm_campaign: s(a.utm_campaign, 200),
    utm_content: s(a.utm_content, 200),
    fbc: s(a.fbc, 400),
    fbp: s(a.fbp, 200),
    referrer: s(a.referrer, 500),
    landing_path: s(a.landing_path, 300),
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  // Honeypot — real users never fill this.
  if (s(b.company_website, 200)) {
    return NextResponse.json({ ok: true, event_id: s(b.eventId, 80) });
  }

  const result = validateLead(b);
  if (!result.ok) {
    return NextResponse.json({ errors: result.errors }, { status: 400 });
  }

  const attr = pickAttribution(b.attribution);
  const eventId = s(b.eventId, 80) || crypto.randomUUID();
  const userAgent = s(request.headers.get("user-agent"), 400);
  const clientIp =
    s(request.headers.get("x-forwarded-for"), 100).split(",")[0].trim() || undefined;

  const inserted = await insertLead(result.value, attr, eventId, userAgent);
  if ("error" in inserted) {
    console.error("[ramza/lead] insert failed:", inserted.error);
    return NextResponse.json(
      { error: "Could not save your request. Please message us on WhatsApp." },
      { status: 500 },
    );
  }

  if ("deduped" in inserted) {
    return NextResponse.json({ ok: true, deduped: true, event_id: eventId });
  }

  // Fire-and-forget: neither should block or fail the response.
  void notifyLead(result.value, attr);
  void sendCapiLead({
    eventId,
    email: result.value.email,
    phone: result.value.whatsapp,
    fbc: attr.fbc,
    fbp: attr.fbp,
    clientIp,
    userAgent,
    sourceUrl: s(request.headers.get("referer"), 500) || undefined,
  }).then((r) => {
    if (!r.ok) console.warn("[ramza/lead] CAPI:", r.error);
  });

  return NextResponse.json({ ok: true, id: inserted.id, event_id: eventId });
}
