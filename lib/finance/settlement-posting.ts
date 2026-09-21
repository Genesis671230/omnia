// How one settled order is booked in Zoho Books — pure math, no I/O.
//
// Every order on a gateway payout becomes up to three Zoho documents, all
// running through the gateway's clearing account (e.g. "TABBY AED"):
//
//   1. Customer Payment — the invoice's FULL balance, deposited into clearing.
//      The invoice closes Paid; it never sits on a fee-sized residual.
//   2. Expense          — everything the gateway deducted, paid through
//      clearing into the gateway-charges account.
//        AED (UAE) payout, posted VAT-inclusive so Zoho splits out input VAT:
//          Tabby  — "Total Deduction" already includes VAT: VAT = fee ÷ 105 × 5
//          Tamara — "Total Fees" excludes VAT; VAT is charged on top
//                   (Total Fees × 5%, its own column), so the expense is
//                   Total Fees + VAT and the VAT is exactly that column.
//        SAR / KWD payout: the whole deduction posts as cost, no VAT reclaim.
//   3. Journal          — whatever is left between the invoice and
//      (fee + AED actually received). On a cross-border payout that is the
//      exchange-rate difference between the invoice's AED and the rate the
//      bank really applied; it goes to Exchange Gain or Loss.
//
// After all three, clearing holds exactly the AED the bank credited for the
// order, so the payout's net transfer (clearing → bank) empties it to zero.

export const ROUNDING_TOLERANCE_AED = 0.01;
/** On an AED payout the invoice should equal the gateway's order amount. A
 *  gap up to the larger of AED 1 or 0.25% of the invoice is rounding (e.g.
 *  order 804671: invoice 1,792.57 vs Tabby 1,794.00) and is booked to the
 *  difference account; more means the figures disagree and a person looks. */
export const AED_DIFFERENCE_LIMIT_AED = 1;
export const AED_DIFFERENCE_LIMIT_PCT = 0.0025;
export const aedDifferenceLimit = (invoiceAmount: number) =>
  Math.max(AED_DIFFERENCE_LIMIT_AED, Math.abs(invoiceAmount) * AED_DIFFERENCE_LIMIT_PCT);
/** A cross-border FX difference larger than this share of the invoice is far
 *  beyond any real rate movement — almost always a wrong invoice match or a
 *  partial refund, so it is held for review rather than written off. */
export const FX_DIFFERENCE_LIMIT_PCT = 0.15;
export const UAE_VAT_RATE_PCT = 5;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** VAT inside a VAT-inclusive amount: amount ÷ (100 + rate) × rate. */
export function vatInclusiveSplit(amount: number, ratePct = UAE_VAT_RATE_PCT) {
  const vat = round2((amount * ratePct) / (100 + ratePct));
  return { vat, net: round2(amount - vat) };
}

/** A payout settled in anything other than AED crosses a currency border. */
export function isCrossBorderCurrency(currency: string | null | undefined): boolean {
  return !!currency && currency.toUpperCase() !== "AED";
}

/**
 * Whether this order's invoice and the gateway's figure for it were converted
 * at two different rates — the only question that decides whether a gap
 * between them is an exchange difference or a disagreement.
 *
 * Two separate things used to ride on `crossBorder` alone, and conflating them
 * is what held every foreign-currency order on an AED payout for review:
 *
 *   payout currency  — drives VAT reclaim and bankScale. No UAE input VAT is
 *                      reclaimable on a SAR/KWD settlement.
 *   ORDER currency   — drives this. An AED-denominated Telr or Stripe payout
 *                      still carries SAR and QAR orders, and the gateway
 *                      converts those at its own rate on its own date (Telr
 *                      settles SAR at 0.95900 where the rate table says 0.98).
 *                      That gap is an exchange difference, never a mismatch,
 *                      however the payout itself was denominated.
 */
export function isFxOrder(opts: {
  crossBorder: boolean;
  orderCurrency?: string | null;
}): boolean {
  return opts.crossBorder || isCrossBorderCurrency(opts.orderCurrency);
}

