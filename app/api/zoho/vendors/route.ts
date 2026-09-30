import { NextResponse } from "next/server";
import { zohoOrgScoped } from "@/lib/integrations/zoho-org";
import { listVendors, ZohoScopeError } from "@/lib/integrations/zoho-vendors";

export const dynamic = "force-dynamic";

// GET /api/zoho/vendors?q=…[&zohoOrg=…] → { vendors } — suppliers to pay a bank debit to.
// 403 { error, scope } when the org's token can't read contacts.
async function handleGET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  try {
    return NextResponse.json({ vendors: await listVendors(q) });
  } catch (e) {
    if (e instanceof ZohoScopeError) return NextResponse.json({ error: e.message, scope: e.scope }, { status: 403 });
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function GET(req: Request) {
  return zohoOrgScoped(req, () => handleGET(req));
}
