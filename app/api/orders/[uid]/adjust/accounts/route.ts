import { NextResponse } from "next/server";
import { depositAccountsFor } from "@/lib/orders/order-adjustment.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/orders/:uid/adjust/accounts?zohoOrg=…&gateway=…  — "Deposit To"
// accounts in the invoice's org, with the gateway's clearing account suggested.
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  try {
    return NextResponse.json(await depositAccountsFor(sp.get("zohoOrg") || "env", sp.get("gateway") || "", sp.get("currency") || "AED"));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
