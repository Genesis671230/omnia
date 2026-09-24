// Books the orders of one confirmed gateway payout in Zoho, order by order:
// payment (invoice closes in full) → fee expense (VAT-inclusive on AED) →
// FX / rounding journal. The math lives in ./settlement-posting.ts; this file
// is the sequencing, idempotency, and error reporting around it.
//
// Idempotency, in layers:
//   - a 5-minute row lease stops two publishes working the same order at once;
//   - before each Zoho write, its id column gets PENDING:<attempt>; the real id
//     replaces it on success, a clean rejection clears it;
//   - a retry that finds PENDING (the process died or Zoho timed out) looks the
//     document up in Zoho by its reference before writing it again;
//   - a payment is only created while the invoice is still fully open.

import { findZohoInvoiceCandidates, buildCustomerPaymentBody } from "@/lib/integrations/zoho";
import {
  createCustomerPayment,
  createExpense,
  createJournal,
  findDocumentByReference,
  findOurPaymentOnInvoice,
  ZohoRejection,
} from "@/lib/integrations/zoho-settlement-posting";
import {
  isUnsettledZohoId,
  SettlementsRepository,
  type SettlementRecord,
} from "@/lib/repositories/settlements.repository";
import type { ReconLine, ReconTransactionShare } from "@/lib/reconciliation/engine";
import {
  bankScaleFor,
  buildDifferenceJournalBody,
  buildFeeExpenseBody,
  buildDeliveryChargesExpenseBody,
  buildResidualJournalBody,
  planWireResidual,
  wireResidualReference,
  isCrossBorderCurrency,
  isFxOrder,
  pickInvoiceForOrder,
  planOrderPosting,
  postingReferences,
  ROUNDING_TOLERANCE_AED,
  type OrderPostingPlan,
  type PostingAccounts,
} from "@/lib/finance/settlement-posting";

export type OrderPublishStatus =
  | "booked"         // every needed document exists in Zoho
  | "planned"        // dry run: what would be written
  | "review"         // held back on purpose — message says why
  | "paid_external"  // invoice was already closed outside this flow
  | "failed"         // Zoho refused, or didn't answer
  | "busy";          // another publish holds this order right now

export type OrderPublishResult = {
  settlementId: string;
  orderNumber: string;
  status: OrderPublishStatus;
  ok: boolean;
  message?: string;
  /** True when Zoho may have written something we couldn't confirm. The next
   *  run verifies against Zoho before writing, so a plain retry is safe. */
  uncertain?: boolean;
  plan?: OrderPostingPlan;
  invoiceNumber?: string;
  paymentId?: string | null;
  feeExpenseId?: string | null;
  fxJournalId?: string | null;
  steps?: { payment: StepOutcome; fee: StepOutcome; difference: StepOutcome };
};

type StepOutcome = "posted" | "found_existing" | "already_done" | "not_needed" | "would_post" | "failed" | "skipped";

