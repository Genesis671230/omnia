// READ-ONLY report: orders whose money has reached the bank (bank credit ↔
// payout matched) but whose Zoho invoice is still open. No DB or Zoho writes.
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { computeReconLines, type ForceBook } from "@/lib/reconciliation/engine";
import { supabase, selectAllPages } from "@/lib/supabase";
import { BankRepository } from "@/lib/repositories/bank.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { listZohoInvoices, type ZohoInvoiceListRow } from "@/lib/integrations/zoho";

const OUT = process.argv[2] ?? "report.json";

async function main() {
  const [credits, payouts, orders] = await Promise.all([
    BankRepository.listCredits(),
    PayoutsRepository.listWithRefs(),
    OrdersRepository.listAll(),
  ]);
  const existing = await selectAllPages<any>(
    (f, t) => supabase.from("recon_lines").select("bank_line_id, confirmed_by, confirmed_at, review_flag, review_note, force_booked_by, force_booked_at, force_note, force_residual_account_id, force_residual_account_name").range(f, t),
    "recon_lines",
  );
  const confirmations = new Map(existing.filter((r) => r.confirmed_by).map((r) => [r.bank_line_id, { by: r.confirmed_by, at: r.confirmed_at }]));
  const reviews = new Map(existing.filter((r) => r.review_flag).map((r) => [r.bank_line_id, { flag: true, note: r.review_note ?? "" }]));
  const linkRows = await selectAllPages<any>((f, t) => supabase.from("payout_ref_links").select("payout_id, order_ref, order_number").range(f, t), "links");
  const links = new Map(linkRows.map((r) => [`${r.payout_id}|${r.order_ref}`, r.order_number]));
  const forceBooks = new Map<string, ForceBook>(existing.filter((r) => r.force_booked_by).map((r) => [r.bank_line_id, {
    by: r.force_booked_by, at: r.force_booked_at ?? "", note: r.force_note ?? "", accountId: r.force_residual_account_id, accountName: r.force_residual_account_name,
  }]));
  const lines = computeReconLines({ credits, payouts, orders, confirmations, reviews, links, forceBooks } as any);

  const settlements = await selectAllPages<any>(
    (f, t) => supabase.from("settlement_records").select("order_number, order_uid, bank_line_id, payout_id, gateway, gross_aed, zoho_invoice_id, zoho_invoice_number, zoho_payment_id, zoho_post_error, settlement_date, evidence_confirmed").range(f, t),
    "settlements",
  );

  // All open Zoho invoices in one sweep (cheap on the 5k/day quota).
  const open = new Map<string, ZohoInvoiceListRow>();
  for (const status of ["unpaid", "partially_paid", "overdue", "draft", "sent"]) {
    for (let page = 1; page <= 40; page++) {
      const r = await listZohoInvoices({ status: status as any, page, perPage: 200 });
      for (const inv of r.invoices) open.set(inv.invoice_id, inv);
      if (!r.hasMorePage) break;
    }
  }

  writeFileSync(OUT, JSON.stringify({
    lines: lines.filter((l) => l.payout && l.resolvedOrders.length > 0),
    settlements,
    openInvoices: [...open.values()],
    orders: orders.map((o: any) => ({ order_number: o.order_number, store_id: o.store_id, uid: o.uid, gross_aed: o.gross_aed, customer_name: o.customer_name, order_date: o.order_date, gateway: o.gateway })),
  }, null, 1));
  console.log("lines", lines.length, "matched-with-orders", lines.filter((l) => l.payout && l.resolvedOrders.length > 0).length, "settlements", settlements.length, "openInvoices", open.size);
}
main().catch((e) => { console.error(e); process.exit(1); });
