import { NextResponse } from "next/server";
import { runInZohoOrgOr400 } from "@/lib/integrations/zoho-org";
import { zohoOrgForSupplierRequest } from "@/lib/integrations/zoho-org-request";
import { listVendorAdvances, ZohoScopeError } from "@/lib/integrations/zoho-vendors";

export const dynamic = "force-dynamic";

// GET /api/zoho/vendors/:id/advances[?bankLine=…|?zohoOrg=…] → { advances }
// The supplier's payments with an unused amount — advances to apply to bills.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runInZohoOrgOr400(await zohoOrgForSupplierRequest(req), async () => {
    try {
      return NextResponse.json({ advances: await listVendorAdvances(id) });
    } catch (e) {
      if (e instanceof ZohoScopeError) return NextResponse.json({ error: e.message, scope: e.scope }, { status: 403 });
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  });
}
