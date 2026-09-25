// Founder-approved booking run. Copy into the repo's scripts/ as _post-approved.ts, then
//   FROM=YYYY-MM-DD npx tsx --env-file=.env.local scripts/_post-approved.ts <out.json> <ready-refunds.json> [--live]
// ready-refunds.json = [{ref:<bank ref>, order:<order or ref>}] of refund lines the founder approved.
// Without --live everything is a dry run (reads Zoho, writes nothing).
// Scope, exactly as approved:
//   S1  orders on CONFIRMED Sept credits whose invoice is open and the engine plans cleanly
//   SA  "Group A": invoice vs gateway gap <= 3.5%, closed in full, gap -> Exchange Gain or Loss
//   SG  "Group G": invoices already paid by hand -> book fee (+FX) only, never touch the payment
//   RF  refund lines marked READY in the reviewed refund list
// Unconfirmed credits are skipped entirely.
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { computeReconLines, type ForceBook, type ReconLine } from "@/lib/reconciliation/engine";
import { supabase, selectAllPages } from "@/lib/supabase";
import { BankRepository } from "@/lib/repositories/bank.repository";
import { PayoutsRepository } from "@/lib/repositories/payouts.repository";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { SettlementsRepository, type SettlementRecord } from "@/lib/repositories/settlements.repository";
import { ZohoPublishRunsRepository } from "@/lib/repositories/zoho-publish-runs.repository";
import { findZohoInvoiceCandidates, getAccessToken } from "@/lib/integrations/zoho";
import { fetchPostingOptions } from "@/lib/integrations/zoho-settlement-posting";
import { zohoQuotaStatus } from "@/lib/integrations/zoho-throttle";
import { suggestPostingAccounts, bankScaleFor, isCrossBorderCurrency } from "@/lib/finance/settlement-posting";
import { publishSettlements, type OrderPublishResult } from "@/lib/finance/publish-settlements";
import { publishRefunds, refundLinesOf } from "@/lib/finance/publish-refunds";

const FROM = process.env.FROM ?? "2026-09-01"; // first bank date in scope (YYYY-MM-DD)
const OUT = process.argv[2];
const LIVE = process.argv.includes("--live");
const GAP_LIMIT = 0.035;
const EXCLUDE_A = new Set((process.env.EXCLUDE_A ?? "").split(",").filter(Boolean)); // orders whose gap is not FX (e.g. an overpayment that was refunded)
const READY_REFUNDS: { ref: string; order: string }[] = JSON.parse(readFileSync(process.argv[3] ?? "/dev/null", "utf8") || "[]");

