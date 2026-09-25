// THE RECONCILER — bank → payout → orders. Bank is the only source of truth.
//
//   BANK CREDIT (truth)
//        ↓ must be explained by
//   PAYOUT FILE  (net ≈ bank amount, same provider)
//        ↓ resolves to
//   ORDER NUMBERS (must exist in orders table)
//        ↓ stamps
//   orders.payout_id + payout_status = 'settled'
//
// An order NEVER claims it settled itself. It waits to be claimed by a
// bank-confirmed payout. Anything a payout can't explain is an exception.

import type { CodDeliveryCharge } from "@/lib/parsers/ontrack-voucher";
import { supabase, selectAllPages } from "@/lib/supabase";
import { BankRepository } from "@/lib/repositories/bank.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";
import { FX_TO_AED } from "@/lib/fx";
import { stripeConfigured, payoutOrderRefs } from "@/lib/integrations/stripe";
import { saveReconSnapshot, markReconDirty } from "@/lib/reconciliation/snapshot";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";
const TOLERANCE_AED = 1.0;

export type ReconState = "AWAITING_PAYOUT" | "PAYOUT_VARIANCE" | "ORDERS_UNRESOLVED" | "SETTLED";

export type QualityIssue = { ref: string; quality: string };

export type ReconLine = {
  id: string; // bank line id
  date: string | null;
  narration: string;
  reference: string;
  provider: string;
  confidence: string;
  bankAmount: number;
  payout: {
    id: string; net: number; source: string | null;
    // Original-currency traceability (SAR/KWD Tabby & Tamara statements):
    // which rate turned the payout's original-currency total into the AED
    // `net` above, and whether it came from the bank's own quoted wire rate
    // (authoritative — read from the matched credit's narration) or our
    // static parse-time estimate (lib/fx.ts, used only when the narration
    // doesn't quote one).
    currency: string | null;
    fxRate: number | null;
    fxSource: "bank" | "estimate" | null;
    /** COD courier vouchers: charges that belong to no invoice. */
    deliveryCharges?: CodDeliveryCharge[];
  } | null;
  variance: number;
  resolvedOrders: string[];
  unresolvedRefs: string[];
  // refs that ARE a real order but reverse money rather than settle it — kept
  // out of resolvedOrders so a refund can't be mistaken for a settled sale.
  refundedOrders: string[];
  // blank/unparseable/multi/note Stripe descriptions, for manual review —
  // informational only, never changes `state`.
  qualityIssues: QualityIssue[];
  // Per-order proof, rescaled so it always foots to `payout.net` above. Empty
  // when the payout's parser produced no per-order breakdown (Telr, generic).
  transactions: ReconTransactionShare[];
  // How much of the AED figure moved because the bank's real wire rate differs
  // from the static parse-time estimate — an artifact of OUR conversion, not
  // money the gateway charged. null when no FX was involved.
  rateDriftAed: number | null;
  // The gateway's own cost of converting to AED on a cross-border settlement:
  // gross (at the same authoritative rate) minus the net that actually landed.
  // null when the payout is AED-native.
  fxFeeAed: number | null;
  state: ReconState;
  confirmedBy: string | null;
  confirmedAt: string | null;
  // Founder-raised "needs a look", independent of state: a credit whose math
  // foots can still be wrong (an amount that looks off, a gateway to chase).
  // Never set by matching — only by a person, via POST /api/reconcile/flag.
  reviewFlag: boolean;
  reviewNote: string;
  /** A founder's override on a variance too large to book automatically:
   *  the orders close in full and the gap books once to `accountId`. */
  forceBook: ForceBook | null;
};

export type ForceBook = { by: string; at: string; note: string; accountId: string | null; accountName: string | null };

export type ReconTransactionShare = {
  ref: string;
  netShare: number;
  grossShare: number;
  feeShare: number;
  isRefund: boolean;
  quality: string | null;
  // This order's own amounts exactly as the source payout file quoted them
  // (e.g. a Tabby SAR row's own Order Amount/Total Deduction/Transferred
  // amount) — never rescaled, since they're literal source numbers, not an
  // AED estimate. Null for AED-native payouts or rows parsed before this
  // was tracked.
  netOriginal: number | null;
  grossOriginal: number | null;
  feeOriginal: number | null;
  // VAT charged on top of feeShare (Tamara), rescaled like the other AED
  // shares. Null when the file doesn't itemise it — Tabby's fee includes VAT.
  vatShare?: number | null;
  vatOriginal?: number | null;
  // The order this line resolved to — the ref itself, its store-prefix-free
  // form, or a manual link (payout_ref_links). Null while unresolved.
  orderNumber?: string | null;
};

