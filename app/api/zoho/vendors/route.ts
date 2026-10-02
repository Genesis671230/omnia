import { NextResponse } from "next/server";
import { runInZohoOrgOr400, zohoOrgForBankLine, zohoOrgFromRequest } from "@/lib/integrations/zoho-org";
import { createVendor, listVendors, suggestVendors, ZohoScopeError, ZohoVendorRejection } from "@/lib/integrations/zoho-vendors";
import { zohoOrgForSupplierRequest } from "@/lib/integrations/zoho-org-request";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/zoho/vendors?q=…[&bankLine=…|&zohoOrg=…] → { vendors, suggested }
// With bankLine, the books are that line's statement account's (RAK → House
// of Omnia) and `suggested` lists the suppliers its narration names.
// 403 { error, scope } when the org's token can't read contacts.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const bankLine = (url.searchParams.get("bankLine") ?? "").trim();
  const org = bankLine ? await zohoOrgForBankLine(bankLine) : zohoOrgFromRequest(req);
  return runInZohoOrgOr400(org, async () => {
    try {
      let suggested: Awaited<ReturnType<typeof suggestVendors>> = [];
      if (bankLine) {
        const { data } = await supabase.from("bank_lines").select("description").eq("id", bankLine).maybeSingle();
        if (data?.description) suggested = await suggestVendors(String(data.description));
      }
      return NextResponse.json({ vendors: await listVendors(q), suggested });
    } catch (e) {
      if (e instanceof ZohoScopeError) return NextResponse.json({ error: e.message, scope: e.scope }, { status: 403 });
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  });
}

// POST /api/zoho/vendors[?bankLine=…|?zohoOrg=…] { name } → { vendor }
// A supplier that isn't in Zoho yet — created so the payment can be booked to it.
export async function POST(req: Request) {
  const { name } = (await req.json().catch(() => ({}))) as { name?: string };
  if (!name?.trim()) return NextResponse.json({ error: "Give the supplier a name." }, { status: 400 });
  return runInZohoOrgOr400(await zohoOrgForSupplierRequest(req), async () => {
    try {
      const existing = (await listVendors(name)).find((v) => v.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (existing) return NextResponse.json({ vendor: existing, existed: true });
      return NextResponse.json({ vendor: await createVendor(name) });
    } catch (e) {
      if (e instanceof ZohoScopeError) return NextResponse.json({ error: e.message, scope: e.scope }, { status: 403 });
      if (e instanceof ZohoVendorRejection) return NextResponse.json({ error: e.message }, { status: 422 });
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  });
}
