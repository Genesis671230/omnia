import { NextResponse } from "next/server";
import { runInZohoOrgOr400, zohoOrgForBankLine, zohoOrgFromRequest } from "@/lib/integrations/zoho-org";
import { listOpenBills, ZohoScopeError } from "@/lib/integrations/zoho-vendors";

export const dynamic = "force-dynamic";

// GET /api/zoho/vendors/:id/bills[?bankLine=…|?zohoOrg=…] → { bills } — the supplier's
// bills still owing, oldest first.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bankLine = (new URL(req.url).searchParams.get("bankLine") ?? "").trim();
  const org = bankLine ? await zohoOrgForBankLine(bankLine) : zohoOrgFromRequest(req);
  return runInZohoOrgOr400(org, async () => {
    try {
      return NextResponse.json({ bills: await listOpenBills(id) });
    } catch (e) {
      if (e instanceof ZohoScopeError) return NextResponse.json({ error: e.message, scope: e.scope }, { status: 403 });
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  });
}
