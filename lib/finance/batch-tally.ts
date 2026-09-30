// Where one bank credit (a "batch": one payout's worth of orders) stands in
// the books — computed, never estimated by the AI.
//
//   bank credit = Σ order nets + Σ refund nets − courier charges + bank gap
//
// Every item on the right is either booked in Zoho or still pending. What the
// payout file cannot account for at all is `unexplained`: the bank received
// it (or kept it), but no line on the file says why.
//
// The AI advisor (lib/ai/batch-advisor.ts) is handed this tally and explains
// it; it may not change a number in it.

import type { ReconLine } from "@/lib/reconciliation/engine";
import { isUnsettledZohoId, type SettlementRecord } from "@/lib/repositories/settlements.repository";
import type { RefundPostingRow } from "@/lib/repositories/refund-postings.repository";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const booked = (id: string | null | undefined) => !isUnsettledZohoId(id);

export type TallyOrder = {
  order: string;
  gross: number;
  fee: number;
  net: number;
  invoiceNumber: string | null;
  invoiceTotal: number | null;
  invoiceBalance: number | null;
  invoiceStatus: string | null;
  /** invoice total − gross: what a full close would leave to FX / rounding. */
  invoiceGap: number | null;
  paymentBooked: boolean;
  feeBooked: boolean;
  fxBooked: boolean;
  forced: boolean;
  lastError: string | null;
};

export type BatchTally = {
  bankLineId: string;
  reference: string;
  provider: string;
  date: string | null;
  currency: string | null;
  bankAmount: number;
  payoutNet: number | null;
  /** bank − payout net: what the bank added or kept on the wire. */
  bankGap: number | null;
  confirmed: boolean;
  orders: TallyOrder[];
  refunds: { order: string; net: number; creditNoteRefunded: boolean; chargeBooked: boolean; lastError: string | null }[];
  delivery: { total: number; count: number; bookedDocs: number };
  /** Known items booked in Zoho, as they move the bank credit. */
  bookedAed: number;
  /** Known items not booked yet (signed, as they move the bank credit). */
  pendingAed: number;
  /** The same, by kind — each positive: what is left to book. */
  pending: { orders: number; refunds: number; deliveryCharges: number };
  /** Bank credit that no line on the payout file accounts for. */
  unexplainedAed: number;
  /** Pending orders that can't close as-is: no invoice, a gap over AED 1 to
   *  the invoice, or a Zoho error — someone has to decide these. */
  needsDecisionAed: number;
  counts: { orders: number; ordersBooked: number; ordersWithGap: number; ordersWithError: number; refunds: number; refundsBooked: number };
};

export function buildBatchTally(input: {
  line: ReconLine;
  settlements: SettlementRecord[];
  refunds: RefundPostingRow[];
  /** Delivery-charge documents already in Zoho (payouts.delivery_postings). */
  deliveryDocsBooked: number;
  /** True when every delivery charge on the voucher is in a Zoho document. */
  deliveryFullyBooked: boolean;
}): BatchTally {
  const { line } = input;
  const byOrder = new Map(input.settlements.map((s) => [s.order_number, s]));

  const orders: TallyOrder[] = line.transactions
    .filter((t) => !t.isRefund)
    .map((t) => {
      const order = t.orderNumber ?? t.ref;
      const s = byOrder.get(order);
      const total = s?.zoho_invoice_total ?? null;
      return {
        order,
        gross: r2(t.grossShare),
        fee: r2(t.feeShare + (t.vatShare ?? 0)),
        net: r2(t.netShare),
        invoiceNumber: s?.zoho_invoice_number ?? null,
        invoiceTotal: total,
        invoiceBalance: s?.zoho_invoice_balance ?? null,
        invoiceStatus: s?.zoho_invoice_status ?? null,
        invoiceGap: total == null ? null : r2(total - t.grossShare),
        paymentBooked: booked(s?.zoho_payment_id) || booked(s?.force_payment_id),
        feeBooked: booked(s?.zoho_fee_expense_id),
        fxBooked: booked(s?.zoho_fx_journal_id),
        forced: !!s?.force_payment_id,
        lastError: s?.zoho_post_error || null,
      };
    });

  const refundRows = new Map(input.refunds.map((r) => [r.order_number, r]));
  const refunds = line.transactions
    .filter((t) => t.isRefund)
    .map((t) => {
      const order = t.orderNumber ?? t.ref;
      const r = refundRows.get(order);
      return {
        order,
        net: r2(t.netShare),
        creditNoteRefunded: booked(r?.zoho_refund_id),
        chargeBooked: booked(r?.zoho_charge_id) || Math.abs(r?.charge_amount_aed ?? t.netShare - t.grossShare) < 0.005,
        lastError: r?.error || null,
      };
    });

  const deliveryCharges = line.payout?.deliveryCharges ?? [];
  const deliveryTotal = r2(deliveryCharges.reduce((s, c) => s + c.amount, 0));

  const ordersBooked = orders.filter((o) => o.paymentBooked);
  const refundsBooked = refunds.filter((r) => r.creditNoteRefunded);
  const bookedAed = r2(
    ordersBooked.reduce((s, o) => s + o.net, 0) +
    refundsBooked.reduce((s, r) => s + r.net, 0) -
    (input.deliveryFullyBooked ? deliveryTotal : 0),
  );
  const knownAed = r2(orders.reduce((s, o) => s + o.net, 0) + refunds.reduce((s, r) => s + r.net, 0) - deliveryTotal);
  const payoutNet = line.payout ? r2(line.payout.net) : null;
  const needsDecision = orders.filter(
    (o) => !o.paymentBooked && (!o.invoiceNumber || (o.invoiceGap != null && Math.abs(o.invoiceGap) > 1) || !!o.lastError),
  );

  return {
    bankLineId: line.id,
    reference: line.reference,
    provider: line.provider,
    date: line.date,
    currency: line.payout?.currency ?? null,
    bankAmount: r2(line.bankAmount),
    payoutNet,
    bankGap: payoutNet == null ? null : r2(line.bankAmount - payoutNet),
    confirmed: !!line.confirmedBy,
    orders,
    refunds,
    delivery: { total: deliveryTotal, count: deliveryCharges.length, bookedDocs: input.deliveryDocsBooked },
    bookedAed,
    pendingAed: r2(knownAed - bookedAed),
    pending: {
      orders: r2(orders.filter((o) => !o.paymentBooked).reduce((s, o) => s + o.net, 0)),
      refunds: r2(-refunds.filter((r) => !r.creditNoteRefunded).reduce((s, r) => s + r.net, 0)),
      deliveryCharges: input.deliveryFullyBooked ? 0 : deliveryTotal,
    },
    // With no per-order breakdown the file explains only its own net.
    unexplainedAed: r2(line.bankAmount - (orders.length || refunds.length || deliveryCharges.length ? knownAed : payoutNet ?? 0)),
    needsDecisionAed: r2(needsDecision.reduce((s, o) => s + o.net, 0)),
    counts: {
      orders: orders.length,
      ordersBooked: ordersBooked.length,
      ordersWithGap: orders.filter((o) => o.invoiceGap != null && Math.abs(o.invoiceGap) > 1).length,
      ordersWithError: orders.filter((o) => o.lastError).length,
      refunds: refunds.length,
      refundsBooked: refundsBooked.length,
    },
  };
}
