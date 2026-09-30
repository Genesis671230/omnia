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
  fetchDocument,
  zohoDocumentExists,
  ZohoRejection,
  ZOHO_ACCOUNT_TYPE_NOT_APPLICABLE,
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
  buildIntercompanyDeliveryJournalBody,
  buildDeliveryChargesJournalBody,
  deliveryReferences,
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
import { zohoConnectionId, zohoOrgId } from "@/lib/integrations/zoho-context";
import { getAccessToken } from "@/lib/integrations/zoho";
import { withZohoOrg } from "@/lib/integrations/zoho-org";
import { deliveryLineDescription, type DeliveryEntityGroup } from "@/lib/finance/delivery-entities";
import { loadDeliveryEntities, recordDeliveryPosting } from "@/lib/finance/delivery-entities.server";

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

const r2 = (n: number) => Math.round(n * 100) / 100;

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
  /** COD vouchers: accounts for charges that belong to a sister company. */
  deliveryIntercompany?: DeliveryIntercompanyAccounts;
};

/** Per sister company (keyed by its Zoho connection id): the accounts that
 *  carry a charge the voucher company paid on its behalf. */
export type DeliveryIntercompanyAccounts = Record<string, {
  /** In the VOUCHER company's books: "Due from <sister>". */
  dueFromAccountId: string;
  /** In the SISTER company's books: its delivery charges expense. */
  expenseAccountId: string;
  /** In the SISTER company's books: "Due to <voucher company>". */
  dueToAccountId: string;
  /** The sister company's own VAT tax id (tax ids differ per org). */
  vatTaxId?: string | null;
  /** The sister company's Input VAT account — used when its side has to book
   *  as a journal (Zoho code 11016) and VAT is claimed. */
  inputVatAccountId?: string | null;
}>;

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

type DeliveryDocStatus = "booked" | "planned" | "found_existing" | "review" | "failed";

/** One Zoho document the charges book as. */
export type DeliveryLegResult = {
  leg: "own" | "ic-voucher" | "ic-counterpart";
  /** Zoho connection the document lives in. */
  org: string;
  kind: "expense" | "journal";
  amount: number;
  /** Order numbers on it, one line each. */
  refs: string[];
  status: DeliveryDocStatus;
  ok: boolean;
  id?: string | null;
  reference: string;
  message?: string;
};

