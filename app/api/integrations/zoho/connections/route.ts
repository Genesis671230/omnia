import { NextResponse } from "next/server";
import { discoverZohoOrgs, listZohoConnections, saveZohoConnection } from "@/lib/integrations/zoho-org";

export const dynamic = "force-dynamic";

// GET  /api/integrations/zoho/connections
//        → { connections: ZohoConnection[] }   (never secrets)
// POST /api/integrations/zoho/connections
//        { action: "discover", clientId, clientSecret, refreshToken, accountsUrl? }
//          → { orgs: [{ orgId, name, currency, isDefault }] }
//        { action: "save", label, orgId, clientId, clientSecret, refreshToken, accountsUrl?, loginEmail? }
//          → { connection }  — verifies the credentials reach orgId first
//
// Onboarding flow: paste Zoho Self Client credentials → discover → pick the
// organisation from Zoho's own list → save (encrypted).

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function GET() {
  try {
    return NextResponse.json({ connections: await listZohoConnections() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const creds = { clientId: str(b.clientId), clientSecret: str(b.clientSecret), refreshToken: str(b.refreshToken), accountsUrl: str(b.accountsUrl) || undefined };
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    return NextResponse.json({ error: "Client ID, client secret and refresh token are all required" }, { status: 400 });
  }
  if (creds.accountsUrl && !/^https:\/\/accounts\.zoho\.[a-z.]+$/.test(creds.accountsUrl)) {
    return NextResponse.json({ error: "Accounts URL must look like https://accounts.zoho.com" }, { status: 400 });
  }
  try {
    if (b.action === "discover") return NextResponse.json(await discoverZohoOrgs(creds));
    if (b.action === "save") {
      const orgId = str(b.orgId);
      if (!/^\d{5,}$/.test(orgId)) return NextResponse.json({ error: "Pick the organisation to connect" }, { status: 400 });
      const connection = await saveZohoConnection({ ...creds, orgId, label: str(b.label), loginEmail: str(b.loginEmail), createdBy: str(b.by) || "settings" });
      return NextResponse.json({ connection });
    }
    return NextResponse.json({ error: 'action must be "discover" or "save"' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}
