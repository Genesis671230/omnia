// Books refunds a gateway netted out of a payout (e.g. Tamara statement line
// "804047 Refunded (592.42)"):
//   1. a credit note against the order's invoice for the FULL refunded amount
//      (|gross|), and a refund of it paid from the gateway clearing account —
//      same amount, so the credit note closes at zero and the sale reverses;
//   2. the gateway's charge on the refund (net − gross):
//      a fee handed back (Tabby 803120: 817.50 refunded, only 778.87 deducted)
//      → ONE credit-note refund for the full 817.50 from clearing (credit), and
//      a journal with the SAME reference: Dr clearing / Cr Payment Gateway
//      Charges for the 38.63. The credit note closes on the full amount and
//      clearing shows the net refund (778.87) under one reference;
//      an extra charge (Telr 1.05, Tamara/Checkout fee-only lines) → a
//      VAT-inclusive expense out of clearing, outside the credit note.
// After both, the clearing account is short by exactly what the gateway
// deducted, so it still nets to the bank credit.
//
// Same retry discipline as publish-settlements.ts: row lease, PENDING markers,
// look up by reference before writing again.

import { findZohoInvoiceCandidates } from "@/lib/integrations/zoho";
import {
  createCreditNote,
  createCreditNoteRefund,
  createExpense,
  createJournal,
  findCreditNoteRefund,
  findDocumentByReference,
  getCreditNoteLive,
  getInvoiceTaxProfile,
  listCustomerCreditNotes,
  ZohoRejection,
} from "@/lib/integrations/zoho-settlement-posting";
import { RefundPostingsRepository, refundPostingId, type RefundPostingRow } from "@/lib/repositories/refund-postings.repository";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";
import type { ReconLine } from "@/lib/reconciliation/engine";
import {
  bankScaleFor,
  buildCreditNoteRefundBody,
  buildRefundChargeReversalJournal,
  planRefundLine,
  returnedFeeVat,
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
  /** Refunded to the customer — the credit note and its refund. */
  amount: number;
  /** net − gross: + fee handed back, − extra charge. */
  charge: number;
  chargeStatus?: "booked" | "planned" | "not_needed" | "legacy" | "failed" | "review";
  chargeId?: string | null;
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
    .map((t) => {
      const plan = planRefundLine(t, scale);
      return { ref: t.ref, orderNumber: t.orderNumber ?? null, amount: plan.refundAmount, charge: plan.charge };
    })
    .filter((r) => r.amount >= ROUNDING_TOLERANCE_AED || Math.abs(r.charge) >= ROUNDING_TOLERANCE_AED);
}

/** Booking state of one refund line — shared by the GET view and publishOne. */
export function refundLineState(r: { amount: number; charge: number }, row: RefundPostingRow | undefined) {
  const needsRefund = r.amount >= ROUNDING_TOLERANCE_AED;
  const needsCharge = Math.abs(r.charge) >= ROUNDING_TOLERANCE_AED;
  const refundDone = !needsRefund || isReal(row?.zoho_refund_id);
  // An EXTRA charge on a refund booked under the old net rule is already
  // inside that credit note. A fee handed back is not: the old rule refunded
  // only the net, so the fee part is still open on the credit note and the
  // charges step below closes it.
  const legacy = !!row && isReal(row.zoho_refund_id) && row.charge_amount_aed == null && r.charge < 0 &&
    Math.abs(Number(row.amount_aed) - r.amount) >= ROUNDING_TOLERANCE_AED;
  const chargeDone = !needsCharge || legacy || isReal(row?.zoho_charge_id);
  return { needsRefund, needsCharge, refundDone, chargeDone, legacy, booked: refundDone && chargeDone };
}

/** How much of a fee the gateway handed back on a refund is VAT — from the
 *  order's ORIGINAL fee booking when this app made it (804809: 59.71 incl.
 *  2.84 VAT → 36.56 returned carries 1.74), else from the payout (AED with a
 *  VAT tax picked → fee ÷ 105 × 5), else none. */
export async function returnedFeeVatFor(orderNumber: string, returned: number, payoutVatInclusive: boolean) {
  const original = await SettlementsRepository.originalFee(orderNumber).catch(() => null);
  return returnedFeeVat({ returned, original, payoutVatInclusive });
}

/** The returned-fee journal, under the refund's own reference:
 *  Dr clearing (full) / Cr gateway charges (ex-VAT) / Cr Input VAT (VAT, when
 *  the fee carried any). If Zoho refuses a manual line to the tax account,
 *  books the whole amount to charges and says so rather than leave clearing short. */
