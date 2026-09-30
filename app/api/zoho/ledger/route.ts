import { accountConfigKey } from "@/lib/repositories/zoho-config.repository";
import { runInZohoOrgOr400, zohoOrgForBankLine, zohoOrgForSettlement, zohoOrgScoped } from "@/lib/integrations/zoho-org";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { zohoConfigured } from "@/lib/integrations/zoho";
import { getSnapshot, ledgerKey, monthRange, startLedgerSnapshot } from "@/lib/integrations/zoho-ledger";
import type { LedgerLine } from "@/lib/reconciliation/ledger-insights";
import type { StatementLine } from "@/lib/reconciliation/ledger-close";

export const runtime = "nodejs";
export const maxDuration = 60;

/* The Ledger tab.
 *   GET  ?month=YYYY-MM → the stored snapshot + its lines. ZERO Zoho calls.
 *   POST { month, force? } → start a background snapshot (see zoho-ledger.ts);
 *        the client polls GET until status leaves "running".
 *
 * `linked` on a line says whether Omnia booked or matched it — its Zoho
 * transaction id is one we posted (settlement payment / fee expense / FX
 * journal / refund), or its reference is a bank line or payout posting we
 * know. Only checked for clearing and bank accounts: on Sales or VAT every
 * line is an invoice or a tax split, and "not linked" there means nothing. */

const PAGE = 1000;

async function selectAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function widen(start: string, end: string, days: number) {
  const s = new Date(`${start}T00:00:00Z`); s.setUTCDate(s.getUTCDate() - days);
  const e = new Date(`${end}T00:00:00Z`); e.setUTCDate(e.getUTCDate() + days);
  return { from: s.toISOString().slice(0, 10), to: e.toISOString().slice(0, 10) };
}

