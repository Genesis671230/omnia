import { NextResponse } from "next/server";
import { runReconciliation } from "@/lib/reconciliation/engine";
import { BankRepository } from "@/lib/repositories/bank.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";

// GET /api/reconcile — recompute bank → payout → orders over current data
// and return the lines the reconciliation UI renders.
export async function GET() {
  const lines = await runReconciliation();

  // document checklist: which gateways have bank credits but no payout file
  const [credits, payouts] = await Promise.all([
    BankRepository.listCredits(),
    PayoutsRepository.listWithRefs(),
  ]);
  const uploadedProviders = new Set(payouts.map((p) => p.gateway));
  const missingDocs = [...new Set(
    lines
      .filter((l) => l.state === "AWAITING_PAYOUT" && l.provider !== "Unclassified")
      .map((l) => l.provider),
  )].map((provider) => ({
    provider,
    hasAnyPayoutFile: uploadedProviders.has(provider),
    awaitingAmount: +lines
      .filter((l) => l.state === "AWAITING_PAYOUT" && l.provider === provider)
      .reduce((s, l) => s + l.bankAmount, 0)
      .toFixed(2),
  }));

  return NextResponse.json({
    lines,
    documents: {
      bankStatement: credits.length > 0,
      missingPayouts: missingDocs,
    },
    computedAt: new Date().toISOString(),
  });
}