/**
 * The factor that turns the payout file's AED figures into what the bank
 * actually credited — used ONLY when the per-order shares are still at our
 * static FX estimate, because then the rate itself is what's wrong and
 * rescaling is the best truth available.
 *
 * When the bank quoted its own rate in the narration, the engine has already
 * restated every share at that authoritative rate, and the leftover is not a
 * rate at all: it is the flat charge the bank took on the wire. Scaling the
 * orders by it smeared one bank charge across every order — inflating each
 * order's exchange difference and pretending the gateway charged less than it
 * did. That leftover belongs to the payout, so it books once; see
 * planWireResidual(). AED-native payouts are never rescaled — a variance there
 * is not an exchange rate.
 */
export function bankScaleFor(opts: {
  crossBorder: boolean;
  bankAmount: number;
  payoutNet: number;
  /** The shares are already stated at the rate the bank itself quoted. */
  sharesAtBankRate?: boolean;
}): number {
  if (!opts.crossBorder || !opts.payoutNet || !opts.bankAmount) return 1;
  if (opts.sharesAtBankRate) return 1;
  return opts.bankAmount / opts.payoutNet;
}

/**
 * What the bank kept between what the payout was worth and what it credited:
 * the payout's AED net, less the AED that landed. Positive = a loss (the usual
 * inward-telex charge); negative = more landed than the payout implied.
 *
 * Books exactly when bankScaleFor() returned 1, i.e. when the gap was NOT
 * already spread across the orders — booking it twice would double-count it.
 * That is the single rule; it holds for both shapes:
 *
 *   cross-border, shares at the bank's quoted rate — the leftover is the flat
 *     wire charge, and it belongs to the payout, not to any one order.
 *   AED-native — never rescaled at all, because a variance on an AED payout is
 *     not an exchange rate. The gap is still a real cost the bank took, and it
 *     books once here rather than holding every invoice on the payout open.
 *
 * Cross-border payouts still at our static FX estimate are the one case that
 * does NOT book: there bankScaleFor() rescales the shares, so the gap is
 * already inside the per-order figures.
 */
export function planWireResidual(opts: {
  crossBorder: boolean;
  bankAmount: number;
  payoutNet: number;
  sharesAtBankRate: boolean;
}): { amount: number; needed: boolean } {
  if (!opts.payoutNet || !opts.bankAmount) return { amount: 0, needed: false };
  // The shares were rescaled to the bank credit, so the gap is already in them.
  if (opts.crossBorder && !opts.sharesAtBankRate) return { amount: 0, needed: false };
  const amount = round2(opts.payoutNet - opts.bankAmount);
  return { amount, needed: Math.abs(amount) >= ROUNDING_TOLERANCE_AED };
}

export type OrderPostingInput = {
  /** What is still owed on the Zoho invoice, AED. */
  invoiceBalance: number;
  /** The gateway's per-order figures from the payout file, AED. */
  grossAed: number;
  feeAed: number;
  netAed: number;
  /** VAT the gateway charged ON TOP of feeAed, when the file itemises it
   *  (Tamara). Omit/null when feeAed already includes VAT (Tabby). */
  feeVatAed?: number | null;
  /** From bankScaleFor(). */
  bankScale: number;
  /** Whether the PAYOUT is non-AED. Drives VAT reclaim and bankScale only. */
  crossBorder: boolean;
  /** The currency the customer was actually charged in, when it isn't the
   *  payout's. An AED payout full of SAR orders is the common case; see
   *  isFxOrder(). Absent/AED means the invoice and the gateway used one rate. */
  orderCurrency?: string | null;
  /** Whether the fee carries UAE VAT (a tax was chosen for an AED payout). */
  feeVatInclusive: boolean;
  vatRatePct?: number;
};

export type OrderPostingPlan = {
  paymentAmount: number;
  fee: number;
  feeVat: number;
  feeExVat: number;
  netReceived: number;
  /** invoice − fee − received. Positive: we received less (loss). */
  difference: number;
  differenceKind: "none" | "fx" | "rounding";
  /** Set when the order must not be booked automatically. */
  review: string | null;
};

