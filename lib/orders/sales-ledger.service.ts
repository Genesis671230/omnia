// Fetch side of the sales ledger. Kept apart from sales-ledger.ts so the
// order → payout → bank tracing stays pure and testable without Supabase.
// Read-only: it reads what the reconciler last persisted (recon_lines) and
// never re-runs or writes reconciliation.

import { supabase, selectAllPages } from "@/lib/supabase";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { dubaiRangeBoundsUtc } from "@/lib/dubai-day";
import { SyncRunsRepository } from "@/lib/repositories/sync-runs.repository";
import { PendingChargesRepository } from "@/lib/repositories/pending-charges.repository";
import {
  computeSalesLedger,
  ledgerMonthBounds,
  type LedgerBankInput,
  type LedgerOrderInput,
  type LedgerReconInput,
  type SalesLedger,
} from "./sales-ledger";

export type SalesLedgerResponse = SalesLedger & {
  /** Gateway APIs whose last automatic pull failed — why a payout is missing
   *  even though nobody is expected to upload a file for it. */
  payoutSyncErrors: { provider: string; error: string; at: string | null }[];
};

export async function buildSalesLedger(month: string): Promise<SalesLedgerResponse> {
  const { fromDay, toDay } = ledgerMonthBounds(month);
  const { fromUtc, toUtc } = dubaiRangeBoundsUtc(fromDay, toDay);

  const [orderRows, payouts, recon, linkRows, lastSync, pending] = await Promise.all([
    OrdersRepository.listInWindow({ from: fromUtc, to: toUtc }),
    PayoutsRepository.listWithRefs(),
    selectAllPages<LedgerReconInput>(
      (from, to) =>
        supabase
          .from("recon_lines")
          .select("payout_id, bank_line_id, match_status, confirmed_by, delta")
          .not("payout_id", "is", null)
          .range(from, to),
      "recon_lines select",
    ),
    selectAllPages<{ payout_id: string; order_ref: string; order_number: string }>(
      (from, to) => supabase.from("payout_ref_links").select("payout_id, order_ref, order_number").range(from, to),
      "payout_ref_links select",
    ),
    SyncRunsRepository.getLatest().catch(() => null),
    // A charge can land a few days after the order; look back one extra week.
    PendingChargesRepository.listSince(new Date(Date.parse(fromUtc) - 7 * 86_400_000).toISOString()).catch(() => []),
  ]);

  // `to` is inclusive (lte); the pure layer drops the boundary instant by day key.
  const orders: LedgerOrderInput[] = orderRows.map((r) => ({
      uid: r.uid,
      store_id: r.store_id,
      order_number: r.order_number,
      order_date: r.order_date,
      customer_name: r.customer_name,
      gateway: r.gateway,
      gross_aed: r.gross_aed,
      financial_status: r.financial_status,
      payout_id: r.payout_id ?? null,
      payout_status: r.payout_status ?? null,
      currency: r.currency ?? null,
      gross_original: r.gross_original ?? null,
      gateway_raw: r.gateway_raw ?? null,
    }));

  const bankIds = [...new Set(recon.map((r) => r.bank_line_id))];
  const bank: LedgerBankInput[] = [];
  for (let i = 0; i < bankIds.length; i += 200) {
    const { data, error } = await supabase
      .from("bank_lines")
      .select("id, statement_date, amount, reference, description")
      .in("id", bankIds.slice(i, i + 200));
    if (error) throw new Error(`bank_lines select failed: ${error.message}`);
    bank.push(...((data ?? []) as LedgerBankInput[]));
  }

  const ledger = computeSalesLedger({
    month,
    orders,
    payouts,
    pending,
    links: new Map(linkRows.map((l) => [`${l.payout_id}|${l.order_ref}`, l.order_number])),
    recon,
    bank,
  });

  const results = (lastSync?.gateway_results ?? []) as { provider: string; error?: string }[];
  return {
    ...ledger,
    payoutSyncErrors: results
      .filter((r) => r.error)
      .map((r) => ({ provider: r.provider, error: r.error!, at: lastSync?.started_at ?? null })),
  };
}
