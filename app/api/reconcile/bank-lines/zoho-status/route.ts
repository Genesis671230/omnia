import { NextResponse } from "next/server";
import { ZohoQuotaExceededError } from "@/lib/integrations/zoho-throttle";
import { refreshZohoLedgerStatus } from "@/lib/reconciliation/zoho-ledger-refresh";
import { getStatementAccount } from "@/lib/finance/statement-accounts";
import { withZohoOrg } from "@/lib/integrations/zoho-org";

export const maxDuration = 120;

// POST /api/reconcile/bank-lines/zoho-status  { from, to, account?, accountId?, force? }
// `account` (statement_accounts.id) reads THAT account's Zoho books and Zoho
// bank/card account — RAK lines are checked against House of Omnia, not Omniastores.
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
    const account = body.account ? await getStatementAccount(String(body.account)) : null;
    if (body.account && !account) return NextResponse.json({ error: `Unknown statement account "${body.account}"` }, { status: 400 });
    if (account && !account.zohoAccountId) {
      return NextResponse.json({ error: `Pick which Zoho account ${account.label} is first (Statement account settings).` }, { status: 400 });
    }
    const result = await withZohoOrg(account?.zohoConnectionId ?? "", () => refreshZohoLedgerStatus({
      from, to, accountId: account?.zohoAccountId || body.accountId || undefined, force: Boolean(body.force),
      statementAccount: account?.id,
    }));
    return NextResponse.json(result);
  } catch (e) {
    const status = e instanceof ZohoQuotaExceededError ? 429 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
