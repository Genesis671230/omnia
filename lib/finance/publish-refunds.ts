// Books refunds a gateway netted out of a payout (e.g. Tamara statement line
// "804047 Refunded (592.42)"): a credit note against the order's invoice, and
// a refund of that credit note paid from the gateway clearing account. After
// it, the clearing account is short by exactly what the gateway kept back, so
// it still nets to the bank credit.
//
// Same retry discipline as publish-settlements.ts: row lease, PENDING markers,
// look up by reference before writing again.

import { findZohoInvoiceCandidates } from "@/lib/integrations/zoho";
import {
  createCreditNote,
  createCreditNoteRefund,
  findCreditNoteRefund,
  getInvoiceTaxProfile,
  listCustomerCreditNotes,
  ZohoRejection,
} from "@/lib/integrations/zoho-settlement-posting";
import { RefundPostingsRepository, refundPostingId, type RefundPostingRow } from "@/lib/repositories/refund-postings.repository";
import type { ReconLine } from "@/lib/reconciliation/engine";
import {
  bankScaleFor,
  buildCreditNoteRefundBody,
  buildRefundCreditNoteBody,
  isCrossBorderCurrency,
  pickInvoiceForRefund,
  refundReferences,
  ROUNDING_TOLERANCE_AED,
} from "@/lib/finance/settlement-posting";

export type RefundStatus = "booked" | "planned" | "review" | "failed" | "busy" | "unlinked";

export type RefundResult = {
  ref: string;
  orderNumber: string | null;
  amount: number;
  status: RefundStatus;
  ok: boolean;
  message?: string;
  invoiceNumber?: string;
  creditNote?: { id: string | null; number?: string; reused: boolean; balance?: number } | null;
  refundId?: string | null;
  uncertain?: boolean;
};

const isReal = (v: string | null | undefined) => !!v && !/^(PENDING|CLAIMED):/.test(v);

/** Refund lines on the payout, with the order each resolved to. */
export function refundLinesOf(line: ReconLine) {
  const scale = bankScaleFor({ crossBorder: isCrossBorderCurrency(line.payout?.currency), bankAmount: line.bankAmount, payoutNet: line.payout?.net ?? 0 });
  return line.transactions
    .filter((t) => t.isRefund)
    .map((t) => ({
      ref: t.ref,
      orderNumber: t.orderNumber ?? null,
      // What left the payout for this refund, in AED as the bank saw it.
      amount: +Math.abs((t.netShare || t.grossShare) * (scale === 1 ? 1 : scale)).toFixed(2),
    }))
    .filter((r) => r.amount >= ROUNDING_TOLERANCE_AED);
}

export async function publishRefunds(opts: {
  line: ReconLine;
  depositAccountId: string;
  refs?: string[];
  dryRun: boolean;
  accessToken: string;
}): Promise<RefundResult[]> {
  const { line } = opts;
  const results: RefundResult[] = [];
  const existing = new Map((await RefundPostingsRepository.listByBankLine(line.id)).map((r) => [r.id, r]));

  for (const r of refundLinesOf(line)) {
    if (opts.refs && !opts.refs.includes(r.ref)) continue;
    if (!r.orderNumber || !line.payout) {
      results.push({ ...r, status: "unlinked", ok: false, message: `Refund line ${r.ref} isn't matched to an order — link it to its order first.` });
      continue;
    }
    const prior = existing.get(refundPostingId(line.payout.id, r.orderNumber));
    const row: RefundPostingRow = opts.dryRun
      ? prior ?? { id: refundPostingId(line.payout.id, r.orderNumber), bank_line_id: line.id, payout_id: line.payout.id, order_number: r.orderNumber, amount_aed: r.amount, zoho_invoice_id: null, zoho_creditnote_id: null, creditnote_reused: false, zoho_refund_id: null, error: null, claimed_at: null, posted_at: null }
      : await RefundPostingsRepository.ensure({ bank_line_id: line.id, payout_id: line.payout.id, order_number: r.orderNumber, amount_aed: r.amount });
    results.push(await publishOne({ ...r, orderNumber: r.orderNumber }, row, opts));
  }
  return results;
}