async function main() {
  const [credits, payouts, orders] = await Promise.all([BankRepository.listCredits(), PayoutsRepository.listWithRefs(), OrdersRepository.listAll()]);
  const existing = await selectAllPages<any>((f, t) => supabase.from("recon_lines").select("bank_line_id, confirmed_by, confirmed_at, review_flag, review_note, force_booked_by, force_booked_at, force_note, force_residual_account_id, force_residual_account_name").range(f, t), "recon_lines");
  const confirmations = new Map(existing.filter((r) => r.confirmed_by).map((r) => [r.bank_line_id, { by: r.confirmed_by, at: r.confirmed_at }]));
  const reviews = new Map(existing.filter((r) => r.review_flag).map((r) => [r.bank_line_id, { flag: true, note: r.review_note ?? "" }]));
  const linkRows = await selectAllPages<any>((f, t) => supabase.from("payout_ref_links").select("payout_id, order_ref, order_number").range(f, t), "links");
  const links = new Map(linkRows.map((r) => [`${r.payout_id}|${r.order_ref}`, r.order_number]));
  const forceBooks = new Map<string, ForceBook>(existing.filter((r) => r.force_booked_by).map((r) => [r.bank_line_id, { by: r.force_booked_by, at: r.force_booked_at ?? "", note: r.force_note ?? "", accountId: r.force_residual_account_id, accountName: r.force_residual_account_name }]));
  const lines = (computeReconLines({ credits, payouts, orders, confirmations, reviews, links, forceBooks } as any) as ReconLine[])
    .filter((l) => (l.date ?? "").slice(0, 10) >= FROM && l.payout && l.resolvedOrders.length > 0);

  const token = await getAccessToken();
  const options = await fetchPostingOptions(token);
  const shopify = options.depositAccounts.find((a) => a.account_name.trim().toUpperCase() === "SHOPIFY");
  if (!shopify) throw new Error("SHOPIFY account not found in Zoho");
  const accountsFor = (l: ReconLine) => {
    const a = suggestPostingAccounts({ provider: l.provider, currency: l.payout!.currency }, options as any);
    return {
      depositAccountId: l.provider === "Shopify Payments" ? shopify.account_id : a.depositAccountId,
      feeAccountId: a.feeAccountId, vatTaxId: a.vatTaxId || null, differenceAccountId: a.differenceAccountId || null, deliveryAccountId: null,
    };
  };
  console.log("quota before", await zohoQuotaStatus(), "LIVE =", LIVE);

  const log: any = { live: LIVE, startedAt: new Date().toISOString(), skippedUnconfirmed: [], s1: [], sa: [], sg: [], refunds: [], errors: [] };
  const runId = LIVE ? await ZohoPublishRunsRepository.start() : null;
  const allResults: OrderPublishResult[] = [];

  for (const line of lines) {
    if (!line.confirmedBy) { log.skippedUnconfirmed.push({ id: line.id, date: line.date, provider: line.provider, amount: line.bankAmount, orders: line.resolvedOrders }); continue; }
    const accounts = accountsFor(line);
    if (!accounts.depositAccountId) { log.errors.push({ line: line.id, error: `no clearing account for ${line.provider}` }); continue; }
    if (LIVE) await SettlementsRepository.confirmEvidenceForBankLine(line.id, line.confirmedBy);
    const recs = await SettlementsRepository.listByBankLineId(line.id);
    if (recs.length === 0) continue;

    // 1. classify with a dry run over every record on the credit
    const dry = await publishSettlements({ line, settlements: recs, accounts, dryRun: true, accessToken: token });
    const byId = new Map(recs.map((r) => [r.id, r]));
    const s1 = dry.results.filter((r) => r.status === "planned" && r.steps?.payment === "would_post").map((r) => byId.get(r.settlementId)!);
    const sg = dry.results.filter((r) => r.status === "paid_external").map((r) => byId.get(r.settlementId)!);
    const saCandidates = dry.results.filter((r) => r.status === "review" && /doesn't match the gateway's order amount/.test(r.message ?? "") && !EXCLUDE_A.has(r.orderNumber));
    const crossBorder = isCrossBorderCurrency(line.payout!.currency);
    const scale = bankScaleFor({ crossBorder, bankAmount: line.bankAmount, payoutNet: line.payout!.net, sharesAtBankRate: line.payout!.fxSource === "bank" });
    const sa: SettlementRecord[] = [];
    for (const r of saCandidates) {
      const bal = Number(r.message!.match(/balance AED ([\d.]+)/)![1]);
      const gw = Number(r.message!.match(/order amount AED ([\d.]+)/)![1]);
      const tx = line.transactions.find((t) => !t.isRefund && (t.orderNumber === r.orderNumber || t.ref === r.orderNumber));
      const gross = tx ? tx.grossShare * scale : NaN;
      if (!(Math.abs(bal - gw) / bal <= GAP_LIMIT) || !(Math.abs(gross - gw) <= 1)) continue;
      const cands = (await findZohoInvoiceCandidates(r.orderNumber, token, process.env.ZOHO_ORGANIZATION_ID!))
        .filter((c) => Math.abs(Number(c.balance) - bal) < 0.01 && !["void", "draft", "paid"].includes(String(c.status).toLowerCase()));
      if (cands.length !== 1) { log.errors.push({ order: r.orderNumber, error: `Group A: ${cands.length} open invoices with balance ${bal}` }); continue; }
      const rec = byId.get(r.settlementId)!;
      const force = { allocations: [{ invoice_id: cands[0].invoice_id, invoice_number: cands[0].invoice_number, amount: bal }], note: `Approved ${new Date().toISOString().slice(0, 10)}: currency gap AED ${(bal - gw).toFixed(2)} to Exchange Gain or Loss`, by: "founder (approved in review)" };
      sa.push({ ...rec, force_allocations: force.allocations, force_note: force.note } as SettlementRecord);
      if (LIVE) await SettlementsRepository.setForceAllocations(rec.id, force);
    }

    // 2. post (or re-dry-run) exactly the approved subsets
    const run = async (set: SettlementRecord[], extra: { bookFeesOnExternallyPaid?: boolean } = {}) =>
      set.length ? (await publishSettlements({ line, settlements: set, accounts, dryRun: !LIVE, accessToken: token, includeDelivery: false, ...extra })).results : [];
    const tag = (rs: OrderPublishResult[]) => rs.map((r) => ({ bankLine: line.id, date: line.date, provider: line.provider, bankRef: line.reference, bankAmount: line.bankAmount, currency: line.payout!.currency, accounts, ...r }));
    const r1 = await run(s1); log.s1.push(...tag(r1));
    const rA = await run(sa); log.sa.push(...tag(rA));
    const rG = await run(sg, { bookFeesOnExternallyPaid: true }); log.sg.push(...tag(rG));
    allResults.push(...r1, ...rA, ...rG);
    console.log(line.date?.slice(0, 10), line.provider, line.bankAmount, "S1", r1.map((r) => `${r.orderNumber}:${r.status}`).join(","), "| A", rA.map((r) => `${r.orderNumber}:${r.status}`).join(","), "| G", rG.map((r) => `${r.orderNumber}:${r.status}`).join(","));
  }

  // 3. refunds (after payments, so their invoices are paid)
  for (const want of READY_REFUNDS) {
    const line = lines.find((l) => l.reference === want.ref && refundLinesOf(l).some((r) => (r.orderNumber ?? r.ref) === want.order));
    if (!line) { log.errors.push({ refund: want, error: "refund line not found" }); continue; }
    if (!line.confirmedBy) { log.skippedUnconfirmed.push({ refund: want }); continue; }
    const a = accountsFor(line);
    const rl = refundLinesOf(line).find((r) => (r.orderNumber ?? r.ref) === want.order)!;
    const res = await publishRefunds({
      line, refs: [rl.ref], dryRun: !LIVE, accessToken: token,
      depositAccountId: a.depositAccountId, feeAccountId: a.feeAccountId || null, vatTaxId: a.vatTaxId,
      inputVatAccountId: (options as any).inputVatAccountId ?? null,
    });
    log.refunds.push(...res.map((r) => ({ bankLine: line.id, date: line.date, provider: line.provider, bankRef: line.reference, currency: line.payout!.currency, deposit: a.depositAccountId, ...r })));
    console.log("refund", line.date?.slice(0, 10), line.provider, want.order, res.map((r) => `${r.status} ${r.amount}/${r.charge} ${r.chargeStatus ?? ""} ${r.message ?? ""}`).join(" ; "));
  }

  if (runId) await ZohoPublishRunsRepository.finish(runId, allResults.map((r) => ({ ...r, error: r.ok ? undefined : r.message, paymentId: r.paymentId ?? undefined, needsManualReview: r.uncertain })));
  log.finishedAt = new Date().toISOString();
  log.quotaAfter = await zohoQuotaStatus();
  writeFileSync(OUT, JSON.stringify(log, null, 1));
  const sum = (a: any[]) => a.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  console.log("S1", sum(log.s1), "A", sum(log.sa), "G", sum(log.sg), "refunds", sum(log.refunds), "errors", log.errors.length, "skipped", log.skippedUnconfirmed.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