export type DeliveryPublishResult = {
  amount: number;
  count: number;
  /** Worst leg wins: failed > review > planned > booked > found_existing. */
  status: DeliveryDocStatus;
  ok: boolean;
  legs: DeliveryLegResult[];
  /** Companies the charges belong to, voucher company first. */
  groups: { entity: string; own: boolean; count: number; total: number }[];
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
 * that closes no invoice. The voucher was remitted to ONE company (the org
 * this request runs in), but each charge belongs to the company that owns the
 * order (lib/finance/delivery-entities.ts):
 *
 *   own charges      one itemized expense in the voucher company, a line per
 *                    order, paid out of clearing                 — ref /DLV
 *   a sister's       its remittance paid them on the sister's behalf:
 *   charges            voucher company: journal Dr Due from <sister> (a line
 *                      per order) / Cr clearing
 *                      sister company: itemized expense, a line per order,
 *                      paid through Due to <voucher company>  — ref /DLV-IC-<org>
 *
 * With every leg booked, clearing nets to what the bank received and the two
 * intercompany accounts mirror each other. Every document is idempotent on
 * its reference, so a retry after a partial failure only books what's missing.
 */
export async function publishDeliveryCharges(opts: PublishOptions): Promise<DeliveryPublishResult | undefined> {
  const { line, accounts, dryRun, accessToken } = opts;
  const charges = line.payout?.deliveryCharges ?? [];
  if (charges.length === 0 || !line.payout) return undefined;
  const payoutId = line.payout.id;

  const state = await loadDeliveryEntities(payoutId);
  if (!state) return undefined;
  const voucherOrg = zohoConnectionId();
  const total = r2(charges.reduce((s, c) => s + c.amount, 0));
  const summary = {
    amount: total,
    count: charges.length,
    groups: state.groups.map((g) => ({ entity: g.entity, own: g.own, count: g.charges.length, total: g.total })),
  };
  if (state.voucherOrg !== voucherOrg) {
    return { ...summary, status: "review", ok: false, legs: [], message: "This payout's organisation changed — reopen the drawer and book again." };
  }
  if (!accounts.depositAccountId) {
    return { ...summary, status: "review", ok: false, legs: [], message: "Pick the Deposit To (clearing) account first." };
  }

  const base = (opts.referenceOverride || line.reference || line.id).trim();
  const date = (line.date ?? new Date().toISOString()).slice(0, 10);
  const label = (id: string) => state.orgs.find((o) => o.id === id)?.label ?? id;
  const linesOf = (g: DeliveryEntityGroup) => g.charges.map((c) => ({ description: deliveryLineDescription(c, line.provider), amount: c.amount }));
  const refsOf = (g: DeliveryEntityGroup) => g.charges.map((c) => c.ref);
  const note = (g: DeliveryEntityGroup, extra: string) =>
    `${line.provider} voucher ${line.payout?.id ?? ""} · ${g.charges.length} × delivery/return charges AED ${g.total.toFixed(2)} · ${extra}`;

  // Before this split existed, a voucher's charges were booked as ONE expense
  // under /DLV in the voucher company — including the sister company's.
  // Booking the sister legs on top would count those charges twice.
  const own = state.groups.find((g) => g.own);
  const sisters = state.groups.filter((g) => !g.own);
  const legacy = sisters.length > 0 ? await legacyWholeVoucherExpense(deliveryReferences(base), total, own?.total ?? 0, accessToken) : null;

  const legs: DeliveryLegResult[] = [];

  if (own) {
    const reference = deliveryReferences(base);
    const expenseAccountId = accounts.deliveryAccountId;
    legs.push(await bookDeliveryDoc({
      leg: "own", org: voucherOrg, kind: "expense", amount: own.total, refs: refsOf(own), reference, dryRun, payoutId, accessToken,
      missing: legacy ? null
        : !expenseAccountId ? `Pick the delivery charges account for ${label(voucherOrg)}'s ${own.charges.length} charge(s) (AED ${own.total.toFixed(2)}).`
        : null,
      found: legacy ? { id: legacy, message: "Booked earlier as one expense for the whole voucher." } : undefined,
      body: () => buildDeliveryChargesExpenseBody({
        lines: linesOf(own), expenseAccountId: expenseAccountId as string, paidThroughAccountId: accounts.depositAccountId,
        vatTaxId: accounts.vatTaxId, date, reference, description: note(own, `paid from ${line.provider} clearing`),
      }),
    }));
  }

  for (const g of sisters) {
    const reference = deliveryReferences(base, g.entity);
    const ic = opts.deliveryIntercompany?.[g.entity];
    if (legacy) {
      const message = `All of this voucher's charges, including ${label(g.entity)}'s AED ${g.total.toFixed(2)}, were already booked in ${label(voucherOrg)} as one expense (${legacy}). ` +
        `To move them to ${label(g.entity)}, delete that expense in Zoho and book again.`;
      legs.push({ leg: "ic-counterpart", org: g.entity, kind: "expense", amount: g.total, refs: refsOf(g), status: "review", ok: false, reference, message });
      continue;
    }
    const missing = !ic?.dueFromAccountId ? `Pick ${label(voucherOrg)}'s "Due from ${label(g.entity)}" account.`
      : !ic.expenseAccountId ? `Pick ${label(g.entity)}'s delivery charges account.`
      : !ic.dueToAccountId ? `Pick ${label(g.entity)}'s "Due to ${label(voucherOrg)}" account.`
      : null;

    // The sister company's expense first: its books and credentials are the
    // likelier to refuse, and the voucher side must not stand alone.
    let counterpart: DeliveryLegResult;
    try {
      counterpart = await withZohoOrg(g.entity, async () => bookDeliveryDoc({
        leg: "ic-counterpart", org: g.entity, kind: "expense", amount: g.total, refs: refsOf(g), reference, dryRun, payoutId,
        accessToken: missing ? "" : await getAccessToken(),
        missing,
        body: () => buildDeliveryChargesExpenseBody({
          lines: linesOf(g), expenseAccountId: ic!.expenseAccountId, paidThroughAccountId: ic!.dueToAccountId,
          vatTaxId: ic!.vatTaxId, date, reference, description: note(g, `paid for us by ${label(voucherOrg)} out of its remittance`),
        }),
        asJournal: () => ic!.vatTaxId && !ic!.inputVatAccountId
          ? `Zoho won't use that "Due to ${label(voucherOrg)}" account for an expense, and ${label(g.entity)} has no Input VAT account to book the journal's VAT to. Pick a liability account, or book with No VAT.`
          : buildDeliveryChargesJournalBody({
            lines: g.charges.map((c) => ({ description: deliveryLineDescription(c, line.provider), amount: c.amount, exVat: c.exVat, vat: c.vat })),
            expenseAccountId: ic!.expenseAccountId, creditAccountId: ic!.dueToAccountId,
            inputVatAccountId: ic!.vatTaxId ? ic!.inputVatAccountId : null,
            date, reference, description: note(g, `paid for us by ${label(voucherOrg)} out of its remittance`),
          }),
      }));
    } catch (e) {
      counterpart = { leg: "ic-counterpart", org: g.entity, kind: "expense", amount: g.total, refs: refsOf(g), status: "failed", ok: false, reference, message: (e as Error).message };
    }
    legs.push(counterpart);

    const voucherSideBlocked = !counterpart.ok && counterpart.status !== "review";
    legs.push(await bookDeliveryDoc({
      leg: "ic-voucher", org: voucherOrg, kind: "journal", amount: g.total, refs: refsOf(g), reference, dryRun, payoutId, accessToken,
      missing: missing ?? (voucherSideBlocked ? `Waiting for ${label(g.entity)}'s expense — it wasn't booked.` : null),
      body: () => buildIntercompanyDeliveryJournalBody({
        lines: linesOf(g), dueFromAccountId: ic!.dueFromAccountId, clearingAccountId: accounts.depositAccountId,
        date, reference, description: note(g, `paid on behalf of ${label(g.entity)}`),
      }),
    }));
  }

  const rank: Record<DeliveryDocStatus, number> = { failed: 4, review: 3, planned: 2, booked: 1, found_existing: 0 };
  const worst = legs.reduce<DeliveryDocStatus>((w, l) => (rank[l.status] > rank[w] ? l.status : w), "found_existing");
  const firstProblem = legs.find((l) => !l.ok);
  return { ...summary, status: worst, ok: !firstProblem, legs, ...(firstProblem?.message ? { message: firstProblem.message } : {}) };
}


/** A /DLV expense that already covers the WHOLE voucher (booked before charges
 *  were split by company). Returns its id, or null when /DLV is absent or is
 *  just the voucher company's own share. */
async function legacyWholeVoucherExpense(reference: string, voucherTotal: number, ownTotal: number, accessToken: string): Promise<string | null> {
  const id = await findDocumentByReference("expenses", reference, accessToken);
  if (!id) return null;
  if (Math.abs(voucherTotal - ownTotal) < 0.01) return null;
  const doc = await fetchDocument("expenses", id, accessToken);
  const amount = Number(doc?.total ?? doc?.amount ?? NaN);
  return Math.abs(amount - voucherTotal) < 0.01 ? id : null;
}

/** Look up by reference → dry run or write → remember. One Zoho document. */
async function bookDeliveryDoc(a: {
  leg: DeliveryLegResult["leg"];
  org: string;
  kind: "expense" | "journal";
  amount: number;
  refs: string[];
  reference: string;
  dryRun: boolean;
  payoutId: string;
  accessToken: string;
  /** Set = can't book yet; says what to pick. */
  missing: string | null;
  /** Already booked under another reference (see legacyWholeVoucherExpense). */
  found?: { id: string; message: string };
  body: () => unknown;
  /** An expense Zoho refuses for its account types (code 11016) books as this
   *  journal instead — or, when it returns a string, stops with that message. */
  asJournal?: () => unknown | string;
}): Promise<DeliveryLegResult> {
  const out = { leg: a.leg, org: a.org, kind: a.kind, amount: a.amount, refs: a.refs, reference: a.reference };
  const remember = (kind: "expense" | "journal", id: string) =>
    recordDeliveryPosting(a.payoutId, { leg: a.leg, org: a.org, kind, id, reference: a.reference, amount: a.amount, refs: a.refs, at: new Date().toISOString() });
  if (a.found) {
    await remember(a.kind, a.found.id);
    return { ...out, status: "found_existing", ok: true, id: a.found.id, message: a.found.message };
  }
  if (a.missing) return { ...out, status: "review", ok: false, message: a.missing };
  try {
    // A retry must find the document whichever form an earlier run wrote.
    const kinds: ("expense" | "journal")[] = a.kind === "expense" && a.asJournal ? ["expense", "journal"] : [a.kind];
    for (const kind of kinds) {
      const existing = await findDocumentByReference(kind === "expense" ? "expenses" : "journals", a.reference, a.accessToken);
      if (existing) {
        await remember(kind, existing);
        return { ...out, kind, status: "found_existing", ok: true, id: existing };
      }
    }
    if (a.dryRun) return { ...out, status: "planned", ok: true };
    if (a.kind === "journal") {
      const id = await createJournal(a.body(), a.accessToken);
      await remember("journal", id);
      return { ...out, status: "booked", ok: true, id };
    }
    try {
      const id = await createExpense(a.body(), a.accessToken);
      await remember("expense", id);
      return { ...out, status: "booked", ok: true, id };
    } catch (e) {
      if (!(e instanceof ZohoRejection) || e.code !== ZOHO_ACCOUNT_TYPE_NOT_APPLICABLE || !a.asJournal) throw e;
      const journal = a.asJournal();
      if (typeof journal === "string") return { ...out, status: "review", ok: false, message: journal };
      const id = await createJournal(journal, a.accessToken);
      await remember("journal", id);
      return {
        ...out, kind: "journal", status: "booked", ok: true, id,
        message: "Zoho won't use that account as an expense's Paid Through, so this was booked as a journal with the same effect.",
      };
    }
  } catch (e) {
    const { message, uncertain } = describe(e);
    return {
      ...out, status: "failed", ok: false,
      message: uncertain ? `${message} — Zoho may not have answered; retrying is safe, it looks the document up by reference first.` : message,
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
      candidates = await findZohoInvoiceCandidates(s.order_number, accessToken, zohoOrgId());
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
    // A stored id is only a claim — the expense may have been deleted in Zoho
    // since. Check before trusting it; if it's gone, forget it and re-post.
    if (feeExpenseId && plan.fee >= ROUNDING_TOLERANCE_AED && !(await zohoDocumentExists("expenses", feeExpenseId, accessToken))) {
      notes.push(`Fee expense ${feeExpenseId} no longer exists in Zoho — re-posting it.`);
      feeExpenseId = null;
      await save({ zoho_fee_expense_id: null });
    }
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
    if (fxJournalId && plan.differenceKind !== "none" && !(await zohoDocumentExists("journals", fxJournalId, accessToken))) {
      notes.push(`Exchange journal ${fxJournalId} no longer exists in Zoho — re-posting it.`);
      fxJournalId = null;
      await save({ zoho_fx_journal_id: null });
    }
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
