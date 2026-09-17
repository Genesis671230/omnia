import { NextResponse } from "next/server";
import { ingestPayoutEmails } from "@/lib/finance/payout-email-ingest";
import { runReconciliation, summarizeReconLines } from "@/lib/reconciliation/engine";
import { PayoutEmailIngestsRepository } from "@/lib/repositories/payout-email-ingests.repository";

export const maxDuration = 120;

// GET  /api/integrations/gmail/ingest — recent ingest history.
// POST /api/integrations/gmail/ingest — "Check Gmail now": pull any new payout
// reports, then re-run the reconciler so newly matched credits appear without
// waiting for the scheduler.
export async function GET() {
  try {
    return NextResponse.json({ recent: await PayoutEmailIngestsRepository.recent(25) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const days = Number.isFinite(Number(body.days)) ? Number(body.days) : 30;

  try {
    const summary = await ingestPayoutEmails({ days });
    if (!summary.configured) {
      return NextResponse.json(
        {
          error:
            "Gmail is not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_USER, then visit /api/integrations/gmail/connect to mint GMAIL_REFRESH_TOKEN.",
          ...summary,
        },
        { status: 400 },
      );
    }

    // Only worth reconciling when something actually landed.
    const recon = summary.ingested > 0 ? summarizeReconLines(await runReconciliation()) : null;
    return NextResponse.json({ ...summary, recon });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