async function knownKeys(start: string, end: string) {
  // Payouts settle up to a few weeks after the order, and a bank credit can
  // land days after the Zoho entry — widen the window so edges still link.
  const w = widen(start, end, 45);
  type SR = {
    zoho_payment_id: string | null; zoho_fee_expense_id: string | null; zoho_fx_journal_id: string | null;
    bank_reference: string | null; order_number: string; zoho_invoice_number: string | null;
    gateway: string; fee_aed: number | null; settlement_date: string | null; zoho_published_at: string | null;
  };
  const [settlements, postings, bankLines, refunds] = await Promise.all([
    selectAll<SR>((a, b) => supabase.from("settlement_records")
      .select("zoho_payment_id, zoho_fee_expense_id, zoho_fx_journal_id, bank_reference, order_number, zoho_invoice_number, gateway, fee_aed, settlement_date, zoho_published_at")
      .gte("settlement_date", w.from).lte("settlement_date", w.to).range(a, b)),
    selectAll<{ reference_number: string; zoho_result: unknown }>((a, b) => supabase.from("zoho_postings")
      .select("reference_number, zoho_result").gte("posted_at", w.from).range(a, b)),
    selectAll<{ reference: string; amount: number; statement_date: string | null }>((a, b) => supabase.from("bank_lines")
      .select("reference, amount, statement_date").gte("statement_date", w.from).lte("statement_date", w.to).range(a, b)),
    selectAll<{ zoho_refund_id: string | null; zoho_charge_id: string | null; zoho_creditnote_id: string | null }>((a, b) => supabase.from("refund_postings")
      .select("zoho_refund_id, zoho_charge_id, zoho_creditnote_id").gte("created_at", w.from).range(a, b)),
  ]);
  const ids = new Set<string>();
  const refs = new Set<string>();
  // Zoho's customer_payment ledger lines carry NO transaction_id — the invoice
  // number sits in entry_number and the order number leads the payee
  // ("WA55787 Sumaya Ali"). Without these every payment INTO a clearing
  // account read as unlinked, pinning every gateway at ~50% reconciled.
  const invoiceNos = new Set<string>();
  const orderNos = new Set<string>();
  const addRef = (r: string | null | undefined) => { const t = (r ?? "").trim().toUpperCase(); if (t.length >= 4) refs.add(t); };
  for (const s of settlements) {
    for (const id of [s.zoho_payment_id, s.zoho_fee_expense_id, s.zoho_fx_journal_id]) if (id) ids.add(id);
    addRef(s.bank_reference);
    if (s.zoho_invoice_number) invoiceNos.add(s.zoho_invoice_number.trim().toUpperCase());
    if (s.order_number) orderNos.add(s.order_number.trim().toUpperCase().replace(/^#/, ""));
  }
  for (const p of postings) {
    addRef(p.reference_number);
    for (const r of Array.isArray(p.zoho_result) ? p.zoho_result : []) {
      const id = (r as { transaction_id?: string })?.transaction_id; if (id) ids.add(id);
    }
  }
  // Transfers from a clearing account to the bank (and the bank side of
  // them) carry no reference in Zoho — but the amount is the statement
  // credit to the fils, so amount + date is the dependable key there.
  const bankAmounts = new Map<number, number[]>();
  for (const b of bankLines) {
    addRef(b.reference);
    if (!b.statement_date) continue;
    const cents = Math.round(Math.abs(Number(b.amount)) * 100);
    // statement_date is stored as Dubai midnight in UTC — shift before taking the day.
    const day = Date.parse(b.statement_date) + 4 * 3600_000;
    bankAmounts.set(cents, [...(bankAmounts.get(cents) ?? []), day]);
  }
  for (const r of refunds) for (const id of [r.zoho_refund_id, r.zoho_charge_id, r.zoho_creditnote_id]) if (id) ids.add(id);
  return { ids, refs, bankAmounts, invoiceNos, orderNos, settlements };
}

const AMOUNT_MATCH_DAYS = 3;
const TRANSFERISH = /transfer|deposit/i;

function amountDateHit(bankAmounts: Map<number, number[]>, amount: number, date: string | null): boolean {
  if (!date || amount <= 0) return false;
  const days = bankAmounts.get(Math.round(amount * 100));
  if (!days) return false;
  const t = Date.parse(`${date}T00:00:00Z`);
  return days.some((d) => Math.abs(d - t) <= AMOUNT_MATCH_DAYS * 86_400_000);
}

function currentMonth() {
  // Dubai calendar month — the business closes its books on Dubai days.
  return new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 7);
}

async function handleGET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? currentMonth();
  try {
    const { start, end } = monthRange(month);
    const snapshot = await getSnapshot(month);
    if (!snapshot) return NextResponse.json({ month, snapshot: null, lines: [], statement: [], staleMapping: false });

    type Row = {
      id: string; account_id: string; txn_date: string | null; txn_type: string; txn_type_label: string;
      transaction_id: string; entry_number: string; reference_number: string; payee: string;
      description: string; offset_account: string; debit: number; credit: number; reconcile_status: string;
    };
    const [rows, keys, cfg, stmt, zohoStatus] = await Promise.all([
      selectAll<Row>((a, b) => supabase.from("zoho_ledger_lines")
        .select("id, account_id, txn_date, txn_type, txn_type_label, transaction_id, entry_number, reference_number, payee, description, offset_account, debit, credit, reconcile_status")
        .eq("month", ledgerKey(month)).order("txn_date", { ascending: false }).order("id").range(a, b)),
      knownKeys(start, end),
      supabase.from("zoho_account_config").select("clearing_by_gateway, bank_account_id").eq("id", accountConfigKey()).maybeSingle(),
      // statement_date is Dubai midnight stored in UTC → the month's lines
      // start at the previous UTC day 20:00.
      selectAll<{ id: string; statement_date: string | null; amount: number; direction: string; reference: string; description: string }>((a, b) =>
        supabase.from("bank_lines").select("id, statement_date, amount, direction, reference, description")
          .gte("statement_date", new Date(Date.parse(`${start}T00:00:00Z`) - 4 * 3600_000).toISOString())
          .lt("statement_date", new Date(Date.parse(`${end}T00:00:00Z`) + 20 * 3600_000).toISOString())
          .range(a, b)),
      // The app's own statement↔Zoho check (refresh-only, see
      // lib/reconciliation/zoho-ledger-match.ts) — it knows charge+VAT pairs
      // combine into one Zoho entry, which a bare amount match does not.
      selectAll<{ bank_line_id: string; state: string; zoho_transaction_ids: unknown }>((a, b) =>
        supabase.from("bank_line_zoho_status").select("bank_line_id, state, zoho_transaction_ids").range(a, b)),
    ]);
    const statusByLine = new Map(zohoStatus.map((z) => [z.bank_line_id, z]));
    const zohoStatusIds = new Set<string>();
    for (const z of zohoStatus) {
      if (z.state !== "in_zoho") continue;
      for (const id of Array.isArray(z.zoho_transaction_ids) ? z.zoho_transaction_ids : []) if (id) zohoStatusIds.add(String(id));
    }

    const groupOf = new Map(snapshot.accounts.map((a) => [a.account_id, a.group]));
    const lines: LedgerLine[] = rows.map((r) => {
      const ref = r.reference_number.trim().toUpperCase();
      const refHit = ref.length >= 4 && [...ref.split(/[\s,/]+/), ref].some((t) => keys.refs.has(t));
      const group = groupOf.get(r.account_id);
      const checkable = group === "clearing" || group === "bank";
      // Amount-only matching is safe for bank lines and clearing→bank
      // transfers; on customer payments two orders of the same value collide.
      const amountHit = checkable && (group === "bank" || TRANSFERISH.test(r.txn_type))
        && amountDateHit(keys.bankAmounts, Math.max(Number(r.debit), Number(r.credit)), r.txn_date);
      const payeeOrder = r.payee.trim().split(/\s+/)[0]?.toUpperCase().replace(/^#/, "") ?? "";
      const settlementHit = keys.invoiceNos.has(r.entry_number.trim().toUpperCase()) || (payeeOrder.length >= 4 && keys.orderNos.has(payeeOrder));
      return {
        id: r.id, accountId: r.account_id, date: r.txn_date, type: r.txn_type, typeLabel: r.txn_type_label,
        txnId: r.transaction_id, entry: r.entry_number, ref: r.reference_number, payee: r.payee,
        desc: r.description, offset: r.offset_account, debit: Number(r.debit), credit: Number(r.credit),
        linked: checkable ? (keys.ids.has(r.transaction_id) || refHit || amountHit || settlementHit || zohoStatusIds.has(r.transaction_id)) : null,
        zohoRec: r.reconcile_status ?? "",
      };
    });

    // The uploaded statements are the Sharjah Islamic Bank account's; match
    // each statement line to a Zoho line on that account by amount ± 3 days.
    const stmtAccounts = new Set(snapshot.accounts
      .filter((a) => a.group === "bank" && /islamic|\bsib\b/i.test(a.name)).map((a) => a.account_id));
    const zohoBank = new Map<number, number[]>();
    for (const l of lines) {
      if (!stmtAccounts.has(l.accountId) || !l.date) continue;
      const cents = Math.round((l.debit || l.credit) * 100);
      zohoBank.set(cents, [...(zohoBank.get(cents) ?? []), Date.parse(`${l.date}T00:00:00Z`)]);
    }
    const statement: StatementLine[] = stmt.map((b) => {
      const day = b.statement_date ? new Date(Date.parse(b.statement_date) + 4 * 3600_000).toISOString().slice(0, 10) : null;
      const amount = Math.abs(Number(b.amount));
      const t = day ? Date.parse(`${day}T00:00:00Z`) : NaN;
      const checked = statusByLine.get(b.id);
      const inZoho = checked
        ? checked.state === "in_zoho"
        : !!day && (zohoBank.get(Math.round(amount * 100)) ?? []).some((d) => Math.abs(d - t) <= AMOUNT_MATCH_DAYS * 86_400_000);
      return {
        id: b.id, date: day, amount, direction: b.direction === "debit" ? "debit" : "credit",
        reference: b.reference ?? "", description: b.description ?? "", inZoho, zohoState: checked?.state ?? null,
      };
    });

    // Settings → Zoho mapping holds account ids; if none of them exist in
    // the org the snapshot just read, the mapping belongs to another org.
    const known = new Set(snapshot.accounts.map((a) => a.account_id));
    const mapped = Object.values((cfg.data?.clearing_by_gateway ?? {}) as Record<string, string>).filter(Boolean);
    const staleMapping = mapped.length > 0 && known.size > 0 && !mapped.some((id) => known.has(id));

    // Fees Omnia recorded as booked whose expense no longer exists in Zoho
    // (deleted by hand after posting). Only settlements dated inside the
    // month: the snapshot holds only this month's lines, so an earlier fee
    // would look missing when it's simply out of range.
    const lineIds = new Set(rows.map((r) => r.transaction_id).filter(Boolean));
    const inMonth = (d: string | null) => !!d && new Date(Date.parse(d) + 4 * 3600_000).toISOString().slice(0, 7) === month;
    // …and only fees booked before the snapshot started: one booked after it
    // is simply not in the snapshot yet (Tabby20260907SAR, re-booked an hour
    // after the morning snapshot, read as 5 "missing" fees).
    const snapAt = snapshot.started_at ? Date.parse(snapshot.started_at) : 0;
    const bookedBeforeSnapshot = (d: string | null) => !!d && Date.parse(d) < snapAt;
    const missingFees = keys.settlements
      .filter((s) => s.zoho_fee_expense_id && /^\d+$/.test(s.zoho_fee_expense_id) && inMonth(s.settlement_date)
        && bookedBeforeSnapshot(s.zoho_published_at) && !lineIds.has(s.zoho_fee_expense_id))
      .map((s) => ({ orderNumber: s.order_number, gateway: s.gateway, fee: Number(s.fee_aed ?? 0), expenseId: s.zoho_fee_expense_id! }));

    return NextResponse.json({ month, snapshot, lines, statement: stmtAccounts.size ? statement : [], missingFees, staleMapping });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

async function handlePOST(request: Request) {
  if (!zohoConfigured()) return NextResponse.json({ error: "Zoho is not configured" }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  const month = String(body.month ?? currentMonth());
  try {
    const r = await startLedgerSnapshot(month, { force: body.force === true });
    return NextResponse.json(r, { status: r.started ? 202 : 200 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Multi-org: every Zoho call below runs in the organisation named by ?zohoOrg= (default: main) — lib/integrations/zoho-org.ts.
export async function GET(req: Request, ctx: { params: Promise<Record<string, string>> }) {
  return zohoOrgScoped(req, () => (handleGET as (r: Request, c: unknown) => Promise<Response>)(req, ctx));
}

export async function POST(req: Request, ctx: { params: Promise<Record<string, string>> }) {
  return zohoOrgScoped(req, () => (handlePOST as (r: Request, c: unknown) => Promise<Response>)(req, ctx));
}
