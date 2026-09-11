import { createHash } from "node:crypto";

/* Meta Conversions API — server-side twin of the browser Pixel `Lead` event.
   Both fire with the SAME event_id so Meta dedupes them. No-ops when the env
   is not set, so the page works before the founder wires the pixel. */

const GRAPH_VERSION = "v19.0";

function sha256(v: string): string {
  return createHash("sha256").update(v.trim().toLowerCase()).digest("hex");
}

// phone: digits only, no plus, per Meta's normalisation
function normPhone(v: string): string {
  return v.replace(/[^\d]/g, "");
}

export type CapiLead = {
  eventId: string;
  email?: string;
  phone?: string;
  fbc?: string;
  fbp?: string;
  clientIp?: string;
  userAgent?: string;
  sourceUrl?: string;
};

export function metaConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_META_PIXEL_ID && process.env.META_CAPI_ACCESS_TOKEN,
  );
}

export async function sendCapiLead(lead: CapiLead): Promise<{ ok: boolean; error?: string }> {
  if (!metaConfigured()) return { ok: false, error: "meta not configured" };

  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID!;
  const token = process.env.META_CAPI_ACCESS_TOKEN!;

  const userData: Record<string, unknown> = {};
  if (lead.email) userData.em = [sha256(lead.email)];
  if (lead.phone) userData.ph = [sha256(normPhone(lead.phone))];
  if (lead.fbc) userData.fbc = lead.fbc;
  if (lead.fbp) userData.fbp = lead.fbp;
  if (lead.clientIp) userData.client_ip_address = lead.clientIp;
  if (lead.userAgent) userData.client_user_agent = lead.userAgent;

  const payload = {
    data: [
      {
        event_name: "Lead",
        event_time: Math.floor(Date.now() / 1000),
        event_id: lead.eventId,
        action_source: "website",
        event_source_url: lead.sourceUrl,
        user_data: userData,
      },
    ],
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json?.error?.message || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
