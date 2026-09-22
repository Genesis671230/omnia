// Sales ledger — one calendar month of counted sales, bucketed by Dubai day,
// with every order traced down the money chain:
//
//   ORDER (gross_aed)  →  PAYOUT FILE LINE (fee, net)  →  BANK CREDIT (date, ref)
//
// The day totals use exactly the rules of lib/orders/gross-sales.ts
// (isCountedSale, Dubai calendar, gross_aed), so a day in this ledger always equals the
// same day on the Gross Sales chart. The payout side is read, never written:
// it answers "was this sale's money received, what did the gateway keep, and
// if not, why not" for each order, and rolls that up into a one-line reason
// per day ("Tabby payout file not uploaded yet").
//
// FEES — three honesty levels, always labelled:
//   measured   the payout file itself carries this order's fee (Stripe, and
//              any parser that produces per-transaction shares)
//   allocated  the file only states a total fee, split across its orders in
//              proportion to their gross
//   estimated  the file states no fee at all (Telr's xls), or no file has
//              been uploaded yet: the gateway's published rate is applied
// A placeholder 0 in payout_transactions is never read as "no fee" — see the
// contract in PayoutsRepository.upsertPayoutsWithIds.

import { dubaiDayKey, dubaiDayRange } from "@/lib/dubai-day";
import { estimatedFeeFor } from "@/lib/contribution-margin";
import { GROSS_SALES_STORES } from "./gross-sales";
import { isCountedSale } from "./sale-rule";

export type LedgerStatus =
  | "received" // bank credit confirmed for the payout carrying this order
  | "in_review" // bank credit matched, but the totals disagree / need confirming
  | "awaiting_bank" // payout file uploaded, no bank credit matched to it yet
  | "awaiting_payout" // gateway charged it (fee + net known live), payout not issued yet
  | "no_payout_file" // no uploaded payout file mentions this order
  | "cod"; // cash on delivery — no gateway payout will ever exist

export type FeeBasis = "measured" | "allocated" | "estimated";

export type LedgerOrderInput = {
  uid: string;
  store_id: string;
  order_number: string;
  order_date: string | null;
  customer_name: string | null;
  gateway: string;
  gross_aed: number | null;
  financial_status: string | null;
  payout_id: string | null;
  payout_status: string | null;
  /** For the export: the order exactly as the store recorded it. */
  currency?: string | null;
  gross_original?: number | null;
  gateway_raw?: string | null;
};

export type LedgerPayoutInput = {
  id: string;
  gateway: string;
  net_amount: number;
  gross_amount: number | null;
  fee_amount: number | null;
  source: string | null;
  uploaded_at?: string | null;
  transactions: {
    order_ref: string;
    is_refund: boolean;
    quality: string | null;
    net_aed: number;
    gross_aed: number;
    fee_aed: number;
    vat_aed?: number | null;
    gross_original?: number | null;
    fee_original?: number | null;
    net_original?: number | null;
  }[];
  original_currency?: string | null;
  net_original?: number | null;
};

/** A gateway charge not yet in any payout — pulled live from the gateway
 *  (Shopify Payments balance transactions). Carries the real fee and net. */
export type LedgerPendingChargeInput = {
  order_ref: string;
  gateway: string;
  gross_aed: number;
  fee_aed: number;
  net_aed: number;
  currency: string;
  gross_original: number | null;
  fee_original: number | null;
  net_original: number | null;
  transaction_date: string | null;
};

export type LedgerReconInput = {
  payout_id: string;
  bank_line_id: string;
  match_status: string;
  confirmed_by: string | null;
  delta: number | null;
};

export type LedgerBankInput = {
  id: string;
  statement_date: string | null;
  amount: number;
  reference: string | null;
  description: string | null;
};

