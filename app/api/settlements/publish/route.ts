import { NextResponse } from "next/server";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";
import { ZohoPublishRunsRepository, type ZohoPublishResult } from "@/lib/repositories/zoho-publish-runs.repository";
import { createZohoCustomerPayment, getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";


export async function POST(request: Request) {
  if (!zohoConfigured()) {
    return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  const settlementIds = Array.isArray(body.settlementIds) ? body.settlementIds.map(String) : [];
  const bankLineId = typeof body.bankLineId === "string" && body.bankLineId ? body.bankLineId : null;
  const accountId = typeof body.accountId === "string" && body.accountId ? body.accountId : undefined;
  const referenceNumberOverride =
    typeof body.referenceNumberOverride === "string" && body.referenceNumberOverride
      ? body.referenceNumberOverride
      : undefined;
console.log(settlementIds,"this is settlementIds from publish route");
console.log(bankLineId,"this is bankLineId from publish route");
console.log(accountId,"this is accountId from publish route");
if (settlementIds.length === 0 && !bankLineId) {
  return NextResponse.json({ error: "settlementIds or bankLineId is required" }, { status: 400 });
}
// if (settlementIds.length > 0 && bankLineId) {
//   return NextResponse.json({ error: "pass settlementIds or bankLineId, not both" }, { status: 400 });
// }

const runId = await ZohoPublishRunsRepository.start();
const results: (ZohoPublishResult & { outcome?: string })[] = [];
const writeOffResidualAsFee = body.writeOffResidualAsFee === true;
try {
  const settlements = settlementIds.length > 0
  ? await SettlementsRepository.listByIds(settlementIds)
  : bankLineId
    ? await SettlementsRepository.listByBankLineId(bankLineId)
    : [];

if (settlements.length === 0) {
  return NextResponse.json(
    { error: "No settlements resolved from settlementIds or bankLineId" },
    { status: 400 },
  );
}
  const accessToken = await getAccessToken();

    for (const s of settlements) {
      const attemptId = crypto.randomUUID();
console.log(attemptId,"this is attemptId from publish route");
      // if (s.zoho_payment_id) {
      //   console.log(s.zoho_payment_id,"this is s.zoho_payment_id from publish route");
      //   console.log(results,"this is results from publish route");
      //   results.push({ settlementId: s.id, ok: false, error: "Already published" });
      //   console.log(results,"this is results from publish route");
      //   continue;
      // }
      // if (!s.evidence_confirmed) {
      //   console.log(s.evidence_confirmed,"this is s.evidence_confirmed from publish route");
      //   console.log(results,"this is results from publish route");
      //   results.push({ settlementId: s.id, ok: false, error: "Not evidence-confirmed" });
      //   console.log(results,"this is results from publish route");
      //   continue;
      // }

      // const claimed = await SettlementsRepository.claimForPublish(s.id, attemptId);
      // if (!claimed) {
      //   console.log(claimed,"this is claimed from publish route");
      //   console.log(results,"this is results from publish route");
      //   results.push({ settlementId: s.id, ok: false, error: "Already published or being published" });
      //   console.log(results,"this is results from publish route");
      //   continue;
      // }

      const useInvoiceBalanceAsAmount = body.useInvoiceBalanceAsAmount === true;
      try {
        console.log(s.customer_name,"this is s.customer_name from publish route");
        console.log(s.order_number + " " + s.customer_name,"this is s.order_number + ' ' + s.customer_name from publish route");
        console.log(s.gross_aed,"this is s.gross_aed from publish route");
        console.log(s.gateway,"this is s.gateway from publish route");
        console.log(s.bank_reference,"this is s.bank_reference from publish route");
        console.log(s.settlement_date ?? undefined,"this is s.settlement_date ?? undefined from publish route");
        console.log(accountId,"this is accountId from publish route");
        console.log(referenceNumberOverride,"this is referenceNumberOverride from publish route");
        console.log("Settlement for order " + s.order_number,"this is 'Settlement for order ' + s.order_number from publish route");
        console.log(0,"this is 0 from publish route");
        console.log([],"this is [] from publish route");
        const { payment_id, outcome } = await createZohoCustomerPayment(
          {
            customerName: s.customer_name,
            invoiceReferenceNumber: s.order_number,
            amount: s.gross_aed, // ignored when useInvoiceBalanceAsAmount is true
            gateway: s.gateway,
            bankReference: s.bank_reference,
            date: s.settlement_date ?? undefined,
            accountId,
            referenceNumberOverride,
            description: "Settlement for order " + s.order_number,
            bankCharges: 0,
            customFields: [],
            useInvoiceBalanceAsAmount,
          },
          accessToken,
        );
        await SettlementsRepository.markPublished(s.id, payment_id);
        results.push({ settlementId: s.id, ok: true, paymentId: payment_id, outcome: outcome });
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
    return NextResponse.json({ results: results });
  } catch (e) {
    await ZohoPublishRunsRepository.finish(runId, results, (e as Error).message);
    return NextResponse.json({ error: (e as Error).message, results }, { status: 500 });
  }
}
