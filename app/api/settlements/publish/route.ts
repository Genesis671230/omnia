import { NextResponse } from "next/server";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";
import { ZohoPublishRunsRepository } from "@/lib/repositories/zoho-publish-runs.repository";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { runReconciliation } from "@/lib/reconciliation/engine";
import { publishSettlements } from "@/lib/finance/publish-settlements";

// A 28-order payout is ~150 paced Zoho calls.
export const maxDuration = 300;

// POST /api/settlements/publish
//   body: {
//     bankLineId: string,              — the confirmed bank credit
//     settlementIds?: string[],        — a subset; omit for every order on it
//     depositAccountId: string,        — clearing account, e.g. "TABBY AED"
//     feeAccountId: string,            — e.g. "Payment Gateway Charges"
//     vatTaxId?: string,               — AED payouts: fee is VAT-inclusive
//     differenceAccountId?: string,    — Exchange Gain or Loss
//     referenceNumberOverride?: string,
//     deliveryAccountId?: string,      — COD: expense account for courier delivery charges
//     deliveryOnly?: boolean,          — COD: book just the delivery charges
//     bookFeesOnExternallyPaid?: boolean — also book fee/FX on invoices
//                                         already paid by hand in Zoho
//     dryRun?: boolean,                — reads Zoho, writes nothing
//   }
//
// Per order: payment for the full invoice → fee expense → FX/rounding journal.
// See lib/finance/publish-settlements.ts.
export async function POST(request: Request) {
  if (!zohoConfigured()) {
    return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const bankLineId = str(body.bankLineId);
  const settlementIds: string[] = Array.isArray(body.settlementIds) ? body.settlementIds.map(String) : [];
  const dryRun = body.dryRun === true;
  const accounts = {
    depositAccountId: str(body.depositAccountId ?? body.accountId),
    feeAccountId: str(body.feeAccountId),
    vatTaxId: str(body.vatTaxId) || null,
    differenceAccountId: str(body.differenceAccountId) || null,
    deliveryAccountId: str(body.deliveryAccountId) || null,
  };
  // COD vouchers: book only the courier's delivery / return charges.
  const deliveryOnly = body.deliveryOnly === true;

  if (!bankLineId) {
    return NextResponse.json({ error: "bankLineId is required" }, { status: 400 });
  }
  if (!accounts.depositAccountId) {
    return NextResponse.json({ error: "Pick the Deposit To (clearing) account first." }, { status: 400 });
  }

  const line = (await runReconciliation()).find((l) => l.id === bankLineId);
  if (!line) return NextResponse.json({ error: `No reconciliation line ${bankLineId}` }, { status: 404 });
  if (!line.confirmedBy) {
    return NextResponse.json({ error: "Confirm this settlement before recording payments." }, { status: 409 });
  }
  if (!line.payout) return NextResponse.json({ error: "This bank credit has no matched payout file." }, { status: 409 });

  // Rows written after the credit was confirmed (e.g. a re-uploaded payout
  // file) are born unconfirmed; the confirmation covers them too.
  await SettlementsRepository.confirmEvidenceForBankLine(line.id, line.confirmedBy);

  const all = await SettlementsRepository.listByBankLineId(line.id);
  const wanted = settlementIds.length > 0 ? new Set(settlementIds) : null;
  const settlements = deliveryOnly ? [] : all.filter((s) => !wanted || wanted.has(s.id));
  if (settlements.length === 0 && !deliveryOnly) {
    return NextResponse.json(
      { error: "No settlement records for this credit — run reconciliation again after the payout file upload." },
      { status: 400 },
    );
  }

  const runId = dryRun ? null : await ZohoPublishRunsRepository.start();
  try {
    const { results, wire, delivery } = await publishSettlements({
      line,
      settlements,
      accounts,
      referenceOverride: str(body.referenceNumberOverride) || undefined,
      dryRun,
      accessToken: await getAccessToken(),
      bookFeesOnExternallyPaid: body.bookFeesOnExternallyPaid === true,
      // A single-order Record never books the voucher's delivery charges.
      includeDelivery: deliveryOnly || settlementIds.length === 0,
    });
    if (runId) {
      await ZohoPublishRunsRepository.finish(
        runId,
        results.map((r) => ({
          ...r,
          error: r.ok ? undefined : r.message,
          paymentId: r.paymentId ?? undefined,
          needsManualReview: r.uncertain,
        })),
      );
    }
    return NextResponse.json({
      dryRun,
      results,
      // The bank's own cut on a cross-border wire, booked once for the whole
      // credit rather than smeared across its orders.
      wire,
      delivery,
      settlements: await SettlementsRepository.listByBankLineId(line.id),
    });
  } catch (e) {
    if (runId) await ZohoPublishRunsRepository.finish(runId, [], (e as Error).message).catch(() => {});
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
