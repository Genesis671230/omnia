import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { fetchZohoBankAccounts, accountMapFromEnv } from "@/lib/integrations/zoho-banking";

// GET /api/integrations/zoho/bank-accounts — setup helper.
//
// Lists the chart-of-accounts entries Zoho will accept as either side of a
// payout posting, so the clearing/bank/fee account IDs can be read off and
// put into env rather than hunted for in the Zoho UI. Also reports which of
// those IDs are already configured, and flags any configured ID that no
// longer exists in Zoho — a stale mapping would otherwise only surface as a
// confusing API error at the moment a real payout is being posted.
export async function GET() {
  if (!zohoConfigured()) {
    return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  }

  let accounts;
  try {
    accounts = await fetchZohoBankAccounts(await getAccessToken());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  let configured: ReturnType<typeof accountMapFromEnv> | null = null;
  let configError: string | null = null;
  try {
    configured = accountMapFromEnv();
  } catch (e) {
    configError = (e as Error).message;
  }

  const known = new Set(accounts.map((a) => a.account_id));
  const unknownIds = configured
    ? [
        configured.bankAccountId,
        configured.feeAccountId,
        ...Object.values(configured.clearingByGateway),
      ].filter((id) => !known.has(id))
    : [];

  return NextResponse.json({
    accounts: accounts.map((a) => ({
      account_id: a.account_id,
      account_name: a.account_name,
      account_type: a.account_type,
      currency_code: a.currency_code,
      is_active: a.is_active,
    })),
    configured,
    configError,
    unknownIds,
  });
}