export function planOrderPosting(input: OrderPostingInput): OrderPostingPlan {
  const paymentAmount = round2(input.invoiceBalance);
  const vatOnTop = input.feeVatAed != null && input.feeVatAed !== 0 ? Math.abs(input.feeVatAed) : null;
  // `fee` is the whole deduction — what leaves clearing for this order.
  const fee = round2((Math.abs(input.feeAed) + (vatOnTop ?? 0)) * input.bankScale);
  const netReceived = round2(input.netAed * input.bankScale);
  let vat = 0;
  if (input.feeVatInclusive && !input.crossBorder) {
    vat = vatOnTop != null ? round2(vatOnTop * input.bankScale) : vatInclusiveSplit(fee, input.vatRatePct).vat;
  }
  const net = round2(fee - vat);
  const difference = round2(paymentAmount - fee - netReceived);

  const plan: OrderPostingPlan = {
    paymentAmount,
    fee,
    feeVat: vat,
    feeExVat: net,
    netReceived,
    difference,
    differenceKind: "none",
    review: null,
  };

  if (paymentAmount <= ROUNDING_TOLERANCE_AED) {
    plan.review = "The Zoho invoice has no balance left to pay.";
    return plan;
  }
  if (netReceived <= 0) {
    plan.review = "The payout file shows nothing received for this order.";
    return plan;
  }
  if (Math.abs(difference) < ROUNDING_TOLERANCE_AED) return plan;

  // Note this asks isFxOrder, not input.crossBorder: the VAT split above is
  // keyed to the payout, this is keyed to the order.
  if (isFxOrder({ crossBorder: input.crossBorder, orderCurrency: input.orderCurrency })) {
    if (Math.abs(difference) > paymentAmount * FX_DIFFERENCE_LIMIT_PCT) {
      plan.review =
        `Exchange difference of AED ${Math.abs(difference).toFixed(2)} is over ` +
        `${FX_DIFFERENCE_LIMIT_PCT * 100}% of the AED ${paymentAmount.toFixed(2)} invoice — ` +
        `likely the wrong invoice or a partial refund. Check before booking.`;
      return plan;
    }
    plan.differenceKind = "fx";
    return plan;
  }

  if (Math.abs(difference) > aedDifferenceLimit(paymentAmount)) {
    plan.review =
      `Invoice balance AED ${paymentAmount.toFixed(2)} doesn't match the gateway's ` +
      `order amount AED ${round2(fee + netReceived).toFixed(2)} (off by ` +
      `AED ${Math.abs(difference).toFixed(2)}). Check the invoice before closing it.`;
    return plan;
  }
  plan.differenceKind = "rounding";
  return plan;
}

// ── Zoho document bodies ─────────────────────────────────────────────────────

export type PostingAccounts = {
  /** Clearing account the payment lands in and the fee is paid out of. */
  depositAccountId: string;
  feeAccountId: string;
  /** Required when the fee carries VAT. */
  vatTaxId?: string | null;
  /** Exchange Gain or Loss — required whenever there is a difference. */
  differenceAccountId?: string | null;
};

/** Stable per-order references, so a retry can find what an earlier attempt
 *  already wrote instead of writing it twice. */
export function postingReferences(baseReference: string, orderNumber: string) {
  const base = `${baseReference}/${orderNumber}`.slice(0, 90);
  return { payment: baseReference.slice(0, 100), fee: `${base}/FEE`, difference: `${base}/FX` };
}

/** The payout-level wire charge. One per bank credit, so looking this up in
 *  Zoho before writing is all the idempotency it needs. */
export function wireResidualReference(baseReference: string) {
  return `${baseReference.slice(0, 95)}/WIRE`;
}

export function buildFeeExpenseBody(opts: {
  plan: OrderPostingPlan;
  accounts: PostingAccounts;
  date: string;
  reference: string;
  description: string;
}) {
  const withVat = opts.plan.feeVat > 0 && !!opts.accounts.vatTaxId;
  return {
    account_id: opts.accounts.feeAccountId,
    paid_through_account_id: opts.accounts.depositAccountId,
    date: opts.date,
    amount: opts.plan.fee,
    reference_number: opts.reference,
    description: opts.description.slice(0, 500),
    // Same treatment the bank-charges flow already posts with in this org.
    tax_treatment: "vat_registered",
    place_of_supply: "DU",
    is_reverse_charge_applied: false,
    is_inclusive_tax: withVat,
    ...(withVat ? { tax_id: opts.accounts.vatTaxId as string } : {}),
  };
}