export async function postReturnedFeeJournal(opts: {
  amount: number; vat: number; depositAccountId: string; chargesAccountId: string;
  inputVatAccountId?: string | null; date: string; reference: string; description: string; accessToken: string;
}): Promise<{ journalId: string; note?: string }> {
  if (opts.vat > 0 && !opts.inputVatAccountId) {
    throw new ZohoRejection(`This returned fee carries AED ${opts.vat.toFixed(2)} VAT but no "Input VAT" account was found in Zoho — reload the accounts and try again.`);
  }
  const post = (vat: number) => createJournal(
    buildRefundChargeReversalJournal({
      amount: opts.amount, vatAmount: vat, depositAccountId: opts.depositAccountId, feeAccountId: opts.chargesAccountId,
      inputVatAccountId: vat > 0 ? opts.inputVatAccountId : null, date: opts.date, reference: opts.reference, description: opts.description,
    }),
    opts.accessToken,
  );
  try {
    return { journalId: await post(opts.vat) };
  } catch (e) {
    if (!(opts.vat > 0 && e instanceof ZohoRejection)) throw e;
    const journalId = await post(0);
    return {
      journalId,
      note: `Zoho refused the Input VAT line (${(e as Error).message.slice(0, 120)}) — the whole AED ${opts.amount.toFixed(2)} went to gateway charges; move AED ${opts.vat.toFixed(2)} to Input VAT by hand.`,
    };
  }
}

export type RefundAccounts = {
  depositAccountId: string;
  /** Gateway charges expense — where extra refund charges are expensed. */
  feeAccountId?: string | null;
  /** The charges account CREDITED when the gateway handed its fee back on a
   *  refund (default: feeAccountId — Payment Gateway Charges). */
  feeRefundAccountId?: string | null;
  /** AED payouts: charges carry UAE VAT (an extra charge claims it, a
   *  handed-back fee reverses it). */
  vatTaxId?: string | null;
  inputVatAccountId?: string | null;
};

export async function publishRefunds(opts: RefundAccounts & {
  line: ReconLine;
  refs?: string[];
  dryRun: boolean;
  accessToken: string;
}): Promise<RefundResult[]> {
  const { line } = opts;
  const results: RefundResult[] = [];
  const existing = new Map((await RefundPostingsRepository.listByBankLine(line.id)).map((r) => [r.id, r]));

  for (const r of refundLinesOf(line)) {
    if (opts.refs && !opts.refs.includes(r.ref)) continue;
    if (!line.payout) continue;
    // A charge-only line (no refund to a customer) needs no invoice, so it
    // books even when its ref never matched an order.
    if (!r.orderNumber && r.amount >= ROUNDING_TOLERANCE_AED) {
      results.push({ ...r, status: "unlinked", ok: false, message: `Refund line ${r.ref} isn't matched to an order — link it to its order first.` });
      continue;
    }
    const key = r.orderNumber ?? r.ref;
    const prior = existing.get(refundPostingId(line.payout.id, key));
    const row: RefundPostingRow = opts.dryRun
      ? prior ?? { id: refundPostingId(line.payout.id, key), bank_line_id: line.id, payout_id: line.payout.id, order_number: key, amount_aed: r.amount, zoho_invoice_id: null, zoho_creditnote_id: null, creditnote_reused: false, zoho_refund_id: null, error: null, claimed_at: null, posted_at: null }
      : await RefundPostingsRepository.ensure({ bank_line_id: line.id, payout_id: line.payout.id, order_number: key, amount_aed: r.amount });
    results.push(await publishOne({ ...r, orderNumber: key }, row, opts));
  }
  return results;
}

