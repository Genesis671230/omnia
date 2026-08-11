// Telr orders don't get a Stripe-style bulk "recent charges" scan — Telr's
// bulk transaction-list endpoint only covers the last 48h / 30 rows, too
// narrow for a useful lookback window (see lib/integrations/telr.ts). This
// instead looks each pending Telr order up individually by the reference
// already captured at sync time: telr_tranref when the store's Telr plugin
// recorded one (authoritative, exact match), else telr_cartid as a fallback
// (see telrRefsFromMeta in lib/integrations/woo.ts). The amount-check,
// dedup, financial_status flip, dispatch-sheet mark, and Telegram notify are
// all shared with every other gateway's confirm flow — see
// lib/sync/payment-confirm-core.ts.
//
// STATUS 2026-08-08: Telr's tools/api/xml surface returns a blank 403 for
// this account — confirmed external access issue (see the note atop
// lib/integrations/telr.ts), not a code problem. This module is fully
// wired but inert until Telr grants API access: telrToolsConfigured() gates
// every call, so it's a silent no-op cycle until then — same dormant-until-
// configured pattern as every other integration in this codebase.

import { OrdersRepository } from "@/lib/repositories/orders.repository";
import {
  telrToolsConfigured,
  getTelrTransactionByRef,
  getTelrTransactionsByCartId,
  type TelrToolsTransaction,
} from "@/lib/integrations/telr";
import { confirmOrderPayment } from "@/lib/sync/payment-confirm-core";

const LOOKBACK_DAYS = 7;

// Pure: pick the transaction to treat as evidence of payment out of
// everything tied to a cart (sale, capture, refund, void, ...). Exported for
// unit testing without hitting the network.
export function pickAuthorisedTransaction(txns: TelrToolsTransaction[]): TelrToolsTransaction | null {
  return txns.find((t) => t.authorised) ?? null;
}

export type TelrConfirmResult = { checked: number; confirmed: number };

export async function confirmTelrPayments(): Promise<TelrConfirmResult> {
  if (!telrToolsConfigured()) return { checked: 0, confirmed: 0 };

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60_000);
  const orders = await OrdersRepository.listInWindow({ from: since.toISOString() });
  const pending = orders.filter(
    (o) =>
      (o.gateway || "").toLowerCase() === "telr" &&
      (o.financial_status || "").toLowerCase() !== "paid" &&
      (o.telr_tranref || o.telr_cartid),
  );
  if (pending.length === 0) return { checked: 0, confirmed: 0 };

  let confirmed = 0;
  for (const order of pending) {
    let txn: TelrToolsTransaction | null = null;
    try {
      if (order.telr_tranref) {
        txn = await getTelrTransactionByRef(order.telr_tranref);
      } else if (order.telr_cartid) {
        const txns = await getTelrTransactionsByCartId(order.telr_cartid.replace(/_$/, ""));
        txn = pickAuthorisedTransaction(txns);
      }
    } catch (e) {
      console.error(`[telr-payment-confirm] lookup failed for ${order.uid}:`, (e as Error).message);
      continue;
    }
    if (!txn || !txn.authorised) continue;

    const outcome = await confirmOrderPayment({
      order,
      source: "Telr",
      dedupProvider: "telr-payment-confirm",
      amount: txn.amount,
      currency: txn.currency,
      paidAtIso: txn.date ? new Date(txn.date).toISOString() : new Date().toISOString(),
    });

    if (outcome.status === "amount-mismatch") {
      console.error(
        `[telr-payment-confirm] ref matched for #${order.order_number} but amount mismatch — ` +
          `txn ${txn.amount} ${txn.currency} vs order ${outcome.expected} ${order.currency}, skipping`,
      );
      continue;
    }
    if (outcome.status === "already-processed") continue;
    if (outcome.status === "financial-status-update-failed") {
      console.error(`[telr-payment-confirm] financial_status update failed for ${order.uid}:`, outcome.error);
      continue;
    }

    confirmed += 1;
  }

  return { checked: pending.length, confirmed };
}
