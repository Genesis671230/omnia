import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { runInZohoOrgOr400, zohoOrgForBankLine } from "@/lib/integrations/zoho-org";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { runReconciliation } from "@/lib/reconciliation/engine";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";
import { RefundPostingsRepository } from "@/lib/repositories/refund-postings.repository";
import { buildBatchTally } from "@/lib/finance/batch-tally";
import { loadDeliveryEntities } from "@/lib/finance/delivery-entities.server";
import { supabase } from "@/lib/supabase";
import type { DeliveryPosting } from "@/lib/finance/delivery-entities.server";
import { AdviceError, adviseOnBatch } from "@/lib/ai/batch-advisor";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/settlements/advice  { bankLineId, ai?: boolean }
//   → { tally, advice?, model?, lookups? }
// The tally (booked / pending / unexplained, per order) is computed and always
// returned. With ai !== false, Claude reviews it with read-only access to this
// batch's invoices, payments and credit notes in Zoho and proposes fixes —
// lib/ai/batch-advisor.ts. Nothing is written.

/** Every delivery charge is in a Zoho document — on both sides for a sister
 *  company's (its expense and the voucher company's journal). */
async function deliveryState(payoutId: string | undefined) {
  if (!payoutId) return { docs: 0, fullyBooked: true };
  const { data, error } = await supabase.from("payouts").select("delivery_postings").eq("id", payoutId).maybeSingle();
  if (error) throw new Error(`payouts read failed: ${error.message}`);
  const postings = (data?.delivery_postings ?? []) as DeliveryPosting[];
  const state = await loadDeliveryEntities(payoutId);
  if (!state || state.charges.length === 0) return { docs: postings.length, fullyBooked: true };
  const has = (leg: DeliveryPosting["leg"], org: string, ref: string) =>
    postings.some((p) => p.leg === leg && p.org === org && p.refs.includes(ref));
  const fullyBooked = state.charges.every((c) =>
    c.entity === state.voucherOrg
      ? has("own", c.entity, c.ref)
      : has("ic-counterpart", c.entity, c.ref) && has("ic-voucher", state.voucherOrg, c.ref),
  );
  return { docs: postings.length, fullyBooked };
}

async function handlePOST(bankLineId: string, useAi: boolean) {
  const line = (await runReconciliation()).find((l) => l.id === bankLineId);
  if (!line) return NextResponse.json({ error: `No reconciliation line ${bankLineId}` }, { status: 404 });

  const [settlements, refunds, delivery] = await Promise.all([
    SettlementsRepository.listByBankLineId(line.id),
    RefundPostingsRepository.listByBankLine(line.id),
    deliveryState(line.payout?.id),
  ]);
  const tally = buildBatchTally({
    line, settlements, refunds, deliveryDocsBooked: delivery.docs, deliveryFullyBooked: delivery.fullyBooked,
  });
  if (!useAi) return NextResponse.json({ tally });

  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ tally, error: "ANTHROPIC_API_KEY is not set" }, { status: 503 });
  if (!zohoConfigured()) return NextResponse.json({ tally, error: "Zoho is not configured" }, { status: 503 });
  try {
    const { advice, model, lookups } = await adviseOnBatch(tally, await getAccessToken());
    return NextResponse.json({ tally, advice, model, lookups });
  } catch (e) {
    const fail = (error: string, status: number) => NextResponse.json({ tally, error }, { status });
    if (e instanceof AdviceError) return fail(e.message, e.status);
    if (e instanceof Anthropic.RateLimitError) return fail("AI is rate-limited right now — try again in a minute.", 429);
    if (e instanceof Anthropic.APIConnectionError) return fail("Couldn't reach the AI service.", 502);
    if (e instanceof Anthropic.APIError) return fail(`AI error ${e.status ?? ""}: ${e.message}`, 502);
    return fail((e as Error).message, 500);
  }
}

// Runs in the batch's own Zoho organisation — the invoices it reads are the ones this payout closes.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { bankLineId?: unknown; ai?: unknown };
  const bankLineId = typeof body.bankLineId === "string" ? body.bankLineId.trim() : "";
  if (!bankLineId) return NextResponse.json({ error: "bankLineId is required" }, { status: 400 });
  return runInZohoOrgOr400(await zohoOrgForBankLine(bankLineId), () => handlePOST(bankLineId, body.ai !== false));
}
