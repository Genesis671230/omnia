// READ-ONLY: re-read from Zoho every document the approved run created, for
// the accountants' ledger snapshot. Nothing is written.
//   FROM=YYYY-MM-DD npx tsx --env-file=.env.local scripts/_readback.ts <live-run.json> <out.json>
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { supabase } from "@/lib/supabase";
import { getAccessToken } from "@/lib/integrations/zoho";
import { zohoThrottledFetch } from "@/lib/integrations/zoho-throttle";

const ORG = process.env.ZOHO_ORGANIZATION_ID!;
const real = (v?: string | null) => !!v && !/^(PENDING|CLAIMED|EXTERNAL|CLOSED):/.test(v);

async function main() {
  const run = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const t = await getAccessToken();
  const get = async (path: string) => {
    const r = await zohoThrottledFetch(`https://www.zohoapis.com/books/v3/${path}${path.includes("?") ? "&" : "?"}organization_id=${ORG}`, { headers: { Authorization: `Zoho-oauthtoken ${t}` }, cache: "no-store" });
    const j = await r.json();
    if (j.code !== 0) throw new Error(`${path}: ${j.message}`);
    return j;
  };
  const safe = async <T>(f: () => Promise<T>) => { try { return await f(); } catch (e) { return { error: (e as Error).message } as any; } };

  const orders: any[] = [];
  for (const [group, list] of [["Section 1", run.s1], ["Group A", run.sa], ["Group G", run.sg]] as const) {
    for (const r of list as any[]) {
      if (r.status !== "booked") { orders.push({ group, order: r.orderNumber, status: r.status, message: r.message, bankRef: r.bankRef, date: r.date, provider: r.provider }); continue; }
      const { data: sr } = await supabase.from("settlement_records").select("zoho_invoice_id,zoho_payment_id,zoho_fee_expense_id,zoho_fx_journal_id,force_payment_id").eq("id", r.settlementId).single();
      const inv = sr?.zoho_invoice_id ? await safe(async () => (await get(`invoices/${sr.zoho_invoice_id}`)).invoice) : null;
      const payId = real(r.paymentId) ? r.paymentId : real(sr?.zoho_payment_id) ? sr!.zoho_payment_id : null;
      const pay = payId ? await safe(async () => (await get(`customerpayments/${payId}`)).payment) : null;
      const fee = real(r.feeExpenseId ?? sr?.zoho_fee_expense_id) ? await safe(async () => (await get(`expenses/${r.feeExpenseId ?? sr!.zoho_fee_expense_id}`)).expense) : null;
      const fx = real(r.fxJournalId ?? sr?.zoho_fx_journal_id) ? await safe(async () => (await get(`journals/${r.fxJournalId ?? sr!.zoho_fx_journal_id}`)).journal) : null;
      orders.push({ group, order: r.orderNumber, status: r.status, steps: r.steps, plan: r.plan, bankRef: r.bankRef, date: r.date, provider: r.provider, currency: r.currency, bankAmount: r.bankAmount, invoice: inv, payment: pay, fee, fx });
      console.log(group, r.orderNumber, inv?.invoice_number, inv?.status, inv?.balance, "pay", pay?.payment_number, pay?.amount, "fee", fee?.total, "fx", fx?.total);
    }
  }

  const refunds: any[] = [];
  for (const r of run.refunds as any[]) {
    const cn = r.creditNote?.id ? await safe(async () => (await get(`creditnotes/${r.creditNote.id}`)).creditnote) : null;
    let charge: any = null;
    if (real(r.chargeId)) {
      charge = r.charge > 0
        ? await safe(async () => ({ kind: "journal", ...(await get(`journals/${r.chargeId}`)).journal }))
        : await safe(async () => ({ kind: "expense", ...(await get(`expenses/${r.chargeId}`)).expense }));
    }
    refunds.push({ ...r, cn, chargeDoc: charge });
    console.log("refund", r.orderNumber ?? r.ref, r.status, cn?.creditnote_number, "bal", cn?.balance, "charge", charge?.kind, charge?.total);
  }

  // Clearing accounts touched: live balance + September movements carrying our references.
  const accIds = [...new Set([...orders.map((o) => o.payment?.account_id).filter(Boolean), ...run.refunds.map((r: any) => r.deposit).filter(Boolean)])] as string[];
  const clearing: any[] = [];
  for (const id of accIds) {
    const acc = await safe(async () => (await get(`chartofaccounts/${id}`)).chart_of_account);
    const tx = await safe(async () => (await get(`chartofaccounts/transactions?account_id=${id}&date.start=${process.env.FROM ?? "2026-09-01"}&date.end=${process.env.TO ?? new Date().toISOString().slice(0, 10)}&per_page=200`)).transactions);
    clearing.push({ id, name: acc?.account_name, balance: acc?.current_balance ?? acc?.balance ?? null, raw: acc, transactions: Array.isArray(tx) ? tx : [] });
    console.log("clearing", acc?.account_name, "balance", acc?.current_balance ?? acc?.balance, "sept txns", Array.isArray(tx) ? tx.length : tx?.error);
  }

  writeFileSync(process.argv[3], JSON.stringify({ run: { startedAt: run.startedAt, finishedAt: run.finishedAt, skipped: run.skippedUnconfirmed, errors: run.errors }, orders, refunds, clearing }, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
