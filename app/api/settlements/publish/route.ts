import { NextResponse } from "next/server";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";
import { ZohoPublishRunsRepository, type ZohoPublishResult } from "@/lib/repositories/zoho-publish-runs.repository";
import { createZohoCustomerPayment, getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";

// POST /api/settlements/publish — manual, reviewed batch push to Zoho
// Books. Re-validates evidence_confirmed + not-already-published
// server-side (never trust the UI's filter for a real money-writing action).
//
// Duplicate-payment safety: each settlement is atomically claimed
// (claimForPublish) before any Zoho call is attempted — two concurrent
// requests, or a client retry, can't both create a Customer Payment for the
// same settlement. A clean Zoho rejection releases the claim (retryable);
// an ambiguous failure (timeout/5xx — we can't tell if Zoho's write landed)
// deliberately leaves the claim in place and is reported with
// needsManualReview so a human checks Zoho directly rather than risking a
// silent duplicate on auto-retry.
export async function POST(request: Request) {
  if (!zohoConfigured()) {
    return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  const settlementIds = Array.isArray(body.settlementIds) ? body.settlementIds.map(String) : [];
  if (settlementIds.length === 0) {
    return NextResponse.json({ error: "settlementIds is required" }, { status: 400 });
  }

  const runId = await ZohoPublishRunsRepository.start();
  const results: ZohoPublishResult[] = [];

  try {
    const settlements = await SettlementsRepository.listByIds(settlementIds);
    // Fetched once per batch, not once per settlement — createZohoCustomerPayment
    // takes it as a parameter instead of fetching its own token per call.
    const accessToken = await getAccessToken();

    for (const s of settlements) {
      const attemptId = crypto.randomUUID();

      if (s.zoho_payment_id) {
        results.push({ settlementId: s.id, ok: false, error: "Already published" });
        continue;
      }
      if (!s.evidence_confirmed) {
        results.push({ settlementId: s.id, ok: false, error: "Not evidence-confirmed" });
        continue;
      }

      const claimed = await SettlementsRepository.claimForPublish(s.id, attemptId);
      if (!claimed) {
        results.push({ settlementId: s.id, ok: false, error: "Already published or being published" });
        continue;
      }

      try {
        const { payment_id } = await createZohoCustomerPayment(
          {
            invoiceReferenceNumber: s.order_number,
            amount: s.gross_aed,
            gateway: s.gateway,
            bankReference: s.bank_reference,
          },
          accessToken,
        );
        await SettlementsRepository.markPublished(s.id, payment_id);
        results.push({ settlementId: s.id, ok: true, paymentId: payment_id });
      } catch (e) {
        const message = (e as Error).message;
        // Anything with an HTTP status in the message is a definite response
        // from Zoho (accepted or rejected) — safe to release and retry.
        // A bare network/timeout failure carries no such status, meaning we
        // genuinely don't know whether Zoho's write landed — leave the claim
        // in place rather than risk a duplicate on the next auto-retry.
        const isDefiniteRejection = /HTTP \d{3}|error \d+|No Zoho invoice found|Ambiguous Zoho invoice|exceeds Zoho invoice|no balance field/.test(message);
        if (isDefiniteRejection) {
          await SettlementsRepository.releaseClaim(s.id, attemptId);
          results.push({ settlementId: s.id, ok: false, error: message });
        } else {
          results.push({ settlementId: s.id, ok: false, error: message, needsManualReview: true });
        }
      }
    }

    await ZohoPublishRunsRepository.finish(runId, results);
    return NextResponse.json({ results });
  } catch (e) {
    await ZohoPublishRunsRepository.finish(runId, results, (e as Error).message);
    return NextResponse.json({ error: (e as Error).message, results }, { status: 500 });
  }
}