export function buildDifferenceJournalBody(opts: {
  plan: OrderPostingPlan;
  accounts: PostingAccounts;
  date: string;
  reference: string;
  description: string;
}) {
  return buildResidualJournalBody({ ...opts, amount: opts.plan.difference });
}

/** A two-line journal moving `amount` between clearing and the difference
 *  account. Positive = a loss (less money arrived than the invoice expected,
 *  or than the bank's own rate implied), so the difference account is debited
 *  and clearing credited; negative reverses both legs. */
export function buildResidualJournalBody(opts: {
  /** Signed AED. Positive = loss. */
  amount: number;
  accounts: PostingAccounts;
  date: string;
  reference: string;
  description: string;
}) {
  const amount = Math.abs(opts.amount);
  const loss = opts.amount > 0;
  const differenceAccount = opts.accounts.differenceAccountId as string;
  return {
    journal_date: opts.date,
    reference_number: opts.reference,
    notes: opts.description.slice(0, 500),
    line_items: [
      {
        account_id: loss ? differenceAccount : opts.accounts.depositAccountId,
        debit_or_credit: "debit",
        amount,
        description: opts.description.slice(0, 500),
      },
      {
        account_id: loss ? opts.accounts.depositAccountId : differenceAccount,
        debit_or_credit: "credit",
        amount,
        description: opts.description.slice(0, 500),
      },
    ],
  };
}

// ── default account suggestions ──────────────────────────────────────────────

type NamedAccount = { account_id: string; account_name: string; account_type?: string };
type NamedTax = { tax_id: string; tax_name: string; tax_percentage: number };

// How a currency shows up in this org's clearing-account names
// ("TABBY KSA", "TAMARA KWD", "Checkout - SAR", "TABBY QTR").
const CURRENCY_TOKENS: Record<string, RegExp> = {
  AED: /\b(aed|uae)\b/i,
  SAR: /\b(sar|ksa|saudi)\b/i,
  KWD: /\b(kwd|kuwait)\b/i,
  QAR: /\b(qar|qtr|qatar)\b/i,
  BHD: /\b(bhd|bahrain)\b/i,
  OMR: /\b(omr|oman)\b/i,
};

/** Best-guess accounts for a payout; every one is still a visible, editable
 *  choice in the UI. Returns "" where nothing sensible matches. */
export function suggestPostingAccounts(
  payout: { provider: string; currency: string | null },
  options: {
    depositAccounts: NamedAccount[];
    feeAccounts: NamedAccount[];
    differenceAccounts: NamedAccount[];
    taxes: NamedTax[];
  },
) {
  const provider = payout.provider.trim().toLowerCase();
  const currency = (payout.currency || "AED").toUpperCase();
  const token = CURRENCY_TOKENS[currency];
  const otherTokens = Object.entries(CURRENCY_TOKENS).filter(([c]) => c !== currency).map(([, re]) => re);

  const forProvider = options.depositAccounts.filter((a) => provider && a.account_name.toLowerCase().includes(provider));
  const deposit =
    forProvider.find((a) => token?.test(a.account_name)) ??
    (currency === "AED" ? forProvider.find((a) => !otherTokens.some((re) => re.test(a.account_name))) : undefined);

  const fee =
    options.feeAccounts.find((a) => /payment\s*gateway\s*charges?/i.test(a.account_name)) ??
    options.feeAccounts.find((a) => /gateway/i.test(a.account_name));

  const difference =
    options.differenceAccounts.find((a) => /^exchange\s+gain\s+or\s+loss$/i.test(a.account_name.trim())) ??
    options.differenceAccounts.find((a) => /exchange\s+gain|forex|fx\s+gain/i.test(a.account_name));

  const vat =
    options.taxes.find((t) => t.tax_percentage === UAE_VAT_RATE_PCT && /standard/i.test(t.tax_name)) ??
    options.taxes.find((t) => t.tax_percentage === UAE_VAT_RATE_PCT && /^vat/i.test(t.tax_name));

  return {
    depositAccountId: deposit?.account_id ?? "",
    feeAccountId: fee?.account_id ?? "",
    differenceAccountId: difference?.account_id ?? "",
    // Cross-border fees carry no UAE VAT.
    vatTaxId: isCrossBorderCurrency(payout.currency) ? "" : vat?.tax_id ?? "",
  };
}

