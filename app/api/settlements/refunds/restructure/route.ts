import { NextResponse } from "next/server";
import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import {
  createCreditNoteRefund, deleteCreditNoteRefund, findDocumentByReference, getCreditNoteLive, getJournal, updateJournal, ZohoRejection,
} from "@/lib/integrations/zoho-settlement-posting";
import { postReturnedFeeJournal, refundLinesOf, returnedFeeVatFor } from "@/lib/finance/publish-refunds";
import {
  buildCreditNoteRefundBody, buildRefundChargeReversalJournal, isCrossBorderCurrency, refundReferences, ROUNDING_TOLERANCE_AED,
} from "@/lib/finance/settlement-posting";
import { runReconciliation } from "@/lib/reconciliation/engine";
import { RefundPostingsRepository, refundPostingId } from "@/lib/repositories/refund-postings.repository";

export const maxDuration = 60;

// POST /api/settlements/refunds/restructure
//   { bankLineId, ref, depositAccountId, chargesAccountId, dryRun }
//
// Rebooks one refund to the house model: ONE credit-note refund for the full
// amount out of clearing (credit), plus — when the gateway handed its fee
// back — a journal under the SAME reference: Dr clearing / Cr gateway charges.
// For refunds booked earlier as split refunds (net + fee part) or net-only.
//
// Only refunds this app wrote (our …/RFD, …/RFC, …/RFD/M… references) are
// deleted; a credit note carrying anyone else's refund is refused untouched.
export async function POST(request: Request) {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  const bankLineId = String(body.bankLineId ?? "");
  const ref = String(body.ref ?? "");
  const depositAccountId = String(body.depositAccountId ?? "");
  const chargesAccountId = String(body.chargesAccountId ?? "");
  const inputVatAccountId = String(body.inputVatAccountId ?? "") || null;
  const vatTaxId = String(body.vatTaxId ?? "");
  const dryRun = body.dryRun !== false;
  if (!bankLineId || !ref) return NextResponse.json({ error: "bankLineId and ref are required" }, { status: 400 });
  if (!depositAccountId) return NextResponse.json({ error: "Pick the Deposit To (clearing) account first." }, { status: 400 });

  try {
    const line = (await runReconciliation()).find((l) => l.id === bankLineId);
    if (!line?.payout) return NextResponse.json({ error: "No matched payout on this credit" }, { status: 404 });
    const r = refundLinesOf(line).find((x) => x.ref === ref);
    if (!r) return NextResponse.json({ error: `No refund line ${ref} on this payout` }, { status: 404 });
    if (r.amount < ROUNDING_TOLERANCE_AED) return NextResponse.json({ error: "This line is a charge only — there is no credit note to restructure." }, { status: 400 });
    const key = r.orderNumber ?? r.ref;
    const row = (await RefundPostingsRepository.listByBankLine(bankLineId)).find((x) => x.id === refundPostingId(line.payout!.id, key));
    const cnId = row?.zoho_creditnote_id;
    if (!row || !cnId || /^(PENDING|CLAIMED):/.test(cnId)) return NextResponse.json({ error: "No credit note recorded for this refund yet." }, { status: 409 });
    if (r.charge > 0 && !chargesAccountId) return NextResponse.json({ error: "Pick the gateway charges account the returned fee is credited to." }, { status: 400 });

    const refs = refundReferences(line.reference || line.id, key);
    const rfc = refs.creditNote.replace(/\/RFN$/, "/RFC");
    const accessToken = await getAccessToken();
    const live = await getCreditNoteLive(cnId, accessToken);
    const ours = live.refunds.filter((f) => f.reference === refs.refund || f.reference === rfc || f.reference.startsWith(`${refs.refund}/M`));
    const others = live.refunds.filter((f) => !ours.includes(f));
    if (others.length) {
      return NextResponse.json({
        error: `Credit note ${live.number} also carries refund(s) not made by this app (${others.map((o) => `${o.reference || o.id} AED ${o.amount.toFixed(2)}`).join(", ")}) — left untouched; fix it in Zoho.`,
      }, { status: 409 });
    }
    const openAfterDelete = +(live.balance + ours.reduce((s, f) => s + f.amount, 0)).toFixed(2);
    if (r.amount > openAfterDelete + ROUNDING_TOLERANCE_AED) {
      return NextResponse.json({ error: `Credit note ${live.number} would have AED ${openAfterDelete.toFixed(2)} open, less than the AED ${r.amount.toFixed(2)} refund.` }, { status: 409 });
    }
    const alreadyRight = ours.length === 1 && ours[0].reference === refs.refund && Math.abs(ours[0].amount - r.amount) < ROUNDING_TOLERANCE_AED;
    const existingJournal = r.charge > 0 ? await findDocumentByReference("journals", refs.refund, accessToken) : null;
    const fee = r.charge > 0 ? +r.charge.toFixed(2) : 0;
    const feeVat = fee > 0
      ? await returnedFeeVatFor(key, fee, !isCrossBorderCurrency(line.payout.currency) && !!vatTaxId)
      : { vat: 0, basis: "none" as const };

    const plan = {
      creditNote: { number: live.number, total: live.total, open: live.balance },
      delete: alreadyRight ? [] : ours.map((f) => ({ id: f.id, reference: f.reference, amount: f.amount })),
      refund: alreadyRight ? null : { amount: r.amount, reference: refs.refund, from: depositAccountId },
      journal: fee > 0 && !existingJournal
        ? { amount: fee, vat: feeVat.vat, vatBasis: feeVat.basis, charges: +(fee - feeVat.vat).toFixed(2), reference: refs.refund, debit: depositAccountId, credit: chargesAccountId, vatAccount: feeVat.vat > 0 ? inputVatAccountId : null }
        : null,
      netRefund: +(r.amount - fee).toFixed(2),
      /** An existing returned-fee journal that lacks the VAT line it needs —
       *  corrected in place (same journal, same reference). */
      journalVatFix: null as null | { id: string; amount: number; vat: number; charges: number; vatBasis: string },
    };
    if (existingJournal && feeVat.vat > 0) {
      if (!inputVatAccountId) return NextResponse.json({ error: 'No "Input VAT" account found in Zoho — reload the accounts and try again.' }, { status: 400 });
      const j = await getJournal(existingJournal, accessToken);
      if (!j.lines.some((l) => l.account_id === inputVatAccountId)) {
        plan.journalVatFix = { id: existingJournal, amount: fee, vat: feeVat.vat, charges: +(fee - feeVat.vat).toFixed(2), vatBasis: feeVat.basis };
      }
    }
    if (dryRun) return NextResponse.json({ dryRun: true, plan });
    if (plan.journalVatFix) {
      const j = await getJournal(plan.journalVatFix.id, accessToken);
      const debit = j.lines.find((l) => l.debit_or_credit === "debit");
      const body = buildRefundChargeReversalJournal({
        amount: fee, vatAmount: feeVat.vat, depositAccountId: debit?.account_id ?? depositAccountId, feeAccountId: chargesAccountId,
        inputVatAccountId, date: j.date, reference: j.reference || refs.refund,
        description: `${j.notes.replace(/ incl\. VAT [\d.]+/, "").replace(/(AED [\d.]+)/, `$1 incl. VAT ${feeVat.vat.toFixed(2)}`)}`,
      });
      await updateJournal(plan.journalVatFix.id, body, accessToken);
    }

    const date = (line.date ?? new Date().toISOString()).slice(0, 10);
    for (const d of plan.delete) await deleteCreditNoteRefund(cnId, d.id, accessToken);
    let refundId = alreadyRight ? ours[0].id : null;
    if (plan.refund) {
      await RefundPostingsRepository.update(row.id, { zoho_refund_id: `PENDING:${crypto.randomUUID()}` });
      try {
        refundId = await createCreditNoteRefund(cnId, buildCreditNoteRefundBody({
          amount: r.amount, date, reference: refs.refund, fromAccountId: depositAccountId, orderNumber: key, gateway: line.provider,
        }), accessToken);
      } catch (e) {
        if (e instanceof ZohoRejection) await RefundPostingsRepository.update(row.id, { zoho_refund_id: null, error: `Restructure: old refunds deleted, full refund failed — press Book refunds to retry. ${(e as Error).message}` });
        throw e;
      }
    }
    let journalId = existingJournal;
    let note: string | undefined;
    if (plan.journal) {
      const posted = await postReturnedFeeJournal({
        amount: fee, vat: feeVat.vat, depositAccountId, chargesAccountId, inputVatAccountId, date, reference: refs.refund, accessToken,
        description: `${line.provider} fee returned on refund · order ${key} · AED ${fee.toFixed(2)}` +
          `${feeVat.vat > 0 ? ` incl. VAT ${feeVat.vat.toFixed(2)}` : ""} · refund ${r.amount.toFixed(2)}, net ${plan.netRefund.toFixed(2)} · payout ${line.payout.id}`,
      });
      journalId = posted.journalId;
      note = posted.note;
    }
    await RefundPostingsRepository.update(row.id, {
      zoho_refund_id: refundId, amount_aed: r.amount, posted_at: new Date().toISOString(), error: null,
      charge_amount_aed: r.charge,
      ...(fee > 0 ? { zoho_charge_id: journalId, charge_kind: "journal" as const } : {}),
    });
    return NextResponse.json({ dryRun: false, plan, refundId, journalId, note, creditNote: await getCreditNoteLive(cnId, accessToken) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
