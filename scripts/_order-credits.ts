// READ-ONLY: every order resolved on a payout that is matched to a bank credit, with the credit and per-order shares.
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { computeReconLines, type ForceBook } from "@/lib/reconciliation/engine";
import { supabase, selectAllPages } from "@/lib/supabase";
import { BankRepository } from "@/lib/repositories/bank.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { bankScaleFor, isCrossBorderCurrency } from "@/lib/finance/settlement-posting";
(async () => {
  const [credits, payouts, orders] = await Promise.all([BankRepository.listCredits(), PayoutsRepository.listWithRefs(), OrdersRepository.listAll()]);
  const ex = await selectAllPages<any>((f, t) => supabase.from("recon_lines").select("bank_line_id, confirmed_by, confirmed_at, review_flag, review_note, force_booked_by, force_booked_at, force_note, force_residual_account_id, force_residual_account_name").range(f, t), "rl");
  const confirmations = new Map(ex.filter((r) => r.confirmed_by).map((r) => [r.bank_line_id, { by: r.confirmed_by, at: r.confirmed_at }]));
  const reviews = new Map(ex.filter((r) => r.review_flag).map((r) => [r.bank_line_id, { flag: true, note: r.review_note ?? "" }]));
  const lr = await selectAllPages<any>((f, t) => supabase.from("payout_ref_links").select("payout_id, order_ref, order_number").range(f, t), "l");
  const links = new Map(lr.map((r) => [`${r.payout_id}|${r.order_ref}`, r.order_number]));
  const forceBooks = new Map<string, ForceBook>(ex.filter((r) => r.force_booked_by).map((r) => [r.bank_line_id, { by: r.force_booked_by, at: r.force_booked_at ?? "", note: r.force_note ?? "", accountId: r.force_residual_account_id, accountName: r.force_residual_account_name }]));
  const lines = computeReconLines({ credits, payouts, orders, confirmations, reviews, links, forceBooks } as any);
  const sr = await selectAllPages<any>((f, t) => supabase.from("settlement_records").select("order_number,bank_line_id,zoho_payment_id,zoho_invoice_number,zoho_invoice_status").range(f, t), "sr");
  const out: any[] = [];
  for (const l of lines) {
    if (!l.payout) continue;
    const cb = isCrossBorderCurrency(l.payout.currency);
    const scale = bankScaleFor({ crossBorder: cb, bankAmount: l.bankAmount, payoutNet: l.payout.net, sharesAtBankRate: l.payout.fxSource === "bank" });
    const withTx = new Set(l.transactions.filter((t) => !t.isRefund && t.orderNumber).map((t) => t.orderNumber));
    for (const on of l.resolvedOrders) {
      if (withTx.has(on)) continue;
      const s = sr.find((x) => x.order_number === on && x.bank_line_id === l.id);
      out.push({ order: on, isRefund: false, noBreakdown: true, bankLine: l.id, bankDate: (l.date ?? "").slice(0, 10), bankAmount: l.bankAmount, bankRef: l.reference, provider: l.provider,
        state: l.state, variance: l.variance, confirmed: !!l.confirmedBy, payoutId: l.payout.id, payoutCcy: l.payout.currency, quality: null, gross: null, fee: null, net: null,
        zohoPaid: !!s?.zoho_payment_id && !/^(PENDING|CLAIMED):/.test(s.zoho_payment_id), zohoInvoice: s?.zoho_invoice_number ?? null });
    }
    for (const t of l.transactions) {
      const on = t.orderNumber; if (!on) continue;
      const s = sr.find((x) => x.order_number === on && x.bank_line_id === l.id);
      out.push({ order: on, isRefund: t.isRefund, bankLine: l.id, bankDate: (l.date ?? "").slice(0, 10), bankAmount: l.bankAmount, bankRef: l.reference, provider: l.provider,
        state: l.state, variance: l.variance, confirmed: !!l.confirmedBy, payoutId: l.payout.id, payoutCcy: l.payout.currency, quality: t.quality,
        gross: +(t.grossShare * scale).toFixed(2), fee: +((t.feeShare + (t.vatShare ?? 0)) * scale).toFixed(2), net: +(t.netShare * scale).toFixed(2),
        zohoPaid: !!s?.zoho_payment_id && !/^(PENDING|CLAIMED):/.test(s.zoho_payment_id), zohoInvoice: s?.zoho_invoice_number ?? null });
    }
  }
  const ord = (orders as any[]).map((o) => ({ order_number: o.order_number, store: o.store_id, gateway: o.gateway, gross_aed: o.gross_aed, currency: o.currency, gross_original: o.gross_original, financial_status: o.financial_status }));
  writeFileSync(process.argv[2], JSON.stringify({ shares: out, orders: ord }));
  console.log("shares", out.length);
})();