// ── choosing the invoice when an order has several ───────────────────────────

export type InvoiceCandidate = {
  invoice_id: string;
  invoice_number: string;
  status: string;
  total: number;
  balance: number;
};

/**
 * Zoho sometimes holds more than one invoice for the same order number (a
 * re-issued invoice, an exchange). The gateway's own order amount says which
 * one this payout paid: on AED payouts it must match to the dirham; across a
 * border the invoice was converted at the order-day rate, so take the closest
 * one within the FX limit. An invoice this order was already booked against
 * always wins.
 */
export function pickInvoiceForOrder(
  candidates: InvoiceCandidate[],
  opts: {
    orderNumber: string;
    expectedAmount: number;
    crossBorder: boolean;
    /** See isFxOrder() — a SAR order on an AED payout needs the FX tolerance
     *  here too, or two live invoices and a 2% rate gap end in "none matches
     *  the gateway amount". */
    orderCurrency?: string | null;
    preferredInvoiceId?: string | null;
  },
): { invoice: InvoiceCandidate; error?: undefined } | { invoice?: undefined; error: string } {
  const live = candidates.filter((c) => !["void", "draft"].includes(String(c.status).toLowerCase()));
  if (live.length === 0) {
    return { error: candidates.length ? `Every Zoho invoice for order ${opts.orderNumber} is void or draft.` : `No Zoho invoice found for order ${opts.orderNumber} — run the invoice sync.` };
  }
  const preferred = opts.preferredInvoiceId && live.find((c) => c.invoice_id === opts.preferredInvoiceId);
  if (preferred) return { invoice: preferred };
  if (live.length === 1) return { invoice: live[0] };

  const expected = Math.abs(opts.expectedAmount);
  const tolerance = isFxOrder(opts)
    ? Math.max(AED_DIFFERENCE_LIMIT_AED, expected * FX_DIFFERENCE_LIMIT_PCT)
    : aedDifferenceLimit(expected);
  const gap = (c: InvoiceCandidate) => Math.abs(Number(c.total) - expected);
  const isOpen = (c: InvoiceCandidate) => Number(c.balance) > ROUNDING_TOLERANCE_AED;

  let matches = live.filter((c) => gap(c) <= tolerance).sort((a, b) => gap(a) - gap(b));
  if (matches.length > 1 && matches.some(isOpen)) matches = matches.filter(isOpen);
  if (matches.length > 1 && gap(matches[1]) - gap(matches[0]) > ROUNDING_TOLERANCE_AED) {
    matches = [matches[0]];
  }
  if (matches.length === 1) return { invoice: matches[0] };

  const list = live
    .map((c) => `${c.invoice_number} AED ${Number(c.total).toFixed(2)} (${c.status})`)
    .join(", ");
  return {
    error: matches.length === 0
      ? `Order ${opts.orderNumber} has ${live.length} Zoho invoices (${list}) and none matches the gateway amount AED ${expected.toFixed(2)} — fix the invoice in Zoho.`
      : `Order ${opts.orderNumber} has ${matches.length} Zoho invoices for the same AED ${expected.toFixed(2)} (${list}) — void the duplicate in Zoho.`,
  };
}

// ── refunds netted out of a payout ───────────────────────────────────────────

export function refundReferences(baseReference: string, orderNumber: string) {
  const base = `${baseReference}/${orderNumber}`.slice(0, 88);
  return { creditNote: `${base}/RFN`, refund: `${base}/RFD` };
}