const bareRef = (ref: string) => ref.replace(/^#/, "").replace(/^(WA|UAE|KSA|WOO|SA)/i, "");

function transactionFor(line: ReconLine, orderNumber: string): ReconTransactionShare | null {
  const wanted = new Set([orderNumber, bareRef(orderNumber)]);
  return (
    line.transactions.find((t) => !t.isRefund && t.orderNumber === orderNumber) ??
    line.transactions.find((t) => !t.isRefund && (wanted.has(t.ref) || wanted.has(bareRef(t.ref)))) ??
    null
  );
}

function describe(e: unknown): { message: string; uncertain: boolean } {
  const message = (e as Error)?.message ?? String(e);
  return { message, uncertain: !(e instanceof ZohoRejection) };
}

export type PublishOptions = {
  line: ReconLine;
  settlements: SettlementRecord[];
  accounts: PostingAccounts;
  referenceOverride?: string;
  dryRun: boolean;
  accessToken: string;
  /** Book fee + FX even on invoices someone already marked paid by hand.
   *  Off by default: those fees may already have been booked by hand too. */
  bookFeesOnExternallyPaid?: boolean;
  /** COD vouchers: also book the courier's delivery / return charges. Off
   *  for a single-order Record, on for a full run or the charges' own button. */
  includeDelivery?: boolean;
};

/** The one charge the remitting bank took on the wire itself — not an order's. */
export type WirePublishResult = {
  /** Signed AED. Positive = the bank kept it (a loss). */
  amount: number;
  status: "booked" | "planned" | "found_existing" | "not_needed" | "review" | "failed";
  ok: boolean;
  journalId?: string | null;
  reference?: string;
  message?: string;
};

export type DeliveryPublishResult = {
  amount: number;
  count: number;
  status: "booked" | "planned" | "found_existing" | "review" | "failed";
  ok: boolean;
  expenseId?: string | null;
  reference?: string;
  message?: string;
};

export type PublishOutcome = { results: OrderPublishResult[]; wire: WirePublishResult; delivery?: DeliveryPublishResult };

export async function publishSettlements(opts: PublishOptions): Promise<PublishOutcome> {
  const results: OrderPublishResult[] = [];
  for (const s of opts.settlements) {
    results.push(await publishOne(s, opts));
  }
  const delivery = opts.includeDelivery ? await publishDeliveryCharges(opts) : undefined;
  // A delivery-charges-only run (no orders) leaves the wire journal alone.
  const wire: WirePublishResult = opts.settlements.length === 0 && opts.includeDelivery
    ? { amount: 0, status: "not_needed", ok: true }
    : await publishWireResidual(opts);
  return { results, wire, ...(delivery ? { delivery } : {}) };
}

/**
 * A COD courier's delivery / return charges on one voucher — money it kept
 * that closes no invoice (the order was prepaid through a gateway, or came
 * back). One VAT-inclusive expense out of the clearing account the whole
 * remittance lands in; with it, clearing nets to what the bank received.
 * Idempotent on its reference, like the wire charge.
 */
export async function publishDeliveryCharges(opts: PublishOptions): Promise<DeliveryPublishResult | undefined> {
  const { line, accounts, dryRun, accessToken } = opts;
  const charges = line.payout?.deliveryCharges ?? [];
  if (charges.length === 0) return undefined;
  const total = Math.round(charges.reduce((s, c) => s + c.amount, 0) * 100) / 100;
  const reference = `${(opts.referenceOverride || line.reference || line.id).trim()}/DLV`.slice(0, 100);
  const base = { amount: total, count: charges.length, reference };
  if (!accounts.deliveryAccountId) {
    return { ...base, status: "review", ok: false, message: `Pick the account for ${line.provider} delivery charges (AED ${total.toFixed(2)}) first.` };
  }
  if (!accounts.depositAccountId) {
    return { ...base, status: "review", ok: false, message: "Pick the Deposit To (clearing) account first." };
  }
  const returns = charges.filter((c) => c.isReturn);
  const refs = charges.filter((c) => !c.isReturn).map((c) => c.ref);
  const description =
    `${line.provider} delivery charges · voucher ${line.payout?.id ?? ""} · ${charges.length} × AED ${total.toFixed(2)}` +
    (refs.length ? ` · deliveries: ${refs.join(", ")}` : "") +
    (returns.length ? ` · returns: ${returns.map((c) => c.ref).join(", ")}` : "");
  try {
    const existing = await findDocumentByReference("expenses", reference, accessToken);
    if (existing) return { ...base, status: "found_existing", ok: true, expenseId: existing };
    if (dryRun) return { ...base, status: "planned", ok: true };
    const date = (line.date ?? new Date().toISOString()).slice(0, 10);
    const expenseId = await createExpense(
      buildDeliveryChargesExpenseBody({ total, accounts, date, reference, description }),
      accessToken,
    );
    return { ...base, status: "booked", ok: true, expenseId };
  } catch (e) {
    const { message, uncertain } = describe(e);
    return {
      ...base, status: "failed", ok: false,
      message: uncertain ? `${message} — Zoho may not have answered; retrying is safe, it looks the expense up by reference first.` : message,
    };
  }
}

/**
 * Books the bank's own cut on a cross-border wire, once for the whole credit.
 *
 * Each order's figures stay exactly as the payout file states them at the
 * bank's quoted rate, so their exchange differences are the real gap between
 * the invoice and the settlement — nothing smeared. What the bank kept between
 * quoting and crediting is a separate, payout-level charge, and booking it here
 * is what finally empties the clearing account to zero.
 *
 * Idempotent on its reference: one wire charge per bank credit, so finding it
 * in Zoho before writing is enough — a retry reuses it rather than doubling it.
 */
async function publishWireResidual(opts: PublishOptions): Promise<WirePublishResult> {
  const { line, accounts, dryRun, accessToken } = opts;
  const residual = planWireResidual({
    crossBorder: isCrossBorderCurrency(line.payout?.currency),
    bankAmount: line.bankAmount,
    payoutNet: line.payout?.net ?? 0,
    sharesAtBankRate: line.payout?.fxSource === "bank",
  });
  if (!residual.needed) return { amount: residual.amount, status: "not_needed", ok: true };

  const reference = wireResidualReference(
    (opts.referenceOverride || line.reference || line.id).trim(),
  );
  // A force-booked credit names its own account for the gap (bank charges,
  // gateway fees, write-off…) — that choice wins over the FX account.
  const force = line.forceBook;
  const residualAccountId = force?.accountId || accounts.differenceAccountId;
  if (!residualAccountId) {
    return {
      amount: residual.amount, status: "review", ok: false, reference,
      message: `The bank kept AED ${Math.abs(residual.amount).toFixed(2)} on this ${line.provider} credit — pick the Exchange Gain or Loss account so it can be booked.`,
    };
  }

  const date = (line.date ?? new Date().toISOString()).slice(0, 10);
  // An AED payout has no quoted rate to cite, so don't claim one — the journal
  // narration is what an accountant reads to tell a wire charge from an
  // exchange movement.
  const crossBorder = isCrossBorderCurrency(line.payout?.currency);
  const description =
    `${line.provider} ${crossBorder ? `${line.payout?.currency} wire charge` : "settlement difference"} · ` +
    `payout ${line.payout?.net.toFixed(2)}${crossBorder ? " at the bank's quoted rate" : ""}, ` +
    `AED ${line.bankAmount.toFixed(2)} credited · ` +
    `${residual.amount > 0 ? "loss" : "gain"} AED ${Math.abs(residual.amount).toFixed(2)}` +
    (force ? ` · force-booked by ${force.by}: ${force.note}` : "");

  try {
    const existing = await findDocumentByReference("journals", reference, accessToken);
    if (existing) {
      return { amount: residual.amount, status: "found_existing", ok: true, journalId: existing, reference };
    }
    if (dryRun) return { amount: residual.amount, status: "planned", ok: true, reference };

    const journalId = await createJournal(
      buildResidualJournalBody({ amount: residual.amount, accounts: { ...accounts, differenceAccountId: residualAccountId }, date, reference, description }),
      accessToken,
    );
    return { amount: residual.amount, status: "booked", ok: true, journalId, reference };
  } catch (e) {
    const { message, uncertain } = describe(e);
    return {
      amount: residual.amount, status: "failed", ok: false, reference,
      message: uncertain
        ? `${message} — Zoho may not have answered; retrying is safe, it looks the journal up by reference first.`
        : message,
    };
  }
}

async function publishOne(s: SettlementRecord, opts: PublishOptions): Promise<OrderPublishResult> {
  const { line, accounts, dryRun, accessToken } = opts;
  const base = { settlementId: s.id, orderNumber: s.order_number };
  const crossBorder = isCrossBorderCurrency(line.payout?.currency);
  // The payout's currency and the order's are different questions: an AED
  // Telr payout carries SAR orders the gateway converted at its own rate.
  // crossBorder still drives VAT and bankScale; this drives the difference.
  const orderCurrency = s.order_currency ?? null;
  const fxOrder = isFxOrder({ crossBorder, orderCurrency });
  const gateway = s.gateway || line.provider;
  const date = (s.settlement_date ?? line.date ?? new Date().toISOString()).slice(0, 10);
  const baseReference = (opts.referenceOverride || s.bank_reference || line.reference || line.id).trim();
  const refs = postingReferences(baseReference, s.order_number);

  const tx = transactionFor(line, s.order_number);
  if (!tx) {
    return { ...base, status: "review", ok: false, message: "The payout file has no per-order fee/net figures for this order, so the fee can't be split out." };
  }

  const leased = dryRun ? true : await SettlementsRepository.leaseForPosting(s.id);
  if (!leased) {
    return { ...base, status: "busy", ok: false, message: "Another publish is already working on this order — wait a minute and refresh." };
  }

  const steps = { payment: "skipped" as StepOutcome, fee: "skipped" as StepOutcome, difference: "skipped" as StepOutcome };
  let paymentId = isUnsettledZohoId(s.zoho_payment_id) || s.zoho_payment_id?.startsWith("EXTERNAL:") ? null : s.zoho_payment_id;
  let feeExpenseId = isUnsettledZohoId(s.zoho_fee_expense_id) ? null : s.zoho_fee_expense_id ?? null;
  let fxJournalId = isUnsettledZohoId(s.zoho_fx_journal_id) ? null : s.zoho_fx_journal_id ?? null;
  let invoiceNumber: string | undefined;
  const notes: string[] = [];

  const save = async (patch: Parameters<typeof SettlementsRepository.updatePosting>[1]) => {
    if (!dryRun) await SettlementsRepository.updatePosting(s.id, patch);
  };

  try {
    const bankScale = bankScaleFor({
      crossBorder, bankAmount: line.bankAmount, payoutNet: line.payout?.net ?? 0,
      sharesAtBankRate: line.payout?.fxSource === "bank",
    });
    let plan: OrderPostingPlan;

    // ── 1. customer payment ──────────────────────────────────────────────
    // Always read the invoice from Zoho, even when our table says it's paid:
    // a payment can be deleted in Zoho after we recorded its id (order 805050
    // kept a stale id and showed "booked" while its invoice sat overdue).
    let candidates;
    try {
      candidates = await findZohoInvoiceCandidates(s.order_number, accessToken, process.env.ZOHO_ORGANIZATION_ID!);
    } catch (e) {
      throw new ZohoRejection((e as Error).message); // a read — nothing written
    }
    // Founder's force allocation: the invoice(s) and amounts were chosen by
    // hand, so skip the automatic pick — but re-validate against what Zoho
    // says NOW (an invoice can be voided or paid since it was chosen).
    const forced = s.force_allocations?.length ? s.force_allocations : null;
    let picked: ReturnType<typeof pickInvoiceForOrder>;
    if (forced) {
      const byId = new Map(candidates.map((c) => [c.invoice_id, c]));
      const gone = forced.find((a) => {
        const c = byId.get(a.invoice_id);
        return !c || ["void", "draft"].includes(String(c.status).toLowerCase());
      });
      const customers = new Set(forced.map((a) => byId.get(a.invoice_id)?.customer_id));
      picked = gone
        ? { error: `Invoice ${gone.invoice_number} chosen for this order is void, draft or deleted in Zoho now — choose again (Force book).` }
        : customers.size > 1
          ? { error: `The chosen invoices belong to different Zoho customers — one payment can't close them. Choose invoices of one customer.` }
          : { invoice: byId.get(forced[0].invoice_id)! };
    } else {
      picked = pickInvoiceForOrder(candidates, {
        orderNumber: s.order_number,
        expectedAmount: tx.grossShare * bankScale,
        crossBorder,
        orderCurrency,
        preferredInvoiceId: s.zoho_invoice_id,
      });
    }
    if (!picked.invoice) {
      await save({ zoho_post_error: picked.error });
      return { ...base, status: "review", ok: false, message: picked.error };
    }
    const invoice = candidates.find((c) => c.invoice_id === picked.invoice.invoice_id)!;
    invoiceNumber = invoice.invoice_number;
    const balance = Number(invoice.balance ?? 0);
    const total = Number(invoice.total ?? 0);
    // Keep what Zoho just told us, so the proof panel can render this order's
    // invoice amount and exchange difference without searching Zoho again.
    await save({
      zoho_invoice_number: invoice.invoice_number,
      zoho_invoice_status: String(invoice.status ?? ""),
      zoho_invoice_balance: balance,
      zoho_invoice_total: total,
      zoho_invoice_checked_at: new Date().toISOString(),
    });
    const touched = balance < total - ROUNDING_TOLERANCE_AED;
    const paidOff = balance <= ROUNDING_TOLERANCE_AED;
    const storedExternal = s.zoho_payment_id?.startsWith("EXTERNAL:") ?? false;

    let staleNote: string | null = null;
    if (paymentId && !touched) {
      // We hold a payment id but nothing is applied to the invoice — the
      // payment no longer exists in Zoho. Book it again.
      staleNote = `saved payment ${paymentId} no longer exists in Zoho — re-posted`;
      paymentId = null;
      await save({ zoho_payment_id: null, zoho_published_at: null });
    }
    if (storedExternal && s.fee_aed != null && paidOff) {
      // An earlier run already chose to book fees on a hand-recorded payment.
      paymentId = s.zoho_payment_id;
    }

    const freshPlan = (invoiceAmount: number) =>
      planOrderPosting({
        invoiceBalance: invoiceAmount, grossAed: tx.grossShare, feeAed: tx.feeShare, feeVatAed: tx.vatShare, netAed: tx.netShare,
        bankScale, crossBorder, orderCurrency, feeVatInclusive: !!accounts.vatTaxId, forced: !!forced,
      });
    const forcedTotal = forced ? Math.round(forced.reduce((sum, a) => sum + Number(a.amount), 0) * 100) / 100 : 0;
    const storedPlan = (): OrderPostingPlan => {
      const fee = Number(s.fee_aed);
      const vat = Number(s.fee_vat_aed ?? 0);
      const difference = Number(s.fx_difference_aed ?? 0);
      return {
        paymentAmount: total, fee, feeVat: vat, feeExVat: +(fee - vat).toFixed(2),
        netReceived: +(tx.netShare * bankScale).toFixed(2), difference,
        differenceKind: Math.abs(difference) < ROUNDING_TOLERANCE_AED ? "none" : fxOrder ? "fx" : "rounding",
        review: null,
      };
    };

    if (forced) {
      if (paymentId) {
        steps.payment = "already_done";
        plan = s.fee_aed != null ? { ...storedPlan(), paymentAmount: forcedTotal } : freshPlan(forcedTotal);
      } else {
        // Each allocation must still fit what its invoice owes right now.
        const over = forced.find((a) => {
          const c = candidates.find((x) => x.invoice_id === a.invoice_id)!;
          return Number(a.amount) > Number(c.balance ?? 0) + ROUNDING_TOLERANCE_AED;
        });
        if (over) {
          const c = candidates.find((x) => x.invoice_id === over.invoice_id)!;
          const msg = `Invoice ${over.invoice_number} has only AED ${Number(c.balance ?? 0).toFixed(2)} open, but AED ${Number(over.amount).toFixed(2)} was allocated — adjust it (Force book).`;
          await save({ zoho_post_error: msg });
          return { ...base, invoiceNumber, status: "review", ok: false, message: msg };
        }
        plan = freshPlan(forcedTotal);
      }
      invoiceNumber = forced.map((a) => a.invoice_number).join(" + ");
    } else if (paymentId) {
      // Verified: something is applied to the invoice and it's ours. Reuse the
      // figures already booked so a half-finished order can't drift.
      steps.payment = "already_done";
      plan = s.fee_aed != null ? storedPlan() : freshPlan(total);
    } else if (touched) {
      // Something was already paid against this invoice. Only continue if
      // that something is ours (an earlier attempt that lost its reply).
      const ours = await findOurPaymentOnInvoice({
        customerId: invoice.customer_id,
        invoiceNumber: invoice.invoice_number,
        references: [refs.payment, s.bank_reference],
        accessToken,
      });
      if (!ours && paidOff && opts.bookFeesOnExternallyPaid) {
        // Someone recorded the payment by hand but (per the user) never the
        // fee — leave their payment alone and book only fee + FX.
        paymentId = `EXTERNAL:${invoice.invoice_id}`;
        steps.payment = "found_existing";
      } else if (!ours) {
        if (paidOff) await save({ zoho_payment_id: `EXTERNAL:${invoice.invoice_id}`, zoho_invoice_id: invoice.invoice_id, zoho_post_error: null });
        return {
          ...base, invoiceNumber, ok: paidOff,
          status: paidOff ? "paid_external" : "review",
          message: paidOff
            ? `Invoice ${invoice.invoice_number} was already marked paid in Zoho (not by this flow) — fee and FX not booked, to avoid booking them twice. Tick "Also book fees on invoices already paid by hand" if they were never booked.`
            : `Invoice ${invoice.invoice_number} already has AED ${(total - balance).toFixed(2)} paid against it outside this flow — book this order by hand.`,
        };
      } else {
        paymentId = ours;
        steps.payment = "found_existing";
      }
      plan = s.fee_aed != null ? storedPlan() : freshPlan(total);
    } else {
      plan = freshPlan(balance);
    }

    if (plan.review) {
      await save({ zoho_post_error: plan.review });
      return { ...base, invoiceNumber, status: "review", ok: false, message: plan.review, plan };
    }
    {
      const missingEarly = missingAccounts(plan, accounts);
      if (missingEarly) return { ...base, invoiceNumber, status: "review", ok: false, message: missingEarly, plan };
    }

    if (!paymentId) {
      if (dryRun) {
        steps.payment = "would_post";
      } else {
        const attempt = `PENDING:${crypto.randomUUID()}`;
        await save({
          zoho_payment_id: attempt, zoho_invoice_id: invoice.invoice_id,
          fee_aed: plan.fee, fee_vat_aed: plan.feeVat, fx_difference_aed: plan.difference,
          zoho_post_error: null,
        });
        try {
          paymentId = await createCustomerPayment(
            buildCustomerPaymentBody({
              customerName: invoice.customer_name,
              invoiceReferenceNumber: s.order_number,
              amount: plan.paymentAmount,
              amountApplied: plan.paymentAmount,
              balance,
              gateway,
              bankReference: s.bank_reference,
              referenceNumberOverride: refs.payment,
              date,
              accountId: accounts.depositAccountId,
              description: `${gateway} settlement · order ${s.order_number}${line.payout ? ` · payout ${line.payout.id}` : ""}` +
                (forced ? ` · force-booked to ${invoiceNumber}${s.force_note ? `: ${s.force_note}` : ""}` : ""),
              customerId: invoice.customer_id,
              invoiceId: invoice.invoice_id,
              ...(forced ? { allocations: forced.map((a) => ({ invoiceId: a.invoice_id, amount: Number(a.amount) })) } : {}),
            } as Parameters<typeof buildCustomerPaymentBody>[0]),
            accessToken,
          );
        } catch (e) {
          if (e instanceof ZohoRejection) await save({ zoho_payment_id: null });
          throw e;
        }
        await save({ zoho_payment_id: paymentId, zoho_published_at: new Date().toISOString() });
        steps.payment = "posted";
      }
    } else {
      await save({
        zoho_payment_id: paymentId, zoho_invoice_id: invoice.invoice_id,
        fee_aed: plan.fee, fee_vat_aed: plan.feeVat, fx_difference_aed: plan.difference,
      });
    }
    if (staleNote) notes.push(staleNote);

    const missing = missingAccounts(plan, accounts);
    if (missing) return { ...base, invoiceNumber, status: "review", ok: false, message: missing, plan, paymentId };

    // ── 2. gateway fee (VAT-inclusive on AED) ────────────────────────────
    if (plan.fee < ROUNDING_TOLERANCE_AED) {
      steps.fee = "not_needed";
    } else if (feeExpenseId) {
      steps.fee = "already_done";
    } else if (dryRun) {
      steps.fee = "would_post";
    } else {
      feeExpenseId = await writeOnce({
        pendingMarker: s.zoho_fee_expense_id,
        find: () => findDocumentByReference("expenses", refs.fee, accessToken),
        create: () =>
          createExpense(
            buildFeeExpenseBody({
              plan, accounts, date, reference: refs.fee,
              description:
                `${gateway} fee · order ${s.order_number}` +
                (plan.feeVat > 0
                  ? tx.vatShare
                    ? ` · fee ${plan.feeExVat.toFixed(2)} + VAT ${plan.feeVat.toFixed(2)}`
                    : ` · VAT-inclusive (VAT ${plan.feeVat.toFixed(2)})`
                  : crossBorder ? ` · ${line.payout?.currency} payout, no VAT` : ""),
            }),
            accessToken,
          ),
        mark: (v) => save({ zoho_fee_expense_id: v }),
        onStep: (o) => (steps.fee = o),
      });
    }

    // ── 3. exchange-rate / rounding difference ──────────────────────────
    if (plan.differenceKind === "none") {
      steps.difference = "not_needed";
    } else if (fxJournalId) {
      steps.difference = "already_done";
    } else if (dryRun) {
      steps.difference = "would_post";
    } else {
      const label = plan.differenceKind === "fx"
        ? `${gateway} ${line.payout?.currency ?? ""} exchange difference at the bank's applied rate`
        : `${gateway} rounding difference`;
      fxJournalId = await writeOnce({
        pendingMarker: s.zoho_fx_journal_id,
        find: () => findDocumentByReference("journals", refs.difference, accessToken),
        create: () =>
          createJournal(
            buildDifferenceJournalBody({
              plan, accounts, date, reference: refs.difference,
              description: `${label} · order ${s.order_number} · ${plan.difference > 0 ? "loss" : "gain"} AED ${Math.abs(plan.difference).toFixed(2)}`,
            }),
            accessToken,
          ),
        mark: (v) => save({ zoho_fx_journal_id: v }),
        onStep: (o) => (steps.difference = o),
      });
    }

    await save({ zoho_post_error: null });
    return {
      ...base, invoiceNumber, plan, paymentId, feeExpenseId, fxJournalId, steps,
      status: dryRun ? "planned" : "booked", ok: true,
      ...(notes.length ? { message: notes.join("; ") } : {}),
    };
  } catch (e) {
    const { message, uncertain } = describe(e);
    await save({ zoho_post_error: message.slice(0, 1000) }).catch(() => {});
    return {
      ...base, invoiceNumber, paymentId, feeExpenseId, fxJournalId, steps,
      status: "failed", ok: false, uncertain,
      message: uncertain ? `${message} — Zoho may not have answered; retrying is safe, it checks Zoho before posting again.` : message,
    };
  } finally {
    if (!dryRun) await SettlementsRepository.releasePostingLease(s.id).catch(() => {});
  }
}

function missingAccounts(plan: OrderPostingPlan, accounts: PostingAccounts): string | null {
  if (!accounts.depositAccountId) return "Pick the Deposit To (clearing) account first.";
  if (plan.fee >= ROUNDING_TOLERANCE_AED && !accounts.feeAccountId) return "Pick the gateway charges account first.";
  if (plan.differenceKind !== "none" && !accounts.differenceAccountId) {
    return `This order has a ${plan.differenceKind === "fx" ? "exchange-rate" : "rounding"} difference of AED ${Math.abs(plan.difference).toFixed(2)} — pick the Exchange Gain or Loss account first.`;
  }
  return null;
}

/** One Zoho write guarded by a PENDING marker in its DB column. */
async function writeOnce(opts: {
  pendingMarker: string | null | undefined;
  find: () => Promise<string | null>;
  create: () => Promise<string>;
  mark: (value: string | null) => Promise<void>;
  onStep: (o: StepOutcome) => void;
}): Promise<string> {
  if (opts.pendingMarker?.startsWith("PENDING:")) {
    const existing = await opts.find();
    if (existing) {
      await opts.mark(existing);
      opts.onStep("found_existing");
      return existing;
    }
  }
  await opts.mark(`PENDING:${crypto.randomUUID()}`);
  let id: string;
  try {
    id = await opts.create();
  } catch (e) {
    if (e instanceof ZohoRejection) await opts.mark(null);
    opts.onStep("failed");
    throw e;
  }
  await opts.mark(id);
  opts.onStep("posted");
  return id;
}