// Parsers convert cross-currency payouts to AED at upload time with the static
// estimate in lib/fx.ts; the engine recomputes the authoritative net from the
// bank's own quoted wire rate. When those differ, the parser's per-order shares
// no longer sum to the confirmed net — so scale every share by the same ratio.
// The last cent of any rounding remainder is pushed onto the largest share
// rather than dropped, so the proof table always foots exactly.
function rescaleShares(
  transactions: PayoutWithRefs["transactions"],
  scale: number,
  target: number,
): ReconTransactionShare[] {
  const shares = transactions.map((t) => ({
    ref: t.order_ref,
    netShare: +(t.net_aed * scale).toFixed(2),
    grossShare: +(t.gross_aed * scale).toFixed(2),
    feeShare: +(t.fee_aed * scale).toFixed(2),
    isRefund: t.is_refund,
    quality: t.quality,
    netOriginal: t.net_original,
    grossOriginal: t.gross_original,
    feeOriginal: t.fee_original,
    vatShare: t.vat_aed != null && t.vat_aed !== 0 ? +(t.vat_aed * scale).toFixed(2) : null,
    vatOriginal: t.vat_original != null && t.vat_original !== 0 ? t.vat_original : null,
  }));
  if (shares.length === 0) return shares;

  const sum = +shares.reduce((s, t) => s + t.netShare, 0).toFixed(2);
  const remainder = +(target - sum).toFixed(2);
  if (remainder !== 0) {
    if (sum === 0) {
      // Every parsed share is zero — there is no real per-order split to
      // correct (e.g. payout_transactions persisted before the parser
      // tracked per-row shares). Dumping the whole remainder onto one
      // "largest" share would misrepresent a single order as carrying the
      // entire payout. Split it evenly instead: the proof table still
      // foots exactly, without falsely attributing the total to one row.
      const even = +(remainder / shares.length).toFixed(2);
      for (const s of shares) s.netShare = even;
      const evenSum = +(even * shares.length).toFixed(2);
      const residual = +(remainder - evenSum).toFixed(2);
      if (residual !== 0) shares[0].netShare = +(shares[0].netShare + residual).toFixed(2);
    } else {
      let largest = 0;
      for (let i = 1; i < shares.length; i++) {
        if (Math.abs(shares[i].netShare) > Math.abs(shares[largest].netShare)) largest = i;
      }
      shares[largest].netShare = +(shares[largest].netShare + remainder).toFixed(2);
    }
  }
  return shares;
}

// Order refs in payout files may carry store prefixes ("WA5204", "SA5204")
// while the orders table stores bare numbers — match on the numeric tail too.
function refCandidates(ref: string): string[] {
  const bare = ref.replace(/^(WA|UAE|KSA|WOO|SA)/i, "");
  return bare === ref ? [ref] : [ref, bare];
}

// Cross-currency payouts (Tabby/Tamara SAR & KWD statements) are converted to
// AED at parse time with a static estimate (lib/fx.ts) that can't track the
// remitting bank's actual daily wire rate — a gap large enough to blow past
// the amount-matching tolerance below and leave a real payout permanently
// AWAITING_PAYOUT. Telex/wire narrations quote the rate the bank actually
// used right in the text (e.g. "SAR/AED 0.958791"), so pull it from there and
// prefer it over the static estimate whenever it's present.
const BANK_FX_RATE_RE = /\b([A-Z]{3})\s*\/\s*AED\s*([\d.]+)/i;

