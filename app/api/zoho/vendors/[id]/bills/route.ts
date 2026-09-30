import { NextResponse } from "next/server";
import { zohoOrgScoped } from "@/lib/integrations/zoho-org";
import { listOpenBills, ZohoScopeError } from "@/lib/integrations/zoho-vendors";

export const dynamic = "force-dynamic";

// GET /api/zoho/vendors/:id/bills[?zohoOrg=…] → { bills } — the supplier's
// bills still owing, oldest first.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return zohoOrgScoped(req, async () => {
    try {
      return NextResponse.json({ bills: await listOpenBills(id) });
    } catch (e) {
      if (e instanceof ZohoScopeError) return NextResponse.json({ error: e.message, scope: e.scope }, { status: 403 });
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  });
}