/**
 * Credit note for a refund the gateway took back out of a payout. One
 * VAT-inclusive line for exactly the refunded amount (a partial refund can't
 * be traced to specific items from the statement), carrying the invoice's own
 * tax and sales account so output VAT reverses at the invoice's rate. No
 * item_id, so it does not restock inventory.
 */
export function buildRefundCreditNoteBody(opts: {
  invoice: {
    invoice_id: string; invoice_number: string; customer_id: string;
    tax_treatment?: string; place_of_supply?: string;
    line_items: { tax_id?: string; account_id?: string }[];
  };
  amount: number;
  date: string;
  reference: string;
  orderNumber: string;
  gateway: string;
}) {
  const taxed = opts.invoice.line_items.find((l) => l.tax_id) ?? opts.invoice.line_items[0] ?? {};
  const account = opts.invoice.line_items.find((l) => l.account_id)?.account_id;
  return {
    customer_id: opts.invoice.customer_id,
    date: opts.date,
    reference_number: opts.reference,
    invoice_id: opts.invoice.invoice_id,
    is_inclusive_tax: true,
    ...(opts.invoice.tax_treatment ? { tax_treatment: opts.invoice.tax_treatment } : {}),
    ...(opts.invoice.place_of_supply ? { place_of_supply: opts.invoice.place_of_supply } : {}),
    notes: `${opts.gateway} refund for order ${opts.orderNumber} (invoice ${opts.invoice.invoice_number}), deducted from the payout.`,
    line_items: [
      {
        name: `Refund · order ${opts.orderNumber}`,
        description: `${opts.gateway} refund against ${opts.invoice.invoice_number}`,
        quantity: 1,
        rate: round2(Math.abs(opts.amount)),
        ...(taxed.tax_id ? { tax_id: taxed.tax_id } : {}),
        ...(account ? { account_id: account } : {}),
      },
    ],
  };
}

export function buildCreditNoteRefundBody(opts: {
  amount: number; date: string; reference: string; fromAccountId: string; orderNumber: string; gateway: string;
}) {
  return {
    date: opts.date,
    refund_mode: "Bank Transfer",
    reference_number: opts.reference,
    amount: round2(Math.abs(opts.amount)),
    from_account_id: opts.fromAccountId,
    description: `${opts.gateway} refund for order ${opts.orderNumber}, netted from the payout`,
  };
}

/** Which invoice a refund reverses: among the order's invoices, the paid one
 *  big enough to cover it; an invoice already refunded against wins. */
export function pickInvoiceForRefund(
  candidates: InvoiceCandidate[],
  opts: { orderNumber: string; amount: number; preferredInvoiceId?: string | null },
): { invoice: InvoiceCandidate; error?: undefined } | { invoice?: undefined; error: string } {
  const live = candidates.filter((c) => !["void", "draft"].includes(String(c.status).toLowerCase()));
  const preferred = opts.preferredInvoiceId && live.find((c) => c.invoice_id === opts.preferredInvoiceId);
  if (preferred) return { invoice: preferred };
  if (live.length === 0) return { error: `No Zoho invoice found for refunded order ${opts.orderNumber}.` };
  const covering = live.filter((c) => Number(c.total) + ROUNDING_TOLERANCE_AED >= Math.abs(opts.amount));
  const paid = covering.filter((c) => Number(c.balance) <= ROUNDING_TOLERANCE_AED);
  if (paid.length === 1) return { invoice: paid[0] };
  if (paid.length === 0 && covering.length === 1) return { invoice: covering[0] };
  if (paid.length === 0 && covering.length === 0) {
    return { error: `Refund of AED ${Math.abs(opts.amount).toFixed(2)} is larger than every Zoho invoice for order ${opts.orderNumber}.` };
  }
  return {
    error: `Order ${opts.orderNumber} has ${(paid.length || covering.length)} invoices that could carry this refund (` +
      (paid.length ? paid : covering).map((c) => `${c.invoice_number} AED ${Number(c.total).toFixed(2)}`).join(", ") +
      `) — void the duplicate in Zoho.`,
  };
}
