import { NextResponse } from "next/server";
import { ZohoQuotaExceededError } from "@/lib/integrations/zoho-throttle";
import { refreshZohoLedgerStatus } from "@/lib/reconciliation/zoho-ledger-refresh";

export const maxDuration = 120;

// POST /api/reconcile/bank-lines/zoho-status  { from, to, accountId?, force? }
//
// The Bank Transactions tab's Refresh button — the ONLY place that tab spends
// Zoho API quota. Reads the ledger for the range, matches every bank line and
// stores the result; GET /api/reconcile/bank-lines then serves it from the DB.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const from = typeof body.from === "string" ? body.from : "";
  const to = typeof body.to === "string" ? body.to : "";
  if (!from || !to) return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  try {
    const result = await refreshZohoLedgerStatus({
      from, to, accountId: body.accountId || undefined, force: Boolean(body.force),
    });
    return NextResponse.json(result);
  } catch (e) {
    const status = e instanceof ZohoQuotaExceededError ? 429 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