export type LedgerOrder = {
  uid: string;
  store: string;
  orderNumber: string;
  orderDate: string;
  customerName: string;
  gateway: string;
  grossAed: number;
  feeAed: number;
  receivedAed: number;
  feeBasis: FeeBasis;
  /** VAT the gateway charged on its fee, when the payout file itemises it. */
  vatAed: number | null;
  /** What this order nets in its payout (gross − fee − VAT), whether or not
   *  the bank has received it yet. Measured/allocated from the file, else estimated. */
  payoutNetAed: number;
  status: LedgerStatus;
  reason: string;
  /** The order as the store recorded it. */
  currency: string;
  grossOriginal: number | null;
  paymentMethod: string;
  financialStatus: string;
  /** This order's own line in the payout file, verbatim — null when the file
   *  has no per-order breakdown or no file covers the order. */
  payoutLine: {
    grossAed: number;
    feeAed: number;
    vatAed: number | null;
    netAed: number;
    currency: string;
    grossOriginal: number | null;
    feeOriginal: number | null;
    netOriginal: number | null;
    isRefund: boolean;
  } | null;
  /** A payout line matched this order number but covers far less than the
   *  order (e.g. a AED 70 Stripe top-up on a AED 2,382 Tamara order). The sale
   *  itself is still unpaid-out; this is shown so nobody reads it as settled. */
  partial: { gateway: string; grossAed: number; payoutId: string } | null;
  payout: {
    id: string;
    gateway: string;
    source: string | null;
    uploadedAt: string | null;
    netAed: number;
    feeAed: number | null;
    grossAed: number | null;
    /** Lines in the whole payout file, and what their nets add up to — lets
     *  anyone check the payout total foots without opening the file. */
    lineCount: number;
    linesNetAed: number;
    /** Set when the payout settled in another currency (SAR/KWD statements). */
    currency: string;
    netOriginal: number | null;
  } | null;
  bank: {
    id: string;
    date: string | null;
    amountAed: number;
    reference: string;
    state: string;
    confirmed: boolean;
  } | null;
};

export type LedgerStatusCounts = Record<LedgerStatus, { orders: number; grossAed: number }>;

export type LedgerDay = {
  day: string;
  grossAed: number;
  orders: number;
  byStore: Record<string, number>;
  feeAed: number;
  receivedAed: number;
  /** Portion of the day's gross whose money is confirmed in the bank. */
  receivedGrossAed: number;
  statusCounts: LedgerStatusCounts;
  /** Worst status on the day, for a single colour on the chart. */
  headline: LedgerStatus | "empty";
  /** One plain sentence: why the day's money is or isn't all in. */
  reason: string;
  orderList: LedgerOrder[];
};

export type SalesLedger = {
  month: string; // YYYY-MM
  label: string;
  fromDay: string;
  toDay: string;
  stores: string[];
  totals: {
    grossAed: number;
    orders: number;
    feeAed: number;
    receivedAed: number;
    receivedGrossAed: number;
    statusCounts: LedgerStatusCounts;
  };
  /** Gateways with sales in the month that no payout file covers yet. */
  missingPayoutFiles: { gateway: string; orders: number; grossAed: number; days: string[] }[];
  /** Orders placed in the month but not counted: unpaid/pending/cancelled. */
  excludedOrders: number;
  days: LedgerDay[];
};

const STATUS_ORDER: LedgerStatus[] = ["no_payout_file", "in_review", "awaiting_payout", "awaiting_bank", "received", "cod"];

const money = (n: number) => +n.toFixed(2);

function emptyCounts(): LedgerStatusCounts {
  return {
    received: { orders: 0, grossAed: 0 },
    in_review: { orders: 0, grossAed: 0 },
    awaiting_bank: { orders: 0, grossAed: 0 },
    awaiting_payout: { orders: 0, grossAed: 0 },
    no_payout_file: { orders: 0, grossAed: 0 },
    cod: { orders: 0, grossAed: 0 },
  };
}

/** Same prefix handling as the reconciler's refCandidates: payout files write
 *  "WA5204" / "SA5204" where the order table says "5204". */
function refCandidates(ref: string): string[] {
  const bare = ref.replace(/^(WA|UAE|KSA|WOO|SA)/i, "");
  return bare === ref ? [ref] : [ref, bare];
}

const isCod = (gateway: string) => (gateway || "").trim().toUpperCase() === "COD";
const sameGateway = (a: string, b: string) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();

/** A payout line that states its own gross and covers under 80% of the order
 *  is not the payment for the order — 80% leaves room for SAR/KWD rate drift. */