async function publishOne(
  r: { ref: string; orderNumber: string; amount: number; charge: number },
  row: RefundPostingRow,
  opts: RefundAccounts & { line: ReconLine; dryRun: boolean; accessToken: string },
): Promise<RefundResult> {
  const { line, dryRun, accessToken } = opts;
  const base = { ref: r.ref, orderNumber: r.orderNumber, amount: r.amount, charge: r.charge };
  const gateway = line.provider;
  const date = (line.date ?? new Date().toISOString()).slice(0, 10);
  const refs = refundReferences(line.reference || line.id, r.orderNumber);
  const save = async (patch: Partial<RefundPostingRow>) => { if (!dryRun) await RefundPostingsRepository.update(row.id, patch); };

  // `legacy`: booked before charges were split out — that credit note was
  // raised for the NET, so it already absorbed the charge; booking it now
  // would count it twice.
  const { needsRefund, needsCharge, refundDone, chargeDone, legacy } = refundLineState(r, row);
  const chargeStatus = (): RefundResult["chargeStatus"] =>
    !needsCharge ? "not_needed" : legacy ? "legacy" : isReal(row.zoho_charge_id) ? "booked" : undefined;

  if (refundDone && chargeDone) {
    return {
      ...base, status: "booked", ok: true, refundId: row.zoho_refund_id, chargeId: row.zoho_charge_id ?? null, chargeStatus: chargeStatus(),
      creditNote: needsRefund ? { id: row.zoho_creditnote_id, reused: row.creditnote_reused } : null,
      ...(legacy ? { message: "Booked before refund charges were split out — its credit note already carries the charge, so nothing more is booked." } : {}),
    };
  }
  if (!opts.depositAccountId) return { ...base, status: "review", ok: false, message: "Pick the Deposit To (clearing) account first." };
  if (needsCharge && !chargeDone && !opts.feeAccountId) {
    return { ...base, status: "review", ok: false, message: "Pick the Gateway charges account first — this refund carries a charge to book." };
  }
  if (!dryRun && !(await RefundPostingsRepository.lease(row.id))) {
    return { ...base, status: "busy", ok: false, message: "Another run is booking this refund — wait a minute." };
  }

  let invoiceNumber: string | undefined;
  let creditNote: RefundResult["creditNote"] = null;
  let refundId: string | null = isReal(row.zoho_refund_id) ? row.zoho_refund_id : null;
  const notes: string[] = [];
  try {
   if (!refundDone) {
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
    creditNote = creditNoteId ? { id: creditNoteId, reused: row.creditnote_reused } : null;
    if (!creditNoteId) {
      const customerNotes = await listCustomerCreditNotes(invoice.customer_id, accessToken);
      const ours = customerNotes.find((n) => String(n.reference_number ?? "").trim() === refs.creditNote && n.status !== "void");
      // An open credit note of exactly this amount closes on this refund —
      // prefer it; otherwise the smallest one that covers it.
      const covering = customerNotes.filter((n) => n.status === "open" && n.balance + ROUNDING_TOLERANCE_AED >= r.amount);
      const open = covering.find((n) => Math.abs(n.balance - r.amount) < ROUNDING_TOLERANCE_AED)
        ?? covering.sort((a, b) => a.balance - b.balance)[0];
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

    const leftOpen = creditNote?.reused && creditNote.balance != null ? +(creditNote.balance - r.amount).toFixed(2) : 0;
    if (leftOpen >= ROUNDING_TOLERANCE_AED) {
      notes.push(`Credit note ${creditNote!.number} was raised earlier for AED ${creditNote!.balance!.toFixed(2)}; the gateway refunded AED ${r.amount.toFixed(2)}, so AED ${leftOpen.toFixed(2)} stays open on it — close the rest in Zoho or tell us how it should book.`);
    }
    if (dryRun) {
      notes.push(creditNote?.reused
        ? `Will refund the full AED ${r.amount.toFixed(2)} from the clearing account against existing open credit note ${creditNote.number ?? creditNote.id}` +
          (creditNote.balance != null ? ` (balance AED ${creditNote.balance.toFixed(2)}).` : ".")
        : `Will raise a credit note for AED ${r.amount.toFixed(2)} against ${invoiceNumber} and refund it in full from the clearing account (credit note closes).`);
    } else {
    // 3. ONE refund of the credit note, for the full amount, out of clearing.
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
    }
   }

    // 4. the gateway's charge on the refund, booked beside the credit note
    let chargeId: string | null = isReal(row.zoho_charge_id) ? row.zoho_charge_id! : null;
    let charged = chargeStatus();
    if (!charged) {
      const crossBorder = isCrossBorderCurrency(line.payout?.currency);
      const withVat = !crossBorder && !!opts.vatTaxId;
      const handedBack = r.charge > 0;
      const amount = Math.abs(r.charge);
      // A fee handed back books under the refund's own reference, so the full
      // refund (credit) and the charges (debit) read as one net refund in
      // clearing. An extra charge keeps its own reference.
      const reference = handedBack
        ? refs.refund.slice(0, 100)
        : `${refs.creditNote.replace(/\/RFN$/, "")}/RFC`.slice(0, 100);
      const feeVat = handedBack
        ? await returnedFeeVatFor(r.orderNumber, amount, withVat)
        : { vat: 0, basis: "none" as const };
      const description =
        `${gateway} ${handedBack ? "fee returned on refund" : "charge on refund"} · order ${r.orderNumber} · AED ${amount.toFixed(2)}` +
        (handedBack
          ? `${feeVat.vat > 0 ? ` incl. VAT ${feeVat.vat.toFixed(2)}` : ""} · refund ${r.amount.toFixed(2)}, net ${(r.amount - amount).toFixed(2)}`
          : withVat ? " incl. VAT" : "") +
        (line.payout ? ` · payout ${line.payout.id}` : "");
      const chargesAccount = opts.feeRefundAccountId || opts.feeAccountId || "";
      const cnId = creditNote?.id ?? (isReal(row.zoho_creditnote_id) ? row.zoho_creditnote_id : null);
      if (dryRun) {
        notes.push(handedBack
          ? `Will book the AED ${amount.toFixed(2)} fee returned on this refund as Dr clearing ${amount.toFixed(2)} / Cr gateway charges ${(amount - feeVat.vat).toFixed(2)}` +
            (feeVat.vat > 0 ? ` / Cr Input VAT ${feeVat.vat.toFixed(2)} (${feeVat.basis === "original_fee" ? "the order's fee was booked with VAT" : "AED payout, VAT-inclusive fee"})` : " (no VAT on this order's fee)") +
            `, reference ${reference} — net refund AED ${(r.amount - amount).toFixed(2)}.`
          : `Will book the AED ${amount.toFixed(2)} refund charge${withVat ? " (VAT-inclusive)" : ""} out of the clearing account.`);
        charged = "planned";
      } else {
        if (handedBack) {
          if (!chargesAccount) throw new ZohoRejection("Pick the gateway charges account the returned fee is credited to.");
          // A refund booked NET under an earlier rule leaves the fee open on the
          // credit note; a journal would not close it. Say so — Restructure fixes it.
          if (cnId && !creditNote) {
            const live = await getCreditNoteLive(cnId, accessToken);
            if (live.balance >= ROUNDING_TOLERANCE_AED) {
              throw new ZohoRejection(`Credit note ${live.number} still has AED ${live.balance.toFixed(2)} open (its refund was booked net earlier) — use Restructure to rebook it as one full refund plus charges.`);
            }
          }
          if (row.zoho_charge_id?.startsWith("PENDING:")) chargeId = await findDocumentByReference("journals", reference, accessToken);
          if (!chargeId) {
            await save({ zoho_charge_id: `PENDING:${crypto.randomUUID()}`, charge_amount_aed: r.charge, charge_kind: "journal" });
            try {
              const posted = await postReturnedFeeJournal({
                amount, vat: feeVat.vat, depositAccountId: opts.depositAccountId, chargesAccountId: chargesAccount,
                inputVatAccountId: opts.inputVatAccountId, date, reference, description, accessToken,
              });
              chargeId = posted.journalId;
              if (posted.note) notes.push(posted.note);
            } catch (e) {
              if (e instanceof ZohoRejection) await save({ zoho_charge_id: null });
              throw e;
            }
          }
        } else {
          if (row.zoho_charge_id?.startsWith("PENDING:")) chargeId = await findDocumentByReference("expenses", reference, accessToken);
          if (!chargeId) {
            await save({ zoho_charge_id: `PENDING:${crypto.randomUUID()}`, charge_amount_aed: r.charge, charge_kind: "expense" });
            try {
              chargeId = await createExpense({
                account_id: opts.feeAccountId,
                paid_through_account_id: opts.depositAccountId,
                date, amount, reference_number: reference, description: description.slice(0, 500),
                tax_treatment: "vat_registered", place_of_supply: "DU", is_reverse_charge_applied: false,
                is_inclusive_tax: withVat, ...(withVat ? { tax_id: opts.vatTaxId } : {}),
              }, accessToken);
            } catch (e) {
              if (e instanceof ZohoRejection) await save({ zoho_charge_id: null });
              throw e;
            }
          }
        }
        await save({ zoho_charge_id: chargeId, charge_amount_aed: r.charge, charge_kind: handedBack ? "cn_refund" : "expense", error: null });
        charged = "booked";
      }
    }

    return {
      ...base, invoiceNumber, creditNote, refundId, chargeId, chargeStatus: charged,
      status: dryRun ? "planned" : "booked", ok: true,
      ...(notes.length ? { message: notes.join(" ") } : {}),
    };
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