function bankQuotedRate(description: string, currency: string): number | null {
  const m = BANK_FX_RATE_RE.exec(description || "");
  if (!m || m[1].toUpperCase() !== currency.toUpperCase()) return null;
  const rate = parseFloat(m[2]);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

type PayoutWithRefs = Awaited<ReturnType<typeof PayoutsRepository.listWithRefs>>[number];

type ExpectedNet = { net: number; currency: string | null; fxRate: number | null; fxSource: "bank" | "estimate" | null };

// Expected AED net for this specific bank credit: the bank-quoted rate when
// the credit's narration names one for the payout's original currency, else
// the pre-converted static estimate (unchanged behavior for AED-native
// payouts, or narrations without an embedded rate).
function expectedNetFor(payout: PayoutWithRefs, credit: { description: string }): ExpectedNet {
  if (payout.original_currency && payout.original_currency !== "AED" && payout.net_original != null) {
    const rate = bankQuotedRate(credit.description, payout.original_currency);
    if (rate) {
      return { net: +(payout.net_original * rate).toFixed(2), currency: payout.original_currency, fxRate: rate, fxSource: "bank" };
    }
    const estimate = FX_TO_AED[payout.original_currency.toUpperCase()] ?? null;
    return {
      net: payout.net_amount,
      currency: payout.original_currency,
      fxRate: estimate,
      fxSource: estimate != null ? "estimate" : null,
    };
  }
  return { net: payout.net_amount, currency: null, fxRate: null, fxSource: null };
}

export type BankCreditInput = {
  id: string;
  statement_date: string | null;
  description: string;
  reference: string;
  amount: number;
  gateway_guess: string | null;
  confidence: string | null;
};

export type ComputeReconOrderInput = { order_number: string };

export type ComputeReconInputs = {
  credits: BankCreditInput[];
  payouts: PayoutWithRefs[];
  orders: ComputeReconOrderInput[];
  confirmations: Map<string, { by: string; at: string }>;
  /** Persisted review flags, keyed by bank line id. Optional so existing
   *  fixture tests construct inputs unchanged. */
  reviews?: Map<string, { flag: boolean; note: string }>;
  /** Manual ref → order links, keyed `${payoutId}|${ref}`. */
  links?: Map<string, string>;
  /** Founder force-book overrides, keyed by bank line id. */
  forceBooks?: Map<string, ForceBook>;
};

/** Decide which unpinned payout explains which credit, best match first.
 *
 *  Candidate selection accepts anything within max(1 AED, 2% of the credit),
 *  which is wide enough that several same-gateway payouts can be eligible for
 *  the same credit. Taking the FIRST eligible one meant an earlier credit could
 *  grab a payout that belonged to a later credit; the later credit then took
 *  the leftover, and BOTH sat in PAYOUT_VARIANCE forever, neither closable.
 *  All 18 Stripe credits stuck in variance had an exact match available, most
 *  of them swapped pairwise with their neighbour.
 *
 *  Every (credit, payout) pair inside the window is scored by absolute
 *  difference and assigned smallest-difference-first, so exact matches always
 *  win and no payout is claimed twice. Ties break on credit id then payout id,
 *  which keeps the result independent of input order.
 *
 *  Pinned payouts are deliberately NOT considered here: pinning is a human
 *  decision made by uploading a file from a credit's own panel, and it
 *  outranks amount proximity in the caller.
 */
function assignPayoutsToCredits(
  credits: ComputeReconInputs["credits"],
  payouts: PayoutWithRefs[],
): Map<string, PayoutWithRefs> {
  const pinnedCredits = new Set(payouts.filter((p) => p.bank_line_id).map((p) => p.bank_line_id!));
  const open = payouts.filter((p) => !p.bank_line_id);

  const pairs: { creditId: string; payout: PayoutWithRefs; diff: number }[] = [];
  for (const credit of credits) {
    // A credit that already has its own pinned payout is spoken for.
    if (pinnedCredits.has(credit.id)) continue;
    const provider = credit.gateway_guess || "Unclassified";
    const window = Math.max(TOLERANCE_AED, Number(credit.amount) * 0.02);
    for (const p of open) {
      if (p.gateway !== provider) continue;
      const diff = Math.abs(expectedNetFor(p, credit).net - Number(credit.amount));
      if (diff <= window) pairs.push({ creditId: credit.id, payout: p, diff });
    }
  }

  pairs.sort(
    (a, b) =>
      a.diff - b.diff ||
      a.creditId.localeCompare(b.creditId) ||
      a.payout.id.localeCompare(b.payout.id),
  );

  const byCredit = new Map<string, PayoutWithRefs>();
  const taken = new Set<string>();
  for (const { creditId, payout, diff } of pairs) {
    void diff;
    if (byCredit.has(creditId) || taken.has(payout.id)) continue;
    byCredit.set(creditId, payout);
    taken.add(payout.id);
  }
  return byCredit;
}

// Pure: bank → payout → orders matching, no I/O. Split out of
// runReconciliation() so it can be fixture-tested without a live database —
// see tests/reconciliation/engine.test.ts.
export function computeReconLines(inputs: ComputeReconInputs): ReconLine[] {
  const { credits, payouts, orders, confirmations, reviews, links, forceBooks } = inputs;
  const orderNumbers = new Set(orders.map((o) => o.order_number));
  const claimedPayouts = new Set<string>();
  const lines: ReconLine[] = [];
  const assignment = assignPayoutsToCredits(credits, payouts);

  for (const credit of credits) {
    const provider = credit.gateway_guess || "Unclassified";

    // a payout explains a credit when provider agrees AND net ≈ bank amount
    // (expectedNetFor prefers the bank's own quoted wire rate over our static
    // FX estimate, so cross-currency payouts still match precisely)
    // A payout uploaded from this credit's own panel belongs to it, whatever
    // its totals say — a wrong total shows as Variance on the credit, instead
    // of the file matching nothing and seeming to disappear. Payouts pinned
    // to another credit never auto-match here.
    const payout =
      payouts.find((p) => !claimedPayouts.has(p.id) && p.bank_line_id === credit.id) ??
      (assignment.get(credit.id) && !claimedPayouts.has(assignment.get(credit.id)!.id)
        ? assignment.get(credit.id)
        : undefined);

    const confirmation = confirmations.get(credit.id);
    const review = reviews?.get(credit.id);
    const base = {
      id: credit.id,
      date: credit.statement_date,
      narration: credit.description,
      reference: credit.reference,
      provider,
      confidence: credit.confidence || "unknown",
      bankAmount: Number(credit.amount),
      confirmedBy: confirmation?.by ?? null,
      confirmedAt: confirmation?.at ?? null,
      reviewFlag: review?.flag ?? false,
      reviewNote: review?.note ?? "",
      forceBook: forceBooks?.get(credit.id) ?? null,
    };

    if (!payout) {
      lines.push({
        ...base,
        payout: null,
        variance: 0,
        resolvedOrders: [],
        unresolvedRefs: [],
        refundedOrders: [],
        qualityIssues: [],
        transactions: [],
        rateDriftAed: null,
        fxFeeAed: null,
        state: "AWAITING_PAYOUT",
      });
      continue;
    }

    claimedPayouts.add(payout.id);
    const expected = expectedNetFor(payout, credit);
    const variance = +(Number(credit.amount) - expected.net).toFixed(2);

    // Only the bank-quoted path re-derives the net; the estimate path returns
    // payout.net_amount unchanged, so its shares are already consistent.
    const scale =
      expected.fxSource === "bank" && payout.net_amount !== 0
        ? expected.net / payout.net_amount
        : 1;
    const transactions = rescaleShares(payout.transactions, scale, expected.net);

    const rateDriftAed =
      expected.fxSource === "bank" ? +(expected.net - payout.net_amount).toFixed(2) : null;
    // Gross converted at the SAME authoritative rate as the net, so the fee is
    // a like-for-like difference rather than a mix of two conversion rates.
    const fxFeeAed =
      expected.currency && expected.fxRate != null && payout.gross_amount
        ? +(payout.gross_amount * scale - expected.net).toFixed(2)
        : null;

    // per-ref refund/quality info, when the parser produced it (Stripe live
    // API + CSV uploads) — absent for older parsers (Telr/Tamara/Tabby/
    // generic), which fall through to the pre-existing charge/hit behavior.
    const txByRef = new Map(payout.transactions.map((t) => [t.order_ref, t]));

    const resolvedOrders: string[] = [];
    const unresolvedRefs: string[] = [];
    const refundedOrders: string[] = [];
    const qualityIssues: QualityIssue[] = [];
    const orderByRef = new Map<string, string>();
    for (const ref of payout.order_refs) {
      const linked = links?.get(`${payout.id}|${ref}`);
      const hit = (linked && orderNumbers.has(linked) ? linked : undefined) ?? refCandidates(ref).find((c) => orderNumbers.has(c));
      if (hit) orderByRef.set(ref, hit);
      const tx = txByRef.get(ref);
      const isRefund = tx?.is_refund ?? false;

      if (isRefund) {
        if (hit) refundedOrders.push(hit);
        else qualityIssues.push({ ref, quality: "refund_unmatched" });
      } else if (hit) {
        resolvedOrders.push(hit);
      } else {
        unresolvedRefs.push(ref);
      }

      // messy descriptions (blank/unparseable/multi/note) surface for review
      // regardless of whether the ref itself resolved — a multi-ref charge
      // that matched fine still had its net split evenly, an approximation
      // worth a founder's eyes.
      if (tx?.quality && tx.quality !== "clean" && tx.quality !== "refund") {
        qualityIssues.push({ ref, quality: tx.quality });
      }
    }

    // Candidate selection above already accepted this payout within a
    // percentage-based window (max(TOLERANCE_AED, 2%)) because an
    // estimate-sourced net is inherently approximate — the bank's real wire
    // rate for the day isn't known unless the narration quotes it. Applying
    // the flat 1 AED tolerance here regardless of fxSource meant every
    // cross-currency payout whose narration doesn't quote a rate (most
    // Tabby/Tamara SAR/KWD payouts) could never pass this stricter check —
    // permanently stuck at PAYOUT_VARIANCE, "Confirm settlement" never
    // appearing, even though it was the correct, best-available match. Use
    // the same window candidate-selection already trusted for this line.
    const varianceTolerance =
      expected.fxSource === "estimate" ? Math.max(TOLERANCE_AED, Number(credit.amount) * 0.02) : TOLERANCE_AED;
    let state: ReconState;
    if (Math.abs(variance) > varianceTolerance) state = "PAYOUT_VARIANCE";
    else if (unresolvedRefs.length > 0) state = "ORDERS_UNRESOLVED";
    else if (resolvedOrders.length > 0) state = "SETTLED";
    else state = "ORDERS_UNRESOLVED"; // payout matched but carried no chargeable refs

    lines.push({
      ...base,
      payout: {
        id: payout.id, net: expected.net, source: payout.source,
        currency: expected.currency, fxRate: expected.fxRate, fxSource: expected.fxSource,
        ...(payout.delivery_charges?.length ? { deliveryCharges: payout.delivery_charges } : {}),
      },
      variance,
      resolvedOrders,
      unresolvedRefs,
      refundedOrders,
      qualityIssues,
      transactions: transactions.map((t) => ({ ...t, orderNumber: orderByRef.get(t.ref) ?? null })),
      rateDriftAed,
      fxFeeAed,
      state,
    });
  }

  return lines;
}

export function stripeEvidencedOrderNumbers(resolvedOrders: string[], stripeRefs: string[]): string[] {
  const refSet = new Set(stripeRefs);
  return resolvedOrders.filter((num) => refSet.has(num));
}

const mark = (label: string, since: number) => { if (process.env.RECON_TIMING) console.log(`[recon] ${label} ${Date.now() - since}ms`); return Date.now(); };

export async function runReconciliation(): Promise<ReconLine[]> {
  const started = Date.now();
  let t = started;
  const [credits, payouts, orders] = await Promise.all([
    BankRepository.listCredits(),
    PayoutsRepository.listWithRefs(),
    // Only the columns matching and settlement rows use — the full order row
    // (line items, addresses) made this one read ~19s of every run.
    OrdersRepository.listForRecon(),
  ]);

  // Paged: an unpaginated PostgREST select stops at 1000 rows and says nothing,
  // which would quietly drop confirmations and review flags off older credits.
  const existing = await selectAllPages<{
    bank_line_id: string; confirmed_by: string | null; confirmed_at: string | null;
    review_flag: boolean | null; review_note: string | null;
    force_booked_by: string | null; force_booked_at: string | null; force_note: string | null;
    force_residual_account_id: string | null; force_residual_account_name: string | null;
  }>(
    (from, to) =>
      supabase
        .from("recon_lines")
        .select("bank_line_id, confirmed_by, confirmed_at, review_flag, review_note, force_booked_by, force_booked_at, force_note, force_residual_account_id, force_residual_account_name")
        .range(from, to),
    "recon_lines select",
  );
  const confirmations = new Map(
    existing
      .filter((r) => r.confirmed_by)
      .map((r) => [r.bank_line_id, { by: r.confirmed_by, at: r.confirmed_at }]),
  );
  // Only flagged rows are carried — an unflagged row is the default, and
  // materialising one entry per credit would just be noise in the map.
  const reviews = new Map(
    existing
      .filter((r) => r.review_flag)
      .map((r) => [r.bank_line_id, { flag: true, note: r.review_note ?? "" }]),
  );

  const linkRows = await selectAllPages<{ payout_id: string; order_ref: string; order_number: string }>(
    (from, to) => supabase.from("payout_ref_links").select("payout_id, order_ref, order_number").range(from, to),
    "payout_ref_links select",
  );
  const links = new Map(linkRows.map((r) => [`${r.payout_id}|${r.order_ref}`, r.order_number]));

  const forceBooks = new Map<string, ForceBook>(
    existing
      .filter((r) => r.force_booked_by)
      .map((r) => [r.bank_line_id, {
        by: r.force_booked_by!, at: r.force_booked_at ?? "", note: r.force_note ?? "",
        accountId: r.force_residual_account_id, accountName: r.force_residual_account_name,
      }]),
  );

  t = mark("load inputs", t);
  const lines = computeReconLines({ credits, payouts, orders, confirmations, reviews, links, forceBooks });
  t = mark("compute", t);
  await persistResults(lines, orders);
  t = mark("persist", t);
  await saveReconSnapshot(lines, Date.now() - started, {
    unmatchedPayouts: unmatchedPayoutsOf(lines, payouts),
    payoutGateways: [...new Set(payouts.map((p) => p.gateway))],
  });
  return lines;
}

/** The payout foots to the bank, but some of its lines match no order. The
 *  matched orders can still be confirmed and booked; the rest stay listed
 *  until someone links them. (ORDERS_UNRESOLVED is only reachable once the
 *  variance is inside tolerance.) */
export function isConfirmablePartial(l: Pick<ReconLine, "state" | "payout" | "resolvedOrders">): boolean {
  return l.state === "ORDERS_UNRESOLVED" && !!l.payout && l.resolvedOrders.length > 0;
}

/** How much of a cross-border credit the remitting bank may keep before the
 *  gap stops looking like its own charge. A correspondent/telex fee is a small
 *  flat cut — AED 47.94 on a 12k SAR wire (credit DSZ26252CHJHFHHK) is 0.39%.
 *  Anything past 1%, or past AED 500 on a large wire, is something else and a
 *  person looks at it. */
export const BANK_FX_VARIANCE_LIMIT_PCT = 0.01;
export const BANK_FX_VARIANCE_CEILING_AED = 500;
export const bankFxVarianceLimit = (bankAmount: number) =>
  Math.max(TOLERANCE_AED, Math.min(Math.abs(bankAmount) * BANK_FX_VARIANCE_LIMIT_PCT, BANK_FX_VARIANCE_CEILING_AED));

/**
 * A cross-border payout whose orders all matched, where the only thing left
 * over is the slice the remitting bank kept between its quoted rate and the
 * AED it actually credited.
 *
 * Without this, such a credit sat in PAYOUT_VARIANCE forever: "Confirm
 * settlement" never appeared, no settlement records were written, and every
 * invoice on a perfectly good SAR/KWD payout stayed open. The gap is real and
 * still shows as Variance — it just isn't a reason to refuse the booking.
 * publishSettlements() leaves each order's figures at the bank's quoted rate
 * — so its exchange difference is the real invoice-vs-settlement gap — and
 * books what the bank kept once, to Exchange Gain or Loss (planWireResidual),
 * which is what empties the clearing account to zero.
 */
export function isBankFxVariance(
  l: Pick<ReconLine, "state" | "payout" | "resolvedOrders" | "variance" | "bankAmount">,
): boolean {
  if (l.state !== "PAYOUT_VARIANCE" || !l.payout || l.resolvedOrders.length === 0) return false;
  // Currency is deliberately NOT a condition. An AED Telr payout that credits
  // AED 28,100.21 against a net of AED 28,151.66 is the same shape of problem:
  // every order matched, and what is left is the bank's own cut. Excluding AED
  // hid "Confirm settlement" on those credits and held every invoice on them
  // open, while the banner blamed the SIZE of a gap that was 0.18% — well
  // inside the limit. The limit below is what keeps a genuinely broken payout
  // (a missing order, a partial settlement) in front of a person.
  return Math.abs(l.variance) <= bankFxVarianceLimit(l.bankAmount);
}

/** A variance too large to pass as the bank's cut, that a founder chose to
 *  book anyway (with a note and the account the gap goes to). Needs matched
 *  orders — there is nothing to close without them. */
export function isForceBooked(
  l: Pick<ReconLine, "state" | "payout" | "resolvedOrders" | "forceBook">,
): boolean {
  return l.state === "PAYOUT_VARIANCE" && !!l.payout && l.resolvedOrders.length > 0 && !!l.forceBook;
}

/** Settled, a partial that can be confirmed with lines still unmatched, a
 *  cross-border credit whose only gap is the bank's own cut, or a variance a
 *  founder force-booked. */
export function isConfirmable(
  l: Pick<ReconLine, "state" | "payout" | "resolvedOrders" | "variance" | "bankAmount"> & Partial<Pick<ReconLine, "forceBook">>,
): boolean {
  return l.state === "SETTLED" || isConfirmablePartial(l) || isBankFxVariance(l) ||
    isForceBooked({ ...l, forceBook: l.forceBook ?? null });
}

async function persistResults(lines: ReconLine[], orders: Awaited<ReturnType<typeof OrdersRepository.listForRecon>>) {
  let t = Date.now();
  const rows = lines.map((l) => ({
    id: l.id, // deterministic: recon line pk = bank line id, stable across recomputes
    tenant_id: TENANT,
    gateway: l.provider,
    payout_id: l.payout?.id ?? null,
    bank_line_id: l.id,
    expected_net: l.payout?.net ?? null,
    bank_net: l.bankAmount,
    delta: l.variance,
    match_status: l.state,
    reconciled_at: l.state === "SETTLED" ? new Date().toISOString() : null,
    resolved_orders: l.resolvedOrders,
    unresolved_refs: l.unresolvedRefs,
    refunded_orders: l.refundedOrders,
    quality_issues: l.qualityIssues,
    confirmed_by: l.confirmedBy,
    confirmed_at: l.confirmedAt,
  }));

  const { error } = await supabase
    .from("recon_lines")
    .upsert(rows, { onConflict: "bank_line_id" });
  if (error) throw new Error(`recon_lines upsert failed: ${error.message}`);
  t = mark("  recon_lines upsert", t);

  // Stamp orders: settled ONLY because a bank-confirmed payout reached them.
  // Independent per payout, so they run side by side (8 at a time) — one
  // after another this was ~200 sequential round trips per run.
  // Only orders whose stamp would actually change are written.
  const stampByNumber = new Map<string, { payout_id: string | null; payout_status: string | null }[]>();
  for (const o of orders) {
    const list = stampByNumber.get(o.order_number) ?? [];
    list.push({ payout_id: o.payout_id, payout_status: o.payout_status });
    stampByNumber.set(o.order_number, list);
  }
  const stamps = lines
    .filter((l) => l.payout && l.resolvedOrders.length > 0 &&
      (l.state === "SETTLED" || ((isConfirmablePartial(l) || isBankFxVariance(l) || isForceBooked(l)) && l.confirmedBy)))
    .map((l) => ({
      payoutId: l.payout!.id,
      numbers: l.resolvedOrders.filter((n) =>
        (stampByNumber.get(n) ?? [{ payout_id: null, payout_status: null }]).some((o) => o.payout_id !== l.payout!.id || o.payout_status !== "settled")),
    }))
    .filter((s) => s.numbers.length > 0);
  for (let i = 0; i < stamps.length; i += 8) {
    await Promise.all(stamps.slice(i, i + 8).map((s) => OrdersRepository.markSettled(s.numbers, s.payoutId)));
  }
  t = mark(`  stamp orders (${stamps.length} payouts)`, t);

  // audit trail: one immutable proof row per order the moment it settles —
  // what a founder points Zoho Books / an accountant at later.
  const orderByNumber = new Map(orders.map((o) => [o.order_number, o]));
  const settlementRows = lines
    // A bank-FX variance gets its settlement rows too — without them the
    // booking bar has nothing to publish even once a founder confirms it.
    .filter((l) => l.state === "SETTLED" || isConfirmablePartial(l) || isBankFxVariance(l) || isForceBooked(l))
    .flatMap((l) =>
      l.resolvedOrders
        .map((num) => orderByNumber.get(num))
        .filter((o): o is NonNullable<typeof o> => Boolean(o))
        .map((o) => ({
          id: `${o.uid}_${l.id}`,
          order_uid: o.uid,
          order_number: o.order_number,
          store_id: o.store_id,
          customer_name: o.customer_name,
          customer_email: o.customer_email,
          order_date: o.order_date,
          settlement_date: l.date,
          gateway: l.provider,
          currency: "AED",
          // What the customer paid in, which is often not AED even on an AED
          // payout. The posting path needs it to tell a rate difference apart
          // from a mismatch — see isFxOrder() in lib/finance/settlement-posting.
          order_currency: o.currency || "AED",
          gross_aed: Number(o.gross_aed || 0),
          bank_line_id: l.id,
          payout_id: l.payout?.id ?? null,
          bank_reference: l.reference,
          evidence_type: null,
          evidence_confirmed: false,
          evidence_confirmed_by: null,
          evidence_confirmed_at: null,
          evidence_document_id: null,
          zoho_payment_id: null,
          zoho_published_at: null,
        })),
    );
  // One settlement record per order, ever: if the Stripe-API path (or an
  // earlier bank line) already wrote a record for this order under a
  // different id, don't add a second one — two evidence-confirmed records
  // would mean two publishable Zoho Customer Payments for the same order.
  // Re-upserting the SAME id stays allowed, keeping recompute idempotent —
  // but idempotent means preserving that row's evidence/publish state, not
  // just its identity: a plain re-upsert with this object's hardcoded blanks
  // (evidence_confirmed: false, zoho_payment_id: null, ...) would silently
  // wipe a founder's confirmation, or a real Zoho payment_id, every time
  // reconciliation recomputes — which happens on every new upload, not just
  // once. Carry forward the existing row's evidence/zoho fields by id.
  if (settlementRows.length > 0) {
    const existing = await SettlementsRepository.listExistingByOrderUids(
      settlementRows.map((r) => r.order_uid),
    );
    const existingById = new Map(existing.map((e) => [e.id, e]));

    // An order must never hold two settlement records — that would mean two
    // publishable Zoho Customer Payments for one sale. But "a record exists
    // under a different id" has two very different causes:
    //
    //  * The other record is LIVE — its bank credit still claims this order.
    //    A genuine conflict; leave both alone and keep the newer row out.
    //  * The other record is ORPHANED — its bank credit no longer claims the
    //    order, because payout assignment moved it to the credit that really
    //    paid it. Its id embeds the old bank_line_id, so it can never be
    //    reached again, and while it sits there it blocks the correct record
    //    from ever being written. 37 of 53 settled credits had no settlement
    //    record at all for exactly this reason.
    //
    // Orphans are superseded: the stale row is deleted and the correct one
    // written, carrying the evidence forward. A row already published to Zoho
    // is never touched — a booked payment is history.
    const liveLineIds = new Set(lines.map((l) => l.id));
    const foreign = new Set<string>();
    const orphanedIds: string[] = [];
    const evidenceByUid = new Map<string, (typeof existing)[number]>();
    for (const e of existing) {
      const candidate = settlementRows.find((r) => r.order_uid === e.order_uid);
      if (!candidate || e.id === candidate.id) continue;
      const stillLive = liveLineIds.has(e.bank_line_id) && e.bank_line_id !== candidate.bank_line_id
        ? lines.some((l) => l.id === e.bank_line_id && l.resolvedOrders.includes(candidate.order_number))
        : false;
      if (e.zoho_payment_id || stillLive) {
        foreign.add(e.order_uid);
      } else {
        orphanedIds.push(e.id);
        evidenceByUid.set(e.order_uid, e); // carry the confirmation across
      }
    }
    if (orphanedIds.length > 0) {
      const removed = await SettlementsRepository.deleteOrphanedByIds(orphanedIds);
      if (removed > 0) {
        console.log(`[recon] superseded ${removed} settlement record(s) orphaned by payout reassignment`);
      }
    }
    const rows = settlementRows
      .filter((r) => !foreign.has(r.order_uid))
      .map((r) => {
        // Either this row's own prior state, or the state of the orphan it
        // supersedes — a founder's confirmation survives the move.
        const prior = existingById.get(r.id) ?? evidenceByUid.get(r.order_uid);
        return prior
          ? {
              ...r,
              evidence_type: prior.evidence_type,
              evidence_confirmed: prior.evidence_confirmed,
              evidence_confirmed_by: prior.evidence_confirmed_by,
              evidence_confirmed_at: prior.evidence_confirmed_at,
              evidence_document_id: prior.evidence_document_id,
              zoho_payment_id: prior.zoho_payment_id,
              zoho_published_at: prior.zoho_published_at,
            }
          : r;
      });
    if (rows.length > 0) await SettlementsRepository.upsertMany(rows);
  }

  t = mark("  settlement records", t);
  // Stripe auto-verification: for settled lines on Stripe payouts, check
  // each order's ref against Stripe's own balance-transaction breakdown —
  // if Stripe agrees the order was paid out, no human confirmation step is
  // needed. If the API call fails or the ref is absent, leave the row
  // unconfirmed (surfaces as "awaiting evidence", same as any other
  // gateway) rather than assuming success.
  if (stripeConfigured()) {
    const stripeLines = lines.filter(
      (l) => l.state === "SETTLED" && l.provider === "Stripe" && l.payout?.id?.startsWith("STRIPE-") && !l.payout.id.startsWith("STRIPE-TRF-"),
    );
    const idFor = (l: ReconLine, num: string) => { const o = orderByNumber.get(num); return o ? `${o.uid}_${l.id}` : null; };
    // Rows already Stripe-evidenced are done: no API call, and no rewrite of
    // their confirmation time (re-marking every run moved it forward).
    const candidates = stripeLines.flatMap((l) => l.resolvedOrders.map((n) => idFor(l, n)).filter((id): id is string => Boolean(id)));
    const already = await SettlementsRepository.idsWithEvidence(candidates, "stripe_api");
    const pending = stripeLines.filter((l) => l.resolvedOrders.some((n) => { const id = idFor(l, n); return id && !already.has(id); }));
    const toMark: string[] = [];
    for (let i = 0; i < pending.length; i += 6) {
      await Promise.all(pending.slice(i, i + 6).map(async (l) => {
        try {
          const refs = await stripeRefsCached(l.payout!.id.slice("STRIPE-".length));
          for (const num of stripeEvidencedOrderNumbers(l.resolvedOrders, refs)) {
            const id = idFor(l, num);
            if (id && !already.has(id)) toMark.push(id);
          }
        } catch (e) {
          console.error(`Stripe evidence check failed for payout ${l.payout?.id}:`, (e as Error).message);
        }
      }));
    }
    for (let i = 0; i < toMark.length; i += 200) await SettlementsRepository.markStripeEvidence(toMark.slice(i, i + 200));
    t = mark(`  stripe evidence (${pending.length} payouts checked, ${toMark.length} marked)`, t);
  }
}

// A paid Stripe payout never changes, so its order refs are fetched once per
// server process instead of once per payout per reconcile (dozens of API calls).
const stripeRefsCache = new Map<string, Promise<string[]>>();
function stripeRefsCached(stripePayoutId: string): Promise<string[]> {
  let p = stripeRefsCache.get(stripePayoutId);
  if (!p) {
    p = payoutOrderRefs(stripePayoutId).then((r) => r.refs);
    p.catch(() => stripeRefsCache.delete(stripePayoutId)); // retry next run on failure
    stripeRefsCache.set(stripePayoutId, p);
  }
  return p;
}

/** Uploaded payout files no bank credit claimed. They stay visible and
 *  downloadable until someone deletes them — a file must never look like it
 *  vanished just because its total matched nothing. */
export function unmatchedPayoutsOf(lines: ReconLine[], payouts: Awaited<ReturnType<typeof PayoutsRepository.listWithRefs>>) {
  const claimed = new Set(lines.map((l) => l.payout?.id).filter(Boolean));
  return payouts
    .filter((p) => !claimed.has(p.id))
    .map((p) => ({
      id: p.id,
      provider: p.gateway,
      net: Number(p.net_amount),
      currency: p.original_currency,
      netOriginal: p.net_original,
      source: p.source,
      orders: p.order_refs.length,
      uploadedAt: p.uploaded_at ?? null,
      pinnedTo: p.bank_line_id ?? null,
    }))
    .sort((a, b) => String(b.uploadedAt ?? "").localeCompare(String(a.uploadedAt ?? "")));
}
export type UnmatchedPayoutRow = ReturnType<typeof unmatchedPayoutsOf>[number];

export function summarizeReconLines(lines: ReconLine[]) {
  const byState = (s: ReconState) => lines.filter((l) => l.state === s);
  const sum = (ls: ReconLine[]) => +ls.reduce((s, l) => s + l.bankAmount, 0).toFixed(2);
  return {
    total: lines.length,
    settled: sum(byState("SETTLED")),
    awaitingPayout: sum(byState("AWAITING_PAYOUT")),
    payoutVariance: sum(byState("PAYOUT_VARIANCE")),
    ordersUnresolved: sum(byState("ORDERS_UNRESOLVED")),
  };
}

/** Thrown when a credit is confirmed with no payout file behind it. */
export class NoPayoutToConfirmError extends Error {
  constructor(bankLineId: string) {
    super(
      "This credit has no payout file yet, so there is nothing to confirm against. " +
        "Upload the settlement report for it first — you can drop the file straight onto the row.",
    );
    this.name = "NoPayoutToConfirmError";
    this.bankLineId = bankLineId;
  }
  bankLineId: string;
}

export async function confirmLine(bankLineId: string, actor: string) {
  // Confirming asserts "this credit is right", which is meaningless without the
  // payout that proves it. Four credits were confirmed while still
  // AWAITING_PAYOUT (payout_id null) and then could not be repaired, because the
  // upload control used to be hidden on confirmed rows. Refuse at the source.
  // persistResults() rewrites payout_id on every reconcile, so this column is
  // the authoritative answer to "does this credit have a file".
  const { data: line, error: lookupErr } = await supabase
    .from("recon_lines")
    .select("payout_id")
    .eq("bank_line_id", bankLineId)
    .maybeSingle();
  if (lookupErr) throw new Error(`confirm precheck failed: ${lookupErr.message}`);
  if (!line?.payout_id) throw new NoPayoutToConfirmError(bankLineId);

  const { error } = await supabase
    .from("recon_lines")
    .update({ confirmed_by: actor, confirmed_at: new Date().toISOString() })
    .eq("bank_line_id", bankLineId);
  if (error) throw new Error(`confirm failed: ${error.message}`);
  await markReconDirty("confirm");

  // persistResults() writes a settlement record per resolved order the moment
  // a credit reaches SETTLED, but leaves it evidence_confirmed=false — the
  // reconciliation math alone is not a human saying "yes, this is right".
  // Confirming the credit supplies that, which is what makes non-Stripe
  // gateways (Tabby, Tamara, COD, Checkout) publishable to Zoho at all;
  // before this they stayed unconfirmed forever and the publish batch, which
  // filters on evidence_confirmed, never saw them.
  return SettlementsRepository.confirmEvidenceForBankLine(bankLineId, actor);
}

export class NotForceBookableError extends Error {}

/**
 * Book a variance credit that is too large to pass as the bank's own cut.
 *
 * The founder states why (required) and which Zoho account the gap goes to.
 * The credit is then confirmed exactly like any other: settlement records are
 * written for its matched orders, every invoice closes in full at its own
 * amount through the normal booking bar, and publishWireResidual() books the
 * gap ONCE to the chosen account — it is never spread across the orders.
 */
export async function forceBookLine(opts: {
  bankLineId: string; actor: string; note: string; accountId: string; accountName: string;
}) {
  const note = opts.note.trim();
  if (!note) throw new NotForceBookableError("Say why this credit is being booked despite the gap.");
  if (!opts.accountId) throw new NotForceBookableError("Pick the account the gap books to.");

  const line = (await runReconciliation()).find((l) => l.id === opts.bankLineId);
  if (!line) throw new NotForceBookableError(`No reconciliation line ${opts.bankLineId}`);
  if (!line.payout) throw new NoPayoutToConfirmError(opts.bankLineId);
  if (line.state !== "PAYOUT_VARIANCE") {
    throw new NotForceBookableError(`This credit is ${line.state}, not a variance — use Confirm instead.`);
  }
  if (line.resolvedOrders.length === 0) {
    throw new NotForceBookableError("No order on this payout matched — link the orders first; there is no invoice to close.");
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("recon_lines")
    .update({
      force_booked_by: opts.actor, force_booked_at: now, force_note: note,
      force_residual_account_id: opts.accountId, force_residual_account_name: opts.accountName || null,
      confirmed_by: opts.actor, confirmed_at: now,
    })
    .eq("bank_line_id", opts.bankLineId);
  if (error) throw new Error(`force-book failed: ${error.message}`);

  // Recompute so the settlement records for its orders exist, then confirm them.
  await runReconciliation();
  return SettlementsRepository.confirmEvidenceForBankLine(opts.bankLineId, opts.actor);
}

/** Raise or clear a "needs a look" flag on a credit. Deliberately separate from
 *  confirmLine: confirming asserts a credit is RIGHT, flagging asserts someone
 *  should check it — a row can legitimately be both, and neither implies the
 *  other. persistResults() upserts only the columns it names, so a recompute
 *  leaves these two alone. */
export async function flagLine(bankLineId: string, flagged: boolean, note: string) {
  const { error } = await supabase
    .from("recon_lines")
    .update({ review_flag: flagged, review_note: flagged ? note : "" })
    .eq("bank_line_id", bankLineId);
  if (error) throw new Error(`flag failed: ${error.message}`);
  await markReconDirty("flag");
  return { bankLineId, flagged };
}
