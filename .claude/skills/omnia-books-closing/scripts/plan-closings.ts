// READ-ONLY: dry-run the real booking engine over every bank credit since
// FROM, plus refund lines, Zoho credit notes and sales returns. Writes nothing
// to Zoho or Supabase (publishSettlements/publishRefunds with dryRun: true).
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { computeReconLines, type ForceBook } from "@/lib/reconciliation/engine";
import { supabase, selectAllPages } from "@/lib/supabase";
import { BankRepository } from "@/lib/repositories/bank.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import type { SettlementRecord } from "@/lib/repositories/settlements.repository";
import { getAccessToken } from "@/lib/integrations/zoho";
import { zohoThrottledFetch } from "@/lib/integrations/zoho-throttle";
import { fetchPostingOptions } from "@/lib/integrations/zoho-settlement-posting";
import { suggestPostingAccounts } from "@/lib/finance/settlement-posting";
import { publishSettlements } from "@/lib/finance/publish-settlements";
import { publishRefunds, refundLinesOf } from "@/lib/finance/publish-refunds";

const FROM = process.env.FROM ?? "2026-09-01"; // first bank date in scope (YYYY-MM-DD)
const OUT = process.argv[2] ?? "plan.json";
const ORG = process.env.ZOHO_ORGANIZATION_ID!;

