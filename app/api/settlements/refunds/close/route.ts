import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { createCreditNoteRefund, getCreditNoteLive, ZohoRejection } from "@/lib/integrations/zoho-settlement-posting";
import { refundLinesOf } from "@/lib/finance/publish-refunds";
import { buildCreditNoteRefundBody, refundReferences, ROUNDING_TOLERANCE_AED } from "@/lib/finance/settlement-posting";
import { runReconciliation } from "@/lib/reconciliation/engine";
import { RefundPostingsRepository, refundPostingId } from "@/lib/repositories/refund-postings.repository";

export const maxDuration = 60;

// POST /api/settlements/refunds/close
//   { bankLineId, ref, date, parts: [{ accountId, amount, description }] }
//
// Full control over closing one refund's credit note: each part is a refund
// of the credit note from the account the founder picked, for the amount and
// narration they typed — e.g. the net the gateway deducted from TABBY AED and
// the fee part from Payment Gateway Charges. Validated against the credit
// note's LIVE open balance; each part carries a deterministic reference, so a
// retry finds it instead of refunding twice.
type Part = { accountId: string; amount: number; description: string };

export async function POST(request: Request) {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  const bankLineId = String(body.bankLineId ?? "");
  const ref = String(body.ref ?? "");
  const date = String(body.date ?? "").slice(0, 10);
  const parts: Part[] = (Array.isArray(body.parts) ? body.parts : []).map((p: Record<string, unknown>) => ({
    accountId: String(p.accountId ?? ""), amount: Math.round(Number(p.amount) * 100) / 100, description: String(p.description ?? "").trim(),
  })).filter((p: Part) => p.amount > 0);
  if (!bankLineId || !ref) return NextResponse.json({ error: "bankLineId and ref are required" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Pick the refund date" }, { status: 400 });
  if (parts.length === 0) return NextResponse.json({ error: "Add at least one refund part with an amount" }, { status: 400 });
  const noAccount = parts.find((p) => !p.accountId);
  if (noAccount) return NextResponse.json({ error: `Pick the account for the AED ${noAccount.amount.toFixed(2)} part` }, { status: 400 });

  try {
    const line = (await runReconciliation()).find((l) => l.id === bankLineId);
    if (!line?.payout) return NextResponse.json({ error: "No matched payout on this credit" }, { status: 404 });
    if (!line.confirmedBy) return NextResponse.json({ error: "Confirm this settlement first." }, { status: 409 });
    const r = refundLinesOf(line).find((x) => x.ref === ref);
    if (!r) return NextResponse.json({ error: `No refund line ${ref} on this payout` }, { status: 404 });
    const key = r.orderNumber ?? r.ref;
    const row = (await RefundPostingsRepository.listByBankLine(bankLineId)).find((x) => x.id === refundPostingId(line.payout!.id, key));
    const cnId = row?.zoho_creditnote_id;
    if (!row || !cnId || /^(PENDING|CLAIMED):/.test(cnId)) {
      return NextResponse.json({ error: "This refund has no credit note yet — press Book refunds first to raise it." }, { status: 409 });
    }

    const accessToken = await getAccessToken();
    const live = await getCreditNoteLive(cnId, accessToken);
    const total = Math.round(parts.reduce((s, p) => s + p.amount, 0) * 100) / 100;
    const base = refundReferences(line.reference || line.id, key).refund;
    const refOf = (p: Part, i: number) => `${base}/M${i + 1}-${Math.round(p.amount * 100)}`.slice(0, 100);
    const already = new Set(live.refunds.map((x) => x.reference));
    const toPost = parts.map((p, i) => ({ p, reference: refOf(p, i) })).filter((x) => !already.has(x.reference));
    const newTotal = Math.round(toPost.reduce((s, x) => s + x.p.amount, 0) * 100) / 100;
    if (newTotal > live.balance + ROUNDING_TOLERANCE_AED) {
      return NextResponse.json({
        error: `Credit note ${live.number} has AED ${live.balance.toFixed(2)} open in Zoho; these parts refund AED ${newTotal.toFixed(2)}. Refresh and adjust.`,
      }, { status: 400 });
    }

    const posted: { reference: string; id: string; amount: number }[] = [];
    for (const { p, reference } of toPost) {
      try {
        const id = await createCreditNoteRefund(cnId, buildCreditNoteRefundBody({
          amount: p.amount, date, reference, fromAccountId: p.accountId, orderNumber: key, gateway: line.provider,
          description: p.description,
        }), accessToken);
        posted.push({ reference, id, amount: p.amount });
      } catch (e) {
        const after = await getCreditNoteLive(cnId, accessToken).catch(() => null);
        const msg = (e as Error).message;
        return NextResponse.json({
          error: `${posted.length} of ${toPost.length} part(s) posted; the AED ${p.amount.toFixed(2)} part failed: ${msg}` +
            (e instanceof ZohoRejection ? "" : " — Zoho may not have answered; retrying is safe, it looks each part up by reference."),
          posted, creditNote: after,
        }, { status: 502 });
      }
    }

    const after = await getCreditNoteLive(cnId, accessToken);
    // Closed → the automatic flow must not post anything more for this refund.
    if (after.balance < ROUNDING_TOLERANCE_AED) {
      await RefundPostingsRepository.update(row.id, {
        ...(row.zoho_refund_id && !/^(PENDING|CLAIMED):/.test(row.zoho_refund_id) ? {} : { zoho_refund_id: posted[0]?.id ?? `CLOSED:${after.number}` }),
        ...(Math.abs(r.charge) >= ROUNDING_TOLERANCE_AED && r.charge > 0 && !row.zoho_charge_id ? { zoho_charge_id: `CLOSED:${after.number}`, charge_kind: "cn_refund" } : {}),
        charge_amount_aed: r.charge,
        posted_at: new Date().toISOString(),
        error: null,
      });
    }
    return NextResponse.json({ ok: true, posted, skipped: parts.length - toPost.length, total, creditNote: after });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
