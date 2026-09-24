import { NextResponse } from "next/server";
import { ZohoQuotaExceededError } from "@/lib/integrations/zoho-throttle";
import { refreshZohoLedgerStatus } from "@/lib/reconciliation/zoho-ledger-refresh";

export const maxDuration = 120;

// Kept for existing callers; same work as POST /api/reconcile/bank-lines/zoho-status.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  if (!from || !to) return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  try {
    const r = await refreshZohoLedgerStatus({ from, to, accountId: searchParams.get("accountId") || undefined });
    return NextResponse.json({ ...r, verified: r.inZoho, missing: r.notFound, syncedAt: r.checkedAt });
  } catch (e) {
    const status = e instanceof ZohoQuotaExceededError ? 429 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
