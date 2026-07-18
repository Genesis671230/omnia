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
  state: ReconState;
  confirmedBy: string | null;
  confirmedAt: string | null;
};

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
};

// Pure: bank → payout → orders matching, no I/O. Split out of
// runReconciliation() so it can be fixture-tested without a live database —
// see tests/reconciliation/engine.test.ts.
export function computeReconLines(inputs: ComputeReconInputs): ReconLine[] {
  const { credits, payouts, orders, confirmations } = inputs;
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
        state: "AWAITING_PAYOUT",
      });
      continue;
    }

    claimedPayouts.add(payout.id);
    const expected = expectedNetFor(payout, credit);
    const variance = +(Number(credit.amount) - expected.net).toFixed(2);

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

    let state: ReconState;
    if (Math.abs(variance) > TOLERANCE_AED) state = "PAYOUT_VARIANCE";
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
    .select("bank_line_id, confirmed_by, confirmed_at");
  const confirmations = new Map(
    (existing ?? [])
      .filter((r) => r.confirmed_by)
      .map((r) => [r.bank_line_id, { by: r.confirmed_by, at: r.confirmed_at }]),
  );

  const lines = computeReconLines({ credits, payouts, orders, confirmations });
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
  // Re-upserting the SAME id stays allowed, keeping recompute idempotent.
  if (settlementRows.length > 0) {
    const existing = await SettlementsRepository.listExistingByOrderUids(
      settlementRows.map((r) => r.order_uid),
    );
    const foreign = new Set<string>();
    for (const e of existing) {
      const candidate = settlementRows.find((r) => r.order_uid === e.order_uid);
      if (candidate && e.id !== candidate.id) foreign.add(e.order_uid);
    }
    const rows = settlementRows.filter((r) => !foreign.has(r.order_uid));
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
}
