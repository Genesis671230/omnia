import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import {
  accountMapFromEnv,
  buildPayoutPostings,
  postPayoutToZoho,
  zohoBankingConfigured,
  type PayoutPostingInput,
} from "@/lib/integrations/zoho-banking";
import { runReconciliation } from "@/lib/reconciliation/engine";

export const maxDuration = 120;

// POST /api/integrations/zoho/post-payout
//   body: { bankLineId: string, dryRun?: boolean }
//
// Records a reconciled bank credit in Zoho Books: the net into the bank
// account and the gateway's fee into the fee account, both drawn from that
// gateway's clearing account. See lib/integrations/zoho-banking.ts for why
// this is a clearing transfer and not a deposit.
//
// dryRun returns exactly the postings that would be written without calling
// Zoho at all — the intended way to check the account mapping and the
// arithmetic against a real payout before letting anything touch live books.
export async function POST(request: Request) {
  if (!zohoConfigured()) {
    return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  }
  if (!zohoBankingConfigured()) {
    return NextResponse.json(
      {
        error:
          "Zoho banking accounts are not configured. Set ZOHO_BANK_ACCOUNT_ID, " +
          "ZOHO_FEE_ACCOUNT_ID and ZOHO_CLEARING_ACCOUNTS — GET " +
          "/api/integrations/zoho/bank-accounts lists the available IDs.",
      },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const bankLineId = String(body.bankLineId ?? "");
  const dryRun = Boolean(body.dryRun);
  if (!bankLineId) {
    return NextResponse.json({ error: "bankLineId required" }, { status: 400 });
  }

  const line = (await runReconciliation()).find((l) => l.id === bankLineId);
  if (!line) {
    return NextResponse.json({ error: `No reconciliation line ${bankLineId}` }, { status: 404 });
  }

  // Only a settled, human-confirmed credit may reach the books. SETTLED alone
  // means our matching believes it; confirmed means a person checked it. The
  // whole point of the confirmation step is that it gates real money.
  if (line.state !== "SETTLED") {
    return NextResponse.json(
      { error: `Bank line is ${line.state}, not SETTLED — resolve it before posting to Zoho` },
      { status: 409 },
    );
  }
  if (!line.confirmedBy) {
    return NextResponse.json(
      { error: "Bank line has not been confirmed by a person yet" },
      { status: 409 },
    );
  }
  if (!line.payout) {
    return NextResponse.json({ error: "Bank line has no matched payout" }, { status: 409 });
  }

  // Gross is derived from the same rescaled per-order shares shown in the UI's
  // proof table, so what gets posted is exactly what a bookkeeper just read on
  // screen. Falling back to net leaves the fee unposted rather than inventing
  // one when a parser produced no per-order breakdown.
  const grossFromShares = +line.transactions
    .reduce((s, t) => s + t.grossShare, 0)
    .toFixed(2);
  const grossAed = grossFromShares > 0 ? grossFromShares : line.payout.net;

  const input: PayoutPostingInput = {
    gateway: line.provider,
    bankReference: line.reference || line.id,
    date: (line.date ?? new Date().toISOString()).slice(0, 10),
    netAed: line.payout.net,
    grossAed,
    payoutId: line.payout.id,
  };

  const accounts = accountMapFromEnv();

  try {
    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        input,
        postings: buildPayoutPostings(input, accounts),
      });
    }
    const results = await postPayoutToZoho(input, accounts, await getAccessToken());
    return NextResponse.json({ dryRun: false, input, results });
  } catch (e) {
    // buildPayoutPostings' refusals are the caller's problem to fix (bad
    // mapping, impossible figures); a Zoho HTTP failure is not. Both are
    // reported verbatim so neither gets misdiagnosed as the other.
    return NextResponse.json({ error: (e as Error).message, input }, { status: 422 });
  }
}