async function publishOne(
  r: { ref: string; orderNumber: string; amount: number },
  row: RefundPostingRow,
  opts: { line: ReconLine; depositAccountId: string; dryRun: boolean; accessToken: string },
): Promise<RefundResult> {
  const { line, dryRun, accessToken } = opts;
  const base = { ref: r.ref, orderNumber: r.orderNumber, amount: r.amount };
  const gateway = line.provider;
  const date = (line.date ?? new Date().toISOString()).slice(0, 10);
  const refs = refundReferences(line.reference || line.id, r.orderNumber);
  const save = async (patch: Partial<RefundPostingRow>) => { if (!dryRun) await RefundPostingsRepository.update(row.id, patch); };

  if (isReal(row.zoho_refund_id)) {
    return { ...base, status: "booked", ok: true, refundId: row.zoho_refund_id, creditNote: { id: row.zoho_creditnote_id, reused: row.creditnote_reused } };
  }
  if (!opts.depositAccountId) return { ...base, status: "review", ok: false, message: "Pick the Deposit To (clearing) account first." };
  if (!dryRun && !(await RefundPostingsRepository.lease(row.id))) {
    return { ...base, status: "busy", ok: false, message: "Another run is booking this refund — wait a minute." };
  }

  let invoiceNumber: string | undefined;
  try {
    // 1. the invoice being refunded
    let candidates;
    try {
      candidates = await findZohoInvoiceCandidates(r.orderNumber, accessToken, process.env.ZOHO_ORGANIZATION_ID!);
    } catch (e) {
      throw new ZohoRejection((e as Error).message);
    }
    const picked = pickInvoiceForRefund(candidates, { orderNumber: r.orderNumber, amount: r.amount, preferredInvoiceId: row.zoho_invoice_id });
    if (!picked.invoice) {
      await save({ error: picked.error });
      return { ...base, status: "review", ok: false, message: picked.error };
    }
    invoiceNumber = picked.invoice.invoice_number;
    if (Number(picked.invoice.balance) > ROUNDING_TOLERANCE_AED && !isReal(row.zoho_creditnote_id)) {
      const msg = `Invoice ${invoiceNumber} still has AED ${Number(picked.invoice.balance).toFixed(2)} unpaid — book the original payment for order ${r.orderNumber} (captured in an earlier payout) before refunding it.`;
      await save({ error: msg });
      return { ...base, invoiceNumber, status: "review", ok: false, message: msg };
    }
    const invoice = await getInvoiceTaxProfile(picked.invoice.invoice_id, accessToken);

    // 2. credit note — ours from a previous attempt, an open one someone
    //    already raised for this customer, or a new one.
    let creditNoteId = isReal(row.zoho_creditnote_id) ? row.zoho_creditnote_id : null;
    let creditNote: RefundResult["creditNote"] = creditNoteId ? { id: creditNoteId, reused: row.creditnote_reused } : null;
    if (!creditNoteId) {
      const notes = await listCustomerCreditNotes(invoice.customer_id, accessToken);
      const ours = notes.find((n) => String(n.reference_number ?? "").trim() === refs.creditNote && n.status !== "void");
      const open = notes
        .filter((n) => n.status === "open" && n.balance + ROUNDING_TOLERANCE_AED >= r.amount)
        .sort((a, b) => a.balance - b.balance)[0];
      if (ours) {
        creditNoteId = ours.creditnote_id;
        creditNote = { id: ours.creditnote_id, number: ours.creditnote_number, reused: false, balance: ours.balance };
        await save({ zoho_creditnote_id: creditNoteId, zoho_invoice_id: invoice.invoice_id, creditnote_reused: false });
      } else if (open) {
        // Someone already raised a credit note for this customer — refund
        // against it rather than crediting the sale twice.
        creditNoteId = open.creditnote_id;
        creditNote = { id: open.creditnote_id, number: open.creditnote_number, reused: true, balance: open.balance };
        await save({ zoho_creditnote_id: creditNoteId, zoho_invoice_id: invoice.invoice_id, creditnote_reused: true });
      } else if (dryRun) {
        creditNote = { id: null, reused: false };
      } else {
        await save({ zoho_creditnote_id: `PENDING:${crypto.randomUUID()}`, zoho_invoice_id: invoice.invoice_id, error: null });
        try {
          const created = await createCreditNote(
            buildRefundCreditNoteBody({ invoice, amount: r.amount, date, reference: refs.creditNote, orderNumber: r.orderNumber, gateway }),
            accessToken,
          );
          creditNoteId = created.id;
          creditNote = { id: created.id, number: created.number, reused: false };
          await save({ zoho_creditnote_id: created.id, creditnote_reused: false });
        } catch (e) {
          if (e instanceof ZohoRejection) await save({ zoho_creditnote_id: null });
          throw e;
        }
      }
    }

    if (dryRun) {
      return {
        ...base, invoiceNumber, creditNote, status: "planned", ok: true,
        message: creditNote?.reused
          ? `Will refund AED ${r.amount.toFixed(2)} from the clearing account against existing open credit note ${creditNote.number} (balance AED ${creditNote.balance?.toFixed(2)}).`
          : `Will raise a credit note for AED ${r.amount.toFixed(2)} against ${invoiceNumber} and refund it from the clearing account.`,
      };
    }

    // 3. refund the credit note out of the clearing account
    let refundId: string | null = null;
    if (row.zoho_refund_id?.startsWith("PENDING:") && creditNoteId) {
      refundId = await findCreditNoteRefund(creditNoteId, refs.refund, accessToken);
    }
    if (!refundId) {
      await save({ zoho_refund_id: `PENDING:${crypto.randomUUID()}` });
      try {
        refundId = await createCreditNoteRefund(
          creditNoteId!,
          buildCreditNoteRefundBody({ amount: r.amount, date, reference: refs.refund, fromAccountId: opts.depositAccountId, orderNumber: r.orderNumber, gateway }),
          accessToken,
        );
      } catch (e) {
        if (e instanceof ZohoRejection) await save({ zoho_refund_id: null });
        throw e;
      }
    }
    await save({ zoho_refund_id: refundId, posted_at: new Date().toISOString(), error: null });
    return { ...base, invoiceNumber, creditNote, refundId, status: "booked", ok: true };
  } catch (e) {
    const message = (e as Error).message;
    const uncertain = !(e instanceof ZohoRejection);
    await save({ error: message.slice(0, 1000) }).catch(() => {});
    return {
      ...base, invoiceNumber, status: "failed", ok: false, uncertain,
      message: uncertain ? `${message} — Zoho may not have answered; retrying is safe.` : message,
    };
  } finally {
    if (!dryRun) await RefundPostingsRepository.release(row.id).catch(() => {});
  }
}
