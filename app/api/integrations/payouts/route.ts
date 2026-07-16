import { NextResponse } from "next/server";
import { telrConfigured } from "@/lib/integrations/telr";
import { stripeConfigured } from "@/lib/integrations/stripe";
import { syncGatewayPayouts } from "@/lib/payout-sync";
import { SyncRunsRepository } from "@/lib/repositories/sync-runs.repository";

export const maxDuration = 60;

// GET /api/integrations/payouts — which live gateway APIs are configured,
// plus the most recent run of the persistent sync scheduler (manual or
// automatic) so the UI can show founders when payouts were last verified.
export async function GET() {
  const lastRun = await SyncRunsRepository.getLatest();
  return NextResponse.json({ telr: telrConfigured(), stripe: stripeConfigured(), lastRun });
}

// POST /api/integrations/payouts — pull payouts directly from configured
// gateway APIs for the last N days, in place of uploading a file. Also used
// on-demand by founders; the scheduler calls syncGatewayPayouts directly.
export async function POST(request: Request) {
  const { days = 30 } = await request.json().catch(() => ({}));
  const results = await syncGatewayPayouts(days);
  await SyncRunsRepository.record({ trigger: "manual", gatewayResults: results });

  if (results.length === 0) {
    return NextResponse.json({
      results: [],
      message: "No gateway APIs configured — set TELR_ACCOUNT_ID/TELR_API_USERNAME/TELR_API_PASSWORD or STRIPE_SECRET_KEY, or keep uploading payout files by hand.",
    });
  }

  return NextResponse.json({ results });
}