async function zget(url: string, token: string) {
  const res = await zohoThrottledFetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}`, "X-com-zoho-books-organizationid": ORG }, cache: "no-store" });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, json: { raw: text.slice(0, 300) } }; }
}

async function main() {
  const [credits, payouts, orders] = await Promise.all([BankRepository.listCredits(), PayoutsRepository.listWithRefs(), OrdersRepository.listAll()]);
  const existing = await selectAllPages<any>((f, t) => supabase.from("recon_lines").select("bank_line_id, confirmed_by, confirmed_at, review_flag, review_note, force_booked_by, force_booked_at, force_note, force_residual_account_id, force_residual_account_name").range(f, t), "recon_lines");
  const confirmations = new Map(existing.filter((r) => r.confirmed_by).map((r) => [r.bank_line_id, { by: r.confirmed_by, at: r.confirmed_at }]));
  const reviews = new Map(existing.filter((r) => r.review_flag).map((r) => [r.bank_line_id, { flag: true, note: r.review_note ?? "" }]));
  const linkRows = await selectAllPages<any>((f, t) => supabase.from("payout_ref_links").select("payout_id, order_ref, order_number").range(f, t), "links");
  const links = new Map(linkRows.map((r) => [`${r.payout_id}|${r.order_ref}`, r.order_number]));
  const forceBooks = new Map<string, ForceBook>(existing.filter((r) => r.force_booked_by).map((r) => [r.bank_line_id, { by: r.force_booked_by, at: r.force_booked_at ?? "", note: r.force_note ?? "", accountId: r.force_residual_account_id, accountName: r.force_residual_account_name }]));
  const all = computeReconLines({ credits, payouts, orders, confirmations, reviews, links, forceBooks } as any);
  const lines = all.filter((l) => (l.date ?? "").slice(0, 10) >= FROM);

  const settlements = await selectAllPages<SettlementRecord>((f, t) => supabase.from("settlement_records").select("*").range(f, t), "settlements");
  const byLine = new Map<string, SettlementRecord[]>();
  for (const s of settlements) { if (!byLine.has(s.bank_line_id)) byLine.set(s.bank_line_id, []); byLine.get(s.bank_line_id)!.push(s); }
  const orderByNum = new Map<string, any>();
  for (const o of orders as any[]) orderByNum.set(String(o.order_number), o);

  const token = await getAccessToken();
  const options = await fetchPostingOptions(token);
  const refundPostings = await selectAllPages<any>((f, t) => supabase.from("refund_postings").select("*").range(f, t), "refund_postings");

  const out: any[] = [];
  for (const line of lines) {
    const entry: any = {
      id: line.id, date: line.date, provider: line.provider, reference: line.reference, narration: line.narration, bankAmount: line.bankAmount,
      state: line.state, variance: line.variance, confirmedBy: line.confirmedBy, payout: line.payout, resolvedOrders: line.resolvedOrders,
      unresolvedRefs: line.unresolvedRefs, refundedOrders: line.refundedOrders, transactions: line.transactions, results: [], refunds: [], wire: null,
    };
    out.push(entry);
    if (!line.payout || line.resolvedOrders.length === 0) continue;
    const acc = suggestPostingAccounts({ provider: line.provider, currency: line.payout.currency }, options as any);
    entry.accounts = acc;
    const accounts = { depositAccountId: acc.depositAccountId, feeAccountId: acc.feeAccountId, vatTaxId: acc.vatTaxId || null, differenceAccountId: acc.differenceAccountId || null, deliveryAccountId: null };
    // Existing settlement rows + in-memory stand-ins for resolved orders that
    // have none yet (credit not confirmed). Never persisted.
    const have = byLine.get(line.id) ?? [];
    const haveNums = new Set(have.map((s) => s.order_number));
    const synth: SettlementRecord[] = line.resolvedOrders.filter((n) => !haveNums.has(n)).map((n) => {
      const o = orderByNum.get(n) ?? {};
      return { id: `DRY:${n}|${line.id}`, order_uid: o.uid ?? "", order_number: n, store_id: o.store_id ?? "", customer_name: o.customer_name ?? "", customer_email: "", order_date: o.order_date ?? null, settlement_date: (line.date ?? "").slice(0, 10), gateway: line.provider, currency: "AED", order_currency: o.currency ?? null, gross_aed: Number(o.gross_aed ?? 0), bank_line_id: line.id, payout_id: line.payout!.id, bank_reference: line.reference, recorded_at: "", evidence_type: null, evidence_confirmed: false, evidence_confirmed_by: null, evidence_confirmed_at: null, evidence_document_id: null, zoho_payment_id: null, zoho_published_at: null } as SettlementRecord;
    });
    entry.synthetic = synth.map((s) => s.order_number);
    if (!accounts.depositAccountId) { entry.error = `No clearing account found for ${line.provider} ${line.payout.currency ?? "AED"}`; }
    try {
      const r = await publishSettlements({ line, settlements: [...have, ...synth], accounts: { ...accounts, depositAccountId: accounts.depositAccountId || "MISSING" }, dryRun: true, accessToken: token });
      entry.results = r.results; entry.wire = r.wire;
    } catch (e) { entry.error = (entry.error ? entry.error + " · " : "") + (e as Error).message; }
    if (refundLinesOf(line).length) {
      try {
        entry.refunds = await publishRefunds({ line, dryRun: true, accessToken: token, depositAccountId: accounts.depositAccountId || "MISSING", feeAccountId: accounts.feeAccountId, vatTaxId: accounts.vatTaxId, inputVatAccountId: (options as any).inputVatAccountId ?? null });
      } catch (e) { entry.refundError = (e as Error).message; }
    }
    console.log(line.date?.slice(0, 10), line.provider, line.bankAmount, line.state, "orders", line.resolvedOrders.length, "results", entry.results.length, entry.error ?? "");
  }

  // Credit notes, their refunds, sales returns since FROM.
  const cn: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await zget(`https://www.zohoapis.com/books/v3/creditnotes?organization_id=${ORG}&date_start=${FROM}&per_page=200&page=${page}`, token);
    cn.push(...(r.json.creditnotes ?? []));
    if (!r.json.page_context?.has_more_page) break;
  }
  const cnRefunds = await zget(`https://www.zohoapis.com/books/v3/creditnotes/refunds?organization_id=${ORG}&per_page=200`, token);
  const salesReturns = await zget(`https://www.zohoapis.com/inventory/v1/salesreturns?organization_id=${ORG}&per_page=200&date_start=${FROM}`, token);

  const septOrders = (orders as any[]).filter((o) => (o.order_date ?? "") >= FROM && /refund|void|cancel/i.test(String(o.financial_status ?? "")))
    .map((o) => ({ order_number: o.order_number, store_id: o.store_id, order_date: o.order_date, financial_status: o.financial_status, gross_aed: o.gross_aed, currency: o.currency, gateway: o.gateway, customer_name: o.customer_name }));

  writeFileSync(OUT, JSON.stringify({ lines: out, creditNotes: cn, creditNoteRefunds: cnRefunds.json, salesReturns: salesReturns, refundPostings, statusOrders: septOrders }, null, 1));
  console.log("done lines", out.length, "creditnotes", cn.length, "salesReturns status", salesReturns.status);
}
main().catch((e) => { console.error(e); process.exit(1); });
