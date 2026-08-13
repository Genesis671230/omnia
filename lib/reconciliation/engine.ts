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

import { supabase } from "@/lib/supabase";
import { BankRepository } from "@/lib/repositories/bank.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";
import { FX_TO_AED } from "@/lib/fx";
import { stripeConfigured, payoutOrderRefs } from "@/lib/integrations/stripe";

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
};

export type ReconTransactionShare = {
  ref: string;
  netShare: number;
  grossShare: number;
  feeShare: number;
  isRefund: boolean;
  quality: string | null;
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
};

// Pure: bank → payout → orders matching, no I/O. Split out of
// runReconciliation() so it can be fixture-tested without a live database —
// see tests/reconciliation/engine.test.ts.
export function computeReconLines(inputs: ComputeReconInputs): ReconLine[] {
  const { credits, payouts, orders, confirmations, reviews } = inputs;
  const orderNumbers = new Set(orders.map((o) => o.order_number));
  const claimedPayouts = new Set<string>();
  const lines: ReconLine[] = [];

  for (const credit of credits) {
    const provider = credit.gateway_guess || "Unclassified";

    // a payout explains a credit when provider agrees AND net ≈ bank amount
    // (expectedNetFor prefers the bank's own quoted wire rate over our static
    // FX estimate, so cross-currency payouts still match precisely)
    const payout = payouts.find(
      (p) =>
        !claimedPayouts.has(p.id) &&
        p.gateway === provider &&
        Math.abs(expectedNetFor(p, credit).net - credit.amount) <=
          Math.max(TOLERANCE_AED, credit.amount * 0.02),
    );

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
    for (const ref of payout.order_refs) {
      const hit = refCandidates(ref).find((c) => orderNumbers.has(c));
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
      },
      variance,
      resolvedOrders,
      unresolvedRefs,
      refundedOrders,
      qualityIssues,
      transactions,
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

export async function runReconciliation(): Promise<ReconLine[]> {
  const [credits, payouts, orders] = await Promise.all([
    BankRepository.listCredits(),
    PayoutsRepository.listWithRefs(),
    OrdersRepository.listAll(),
  ]);

  const { data: existing } = await supabase
    .from("recon_lines")
    .select("bank_line_id, confirmed_by, confirmed_at, review_flag, review_note");
  const confirmations = new Map(
    (existing ?? [])
      .filter((r) => r.confirmed_by)
      .map((r) => [r.bank_line_id, { by: r.confirmed_by, at: r.confirmed_at }]),
  );
  // Only flagged rows are carried — an unflagged row is the default, and
  // materialising one entry per credit would just be noise in the map.
  const reviews = new Map(
    (existing ?? [])
      .filter((r) => r.review_flag)
      .map((r) => [r.bank_line_id, { flag: true, note: r.review_note ?? "" }]),
  );

  const lines = computeReconLines({ credits, payouts, orders, confirmations, reviews });
  await persistResults(lines, orders);
  return lines;
}

async function persistResults(lines: ReconLine[], orders: Awaited<ReturnType<typeof OrdersRepository.listAll>>) {
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

  // Stamp orders: settled ONLY because a bank-confirmed payout reached them.
  for (const l of lines) {
    if (l.state === "SETTLED" && l.payout) {
      await OrdersRepository.markSettled(l.resolvedOrders, l.payout.id);
    }
  }

  // audit trail: one immutable proof row per order the moment it settles —
  // what a founder points Zoho Books / an accountant at later.
  const orderByNumber = new Map(orders.map((o) => [o.order_number, o]));
  const settlementRows = lines
    .filter((l) => l.state === "SETTLED")
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
    const foreign = new Set<string>();
    for (const e of existing) {
      const candidate = settlementRows.find((r) => r.order_uid === e.order_uid);
      if (candidate && e.id !== candidate.id) foreign.add(e.order_uid);
    }
    const rows = settlementRows
      .filter((r) => !foreign.has(r.order_uid))
      .map((r) => {
        const prior = existingById.get(r.id);
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
    for (const l of stripeLines) {
      try {
        const stripePayoutId = l.payout!.id.slice("STRIPE-".length);
        const { refs } = await payoutOrderRefs(stripePayoutId);
        const evidenced = stripeEvidencedOrderNumbers(l.resolvedOrders, refs);
        const ids = evidenced.map((num) => {
          const order = orderByNumber.get(num);
          return order ? `${order.uid}_${l.id}` : null;
        }).filter((id): id is string => Boolean(id));
        if (ids.length > 0) await SettlementsRepository.markStripeEvidence(ids);
      } catch (e) {
        console.error(`Stripe evidence check failed for payout ${l.payout?.id}:`, (e as Error).message);
      }
    }
  }
}

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

export async function confirmLine(bankLineId: string, actor: string) {
  const { error } = await supabase
    .from("recon_lines")
    .update({ confirmed_by: actor, confirmed_at: new Date().toISOString() })
    .eq("bank_line_id", bankLineId);
  if (error) throw new Error(`confirm failed: ${error.message}`);

  // persistResults() writes a settlement record per resolved order the moment
  // a credit reaches SETTLED, but leaves it evidence_confirmed=false — the
  // reconciliation math alone is not a human saying "yes, this is right".
  // Confirming the credit supplies that, which is what makes non-Stripe
  // gateways (Tabby, Tamara, COD, Checkout) publishable to Zoho at all;
  // before this they stayed unconfirmed forever and the publish batch, which
  // filters on evidence_confirmed, never saw them.
  return SettlementsRepository.confirmEvidenceForBankLine(bankLineId, actor);
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
  return { bankLineId, flagged };
}