export const PARTIAL_COVERAGE = 0.8;
function isPartialLine(tx: LedgerPayoutInput["transactions"][number], orderGross: number): boolean {
  return tx.gross_aed > 0 && orderGross > 0 && tx.gross_aed < orderGross * PARTIAL_COVERAGE;
}

function monthBounds(month: string): { fromDay: string; toDay: string; label: string } {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  return {
    fromDay: first.toISOString().slice(0, 10),
    toDay: last.toISOString().slice(0, 10),
    label: first.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

export function ledgerMonthBounds(month: string) {
  return monthBounds(month);
}

type PayoutHit = { payout: LedgerPayoutInput; tx: LedgerPayoutInput["transactions"][number] };

/** Every non-refund payout line, indexed by the order number it resolves to. */
function indexPayoutLines(
  payouts: LedgerPayoutInput[],
  links: Map<string, string>,
): Map<string, PayoutHit[]> {
  const byOrder = new Map<string, PayoutHit[]>();
  for (const payout of payouts) {
    for (const tx of payout.transactions) {
      if (tx.is_refund) continue; // a refund line reverses money, it never pays for the sale
      const linked = links.get(`${payout.id}|${tx.order_ref}`);
      const keys = linked ? [linked] : refCandidates(tx.order_ref);
      for (const k of keys) {
        const list = byOrder.get(k) ?? [];
        list.push({ payout, tx });
        byOrder.set(k, list);
      }
    }
  }
  return byOrder;
}

function feeFor(
  order: LedgerOrderInput,
  gross: number,
  hit: PayoutHit | null,
): { fee: number; received: number; basis: FeeBasis; vat: number | null } {
  if (hit) {
    const { tx, payout } = hit;
    // A real per-order share: the parser computed it, so it is the fact.
    if (tx.fee_aed > 0 || tx.net_aed > 0) {
      const vat = tx.vat_aed != null ? money(Number(tx.vat_aed)) : null;
      return {
        fee: money(tx.fee_aed),
        received: money(tx.net_aed || gross - tx.fee_aed - (vat ?? 0)),
        basis: "measured",
        vat,
      };
    }
    // The file states a total fee only — split it by this order's weight.
    const pGross = Number(payout.gross_amount || 0);
    const pFee = Number(payout.fee_amount || 0);
    if (pFee > 0 && pGross > 0) {
      const share = gross / pGross;
      return { fee: money(pFee * share), received: money(Number(payout.net_amount) * share), basis: "allocated", vat: null };
    }
  }
  const { fee } = estimatedFeeFor(order.gateway, gross);
  return { fee, received: money(gross - fee), basis: "estimated", vat: null };
}

function orderReason(
  status: LedgerStatus,
  order: LedgerOrderInput,
  hit: PayoutHit | null,
  bank: LedgerOrder["bank"],
): string {
  const gw = order.gateway || "gateway";
  switch (status) {
    case "cod":
      return "Cash on delivery — collected by the courier, no gateway payout";
    case "no_payout_file":
      return `${gw} payout file not uploaded yet`;
    case "awaiting_payout":
      return `Charged via ${gw} — fee known, payout not issued yet`;
    case "awaiting_bank":
      return `In ${gw} payout file${hit?.payout.source ? ` (${hit.payout.source})` : ""} — bank credit not received or not matched yet`;
    case "in_review":
      return bank
        ? `Bank credit of AED ${bank.amountAed.toFixed(2)}${bank.date ? ` on ${bank.date}` : ""} matched, but needs confirming in Reconciliation`
        : "Matched to a bank credit that needs confirming in Reconciliation";
    case "received":
      return bank?.date ? `Received in bank on ${bank.date}` : "Received in bank";
  }
}

function dayReason(counts: LedgerStatusCounts, orders: LedgerOrder[]): string {
  const total = orders.length;
  if (total === 0) return "No sales";
  const parts: string[] = [];
  if (counts.no_payout_file.orders > 0) {
    const gws = [...new Set(orders.filter((o) => o.status === "no_payout_file").map((o) => o.gateway))];
    parts.push(
      `${counts.no_payout_file.orders} of ${total}: ${gws.join(", ")} payout file not uploaded yet`,
    );
  }
  if (counts.awaiting_bank.orders > 0) {
    parts.push(`${counts.awaiting_bank.orders} in a payout file, bank credit not matched yet`);
  }
  if (counts.awaiting_payout.orders > 0) {
    parts.push(`${counts.awaiting_payout.orders} charged, payout not issued yet`);
  }
  if (counts.in_review.orders > 0) {
    parts.push(`${counts.in_review.orders} matched to the bank but need confirming`);
  }
  if (counts.cod.orders > 0) parts.push(`${counts.cod.orders} cash on delivery`);
  if (parts.length === 0) return "All received in bank";
  if (counts.received.orders > 0) parts.unshift(`${counts.received.orders} received`);
  return parts.join(" · ");
}

function headlineFor(counts: LedgerStatusCounts, total: number): LedgerDay["headline"] {
  if (total === 0) return "empty";
  for (const s of STATUS_ORDER) if (counts[s].orders > 0) return s;
  return "empty";
}

/**
 * Build the month. Pure: hand it the rows, it does no I/O.
 *
 * `orders` may include rows outside the month and unpaid rows; both are
 * filtered here with the same rules as the Gross Sales panel.
 */
export function computeSalesLedger({
  month,
  orders,
  payouts,
  links = new Map(),
  recon = [],
  bank = [],
  pending = [],
  stores = [...GROSS_SALES_STORES],
}: {
  month: string;
  orders: LedgerOrderInput[];
  payouts: LedgerPayoutInput[];
  links?: Map<string, string>;
  recon?: LedgerReconInput[];
  bank?: LedgerBankInput[];
  pending?: LedgerPendingChargeInput[];
  stores?: string[];
}): SalesLedger {
  const { fromDay, toDay, label } = monthBounds(month);
  const byOrder = indexPayoutLines(payouts, links);
  const payoutById = new Map(payouts.map((p) => [p.id, p]));
  const reconByPayout = new Map<string, LedgerReconInput>();
  for (const r of recon) {
    if (!r.payout_id) continue;
    // Prefer the settled/confirmed line if a payout was ever seen on two credits.
    const prev = reconByPayout.get(r.payout_id);
    if (!prev || r.match_status === "SETTLED" || r.confirmed_by) reconByPayout.set(r.payout_id, r);
  }
  const bankById = new Map(bank.map((b) => [b.id, b]));
  const pendingByOrder = new Map<string, LedgerPendingChargeInput>();
  for (const c of pending) for (const k of refCandidates(c.order_ref)) if (!pendingByOrder.has(k)) pendingByOrder.set(k, c);

  const dayMap = new Map<string, LedgerDay>();
  for (const day of dubaiDayRange(fromDay, toDay)) {
    const byStore: Record<string, number> = {};
    for (const s of stores) byStore[s] = 0;
    dayMap.set(day, {
      day, grossAed: 0, orders: 0, byStore, feeAed: 0, receivedAed: 0, receivedGrossAed: 0,
      statusCounts: emptyCounts(), headline: "empty", reason: "", orderList: [],
    });
  }

  let excludedOrders = 0;

  for (const o of orders) {
    const day = dubaiDayKey(o.order_date);
    if (!day || day < fromDay || day > toDay) continue;
    if (!isCountedSale(o)) {
      excludedOrders += 1;
      continue;
    }
    const bucket = dayMap.get(day)!;
    const gross = Number(o.gross_aed) || 0;

    // Candidate payout lines for this order number, best first: the gateway
    // the order was actually paid through, then the one the reconciler stamped,
    // then one that already reached the bank. A line covering only a sliver of
    // the order is never the payment for it — it is reported as a partial.
    const all = byOrder.get(o.order_number) ?? [];
    const full = all.filter((h) => !isPartialLine(h.tx, gross));
    const partialHit = all.find((h) => isPartialLine(h.tx, gross)) ?? null;
    const rank = (h: PayoutHit) =>
      (sameGateway(h.payout.gateway, o.gateway) ? 4 : 0) +
      (o.payout_id && h.payout.id === o.payout_id ? 2 : 0) +
      (reconByPayout.has(h.payout.id) ? 1 : 0);
    const best = full.slice().sort((a, b) => rank(b) - rank(a))[0];
    const stampedIsPartial = !!(o.payout_id && partialHit && partialHit.payout.id === o.payout_id);
    const hit: PayoutHit | null =
      best ??
      (o.payout_id && !stampedIsPartial && payoutById.has(o.payout_id)
        ? { payout: payoutById.get(o.payout_id)!, tx: { order_ref: o.order_number, is_refund: false, quality: null, net_aed: 0, gross_aed: 0, fee_aed: 0 } }
        : null);

    const r = hit ? reconByPayout.get(hit.payout.id) : undefined;
    const b = r ? bankById.get(r.bank_line_id) : undefined;
    const bankInfo: LedgerOrder["bank"] = r
      ? {
          id: r.bank_line_id,
          date: b?.statement_date ? b.statement_date.slice(0, 10) : null,
          amountAed: money(Number(b?.amount ?? 0)),
          reference: b?.reference || "",
          state: r.match_status,
          confirmed: Boolean(r.confirmed_by),
        }
      : null;

    let status: LedgerStatus;
    if (isCod(o.gateway)) status = "cod";
    // payout_status="settled" only counts when the payout that stamped it is a
    // real payment for this order, not a partial line sharing its number.
    else if ((o.payout_status === "settled" && !stampedIsPartial) || (r && (r.match_status === "SETTLED" || r.confirmed_by))) status = "received";
    else if (r) status = "in_review";
    else if (hit) status = "awaiting_bank";
    else status = "no_payout_file";

    // No payout covers it yet, but the gateway already charged it: the live
    // charge carries the real fee and net, so nothing here is an estimate.
    const charge = !hit && status === "no_payout_file" ? pendingByOrder.get(o.order_number) ?? null : null;
    if (charge) status = "awaiting_payout";

    const fee = status === "cod"
      ? { fee: 0, received: 0, basis: "estimated" as FeeBasis, vat: null }
      : charge
        ? { fee: money(charge.fee_aed), received: money(charge.net_aed), basis: "measured" as FeeBasis, vat: null }
        : feeFor(o, gross, hit);
    const measuredTx = hit && (hit.tx.fee_aed > 0 || hit.tx.net_aed > 0)
      ? { ...hit.tx, currency: (hit.payout.original_currency || "AED").toUpperCase() }
      : charge
        ? { order_ref: charge.order_ref, is_refund: false, quality: null, gross_aed: charge.gross_aed, fee_aed: charge.fee_aed,
            net_aed: charge.net_aed, vat_aed: null, gross_original: charge.gross_original, fee_original: charge.fee_original,
            net_original: charge.net_original, currency: charge.currency.toUpperCase() }
        : null;

    const line: LedgerOrder = {
      uid: o.uid,
      store: o.store_id,
      orderNumber: o.order_number,
      orderDate: o.order_date!,
      customerName: o.customer_name || "",
      gateway: o.gateway,
      grossAed: money(gross),
      feeAed: fee.fee,
      receivedAed: status === "received" ? fee.received : 0,
      feeBasis: fee.basis,
      vatAed: fee.vat,
      payoutNetAed: status === "cod" ? 0 : fee.received,
      currency: (o.currency || "AED").toUpperCase(),
      grossOriginal: o.gross_original != null ? money(Number(o.gross_original)) : null,
      paymentMethod: o.gateway_raw || o.gateway,
      financialStatus: o.financial_status || "",
      payoutLine: measuredTx
        ? {
            grossAed: money(Number(measuredTx.gross_aed)),
            feeAed: money(Number(measuredTx.fee_aed)),
            vatAed: measuredTx.vat_aed != null ? money(Number(measuredTx.vat_aed)) : null,
            netAed: money(Number(measuredTx.net_aed)),
            currency: measuredTx.currency,
            grossOriginal: measuredTx.gross_original != null ? money(Number(measuredTx.gross_original)) : null,
            feeOriginal: measuredTx.fee_original != null ? money(Number(measuredTx.fee_original)) : null,
            netOriginal: measuredTx.net_original != null ? money(Number(measuredTx.net_original)) : null,
            isRefund: measuredTx.is_refund,
          }
        : null,
      status,
      reason:
        orderReason(status, o, hit, bankInfo) +
        (partialHit && !hit
          ? ` (only AED ${partialHit.tx.gross_aed.toFixed(2)} found in a ${partialHit.payout.gateway} payout under this order number)`
          : ""),
      partial: partialHit && partialHit !== hit
        ? { gateway: partialHit.payout.gateway, grossAed: money(partialHit.tx.gross_aed), payoutId: partialHit.payout.id }
        : null,
      payout: hit
        ? {
            id: hit.payout.id,
            gateway: hit.payout.gateway,
            source: hit.payout.source,
            uploadedAt: hit.payout.uploaded_at ?? null,
            netAed: money(Number(hit.payout.net_amount || 0)),
            feeAed: hit.payout.fee_amount != null ? money(Number(hit.payout.fee_amount)) : null,
            grossAed: hit.payout.gross_amount != null ? money(Number(hit.payout.gross_amount)) : null,
            lineCount: hit.payout.transactions.length,
            linesNetAed: money(hit.payout.transactions.reduce((a, t) => a + Number(t.net_aed || 0), 0)),
            currency: (hit.payout.original_currency || "AED").toUpperCase(),
            netOriginal: hit.payout.net_original != null ? money(Number(hit.payout.net_original)) : null,
          }
        : null,
      bank: bankInfo,
    };

    bucket.grossAed += gross;
    bucket.orders += 1;
    bucket.byStore[o.store_id] = (bucket.byStore[o.store_id] ?? 0) + gross;
    bucket.feeAed += line.feeAed;
    bucket.receivedAed += line.receivedAed;
    if (status === "received") bucket.receivedGrossAed += gross;
    bucket.statusCounts[status].orders += 1;
    bucket.statusCounts[status].grossAed += gross;
    bucket.orderList.push(line);
  }

  const totals = {
    grossAed: 0, orders: 0, feeAed: 0, receivedAed: 0, receivedGrossAed: 0,
    statusCounts: emptyCounts(),
  };
  const missing = new Map<string, { gateway: string; orders: number; grossAed: number; days: Set<string> }>();

  const days = [...dayMap.values()].map((d) => {
    d.orderList.sort((a, b) => (a.orderDate < b.orderDate ? 1 : -1));
    for (const o of d.orderList) {
      if (o.status !== "no_payout_file") continue;
      const m = missing.get(o.gateway) ?? { gateway: o.gateway, orders: 0, grossAed: 0, days: new Set<string>() };
      m.orders += 1;
      m.grossAed += o.grossAed;
      m.days.add(d.day);
      missing.set(o.gateway, m);
    }
    totals.grossAed += d.grossAed;
    totals.orders += d.orders;
    totals.feeAed += d.feeAed;
    totals.receivedAed += d.receivedAed;
    totals.receivedGrossAed += d.receivedGrossAed;
    for (const s of STATUS_ORDER) {
      totals.statusCounts[s].orders += d.statusCounts[s].orders;
      totals.statusCounts[s].grossAed += d.statusCounts[s].grossAed;
      d.statusCounts[s].grossAed = money(d.statusCounts[s].grossAed);
    }
    return {
      ...d,
      grossAed: money(d.grossAed),
      feeAed: money(d.feeAed),
      receivedAed: money(d.receivedAed),
      receivedGrossAed: money(d.receivedGrossAed),
      byStore: Object.fromEntries(Object.entries(d.byStore).map(([k, v]) => [k, money(v)])),
      headline: headlineFor(d.statusCounts, d.orders),
      reason: dayReason(d.statusCounts, d.orderList),
    };
  });

  for (const s of STATUS_ORDER) totals.statusCounts[s].grossAed = money(totals.statusCounts[s].grossAed);

  return {
    month,
    label,
    fromDay,
    toDay,
    stores,
    totals: {
      ...totals,
      grossAed: money(totals.grossAed),
      feeAed: money(totals.feeAed),
      receivedAed: money(totals.receivedAed),
      receivedGrossAed: money(totals.receivedGrossAed),
    },
    missingPayoutFiles: [...missing.values()]
      .map((m) => ({ gateway: m.gateway, orders: m.orders, grossAed: money(m.grossAed), days: [...m.days].sort() }))
      .sort((a, b) => b.grossAed - a.grossAed),
    excludedOrders,
    days,
  };
}
