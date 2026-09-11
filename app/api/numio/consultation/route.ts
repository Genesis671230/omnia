import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/integrations/telegram";

/* Public "book a consultation" intake for the numio landing page (/numio).
   Unauthenticated by design — see middleware PUBLIC_PATHS. Defences: a honeypot
   field, hard length caps, and a 1-per-email-per-day dedupe. Rows land in
   pilot_leads with source 'numio-landing'. On success we ping the ops Telegram
   group so the pod sees the lead immediately. */

export const dynamic = "force-dynamic";

const str = (v: unknown, max: number) =>
  (typeof v === "string" ? v : "").trim().slice(0, max);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  // Honeypot — real users never fill this hidden field.
  if (str(b.website, 200)) return NextResponse.json({ ok: true });

  const name = str(b.name, 120);
  const email = str(b.email, 200).toLowerCase();
  const company = str(b.company, 160);
  const role = str(b.role, 120);
  const accounting = str(b.accounting, 40);
  const monthlyOrders = str(b.monthlyOrders, 40);
  const message = str(b.message, 2000);
  const utmRaw = b.utm;
  const utm =
    utmRaw && typeof utmRaw === "object" && !Array.isArray(utmRaw)
      ? Object.fromEntries(
          Object.entries(utmRaw as Record<string, unknown>)
            .slice(0, 12)
            .map(([k, v]) => [k.slice(0, 40), str(v, 200)]),
        )
      : {};

  if (!name || !company || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Name, company, and a valid email are required." },
      { status: 400 },
    );
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from("pilot_leads")
    .select("id")
    .eq("email", email)
    .gte("created_at", since)
    .limit(1);
  if (recent && recent.length > 0) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  const userAgent = str(request.headers.get("user-agent"), 400);

  const { data, error } = await supabase
    .from("pilot_leads")
    .insert({
      name,
      email,
      company,
      role,
      ecom_platform: "",
      accounting,
      monthly_orders: monthlyOrders,
      message,
      utm,
      user_agent: userAgent,
      source: "numio-landing",
    })
    .select("id, created_at")
    .single();

  if (error) {
    console.error("[numio/consultation] insert failed:", error.message);
    return NextResponse.json(
      { error: "Could not save your request. Please email us directly." },
      { status: 500 },
    );
  }

  void sendTelegramMessage(
    [
      "<b>New numio consultation request</b>",
      `${escapeHtml(name)}${role ? ` (${escapeHtml(role)})` : ""} — ${escapeHtml(company)}`,
      `${escapeHtml(email)}`,
      `Books: ${escapeHtml(accounting || "?")} · ~${escapeHtml(monthlyOrders || "?")} txns/mo`,
      message ? `\n${escapeHtml(message)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  ).catch(() => {});

  return NextResponse.json({ ok: true, id: data.id });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
