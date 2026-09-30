// Month-scoped Zoho ledger snapshot for the Ledger tab.
//
// What the live API allows (probed 2026-09-25 against org 721369942):
//   · GET /chartofaccounts/transactions needs account_id — without it Zoho
//     answers 200 with ZERO rows, so there is no one-call general ledger.
//     /reports/generalledger is 401 for this token.
//   · The date filter is date_start/date_end. date.start and from_date are
//     silently ignored (the response then spans months).
//   · /chartofaccounts page 1 reports has_more_page:false while a page 2
//     exists (263 accounts, not 182) — page until a page comes back empty.
//   · /bankaccounts returns every payment_clearing account WITH its live
//     balance in one call; the chart of accounts carries no balances.
//
// So a snapshot is: bankaccounts (1) + chart of accounts (2–3) + one paged
// read per watched account (~40 accounts, most a single page; Sales and A/R
// run a few pages each). Typically 50–120 calls against a ~5,000/day cap,
// and only when someone presses Refresh — reads come from Postgres.

import { getAccessToken } from "@/lib/integrations/zoho";
import { zohoThrottledFetch } from "@/lib/integrations/zoho-throttle";
import { supabase } from "@/lib/supabase";
import type { LedgerAccountInfo, LedgerGroup } from "@/lib/reconciliation/ledger-insights";
import { ENV_CONNECTION_ID, zohoConnectionId, zohoOrgId } from "@/lib/integrations/zoho-context";

const BASE = "https://www.zohoapis.com/books/v3";
const MAX_PAGES_PER_ACCOUNT = 40;
/** A snapshot younger than this is served as-is unless forced. */
export const LEDGER_COOLDOWN_MS = 15 * 60 * 1000;
/** A run still "running" after this long died with its process. */
const STALE_RUN_MS = 10 * 60 * 1000;

export type LedgerAccount = LedgerAccountInfo;

// Named P&L / balance-sheet accounts the reconciliation touches. Matched by
// name because IDs differ per org (the saved zoho_account_config still holds
// another org's 1171… IDs).
const NAMED: { re: RegExp; group: LedgerGroup }[] = [
  { re: /^sales$/i, group: "sales" },
  { re: /^sales discount$/i, group: "sales" },
  { re: /^shipment charges-customers$/i, group: "sales" },
  { re: /^accounts receivable$/i, group: "receivable" },
  { re: /^input vat$/i, group: "tax" },
  { re: /^output vat$/i, group: "tax" },
  { re: /^payment gateway charges$/i, group: "fees" },
  { re: /^bank fees and charges$/i, group: "fees" },
  { re: /^exchange gain or loss/i, group: "fx" },
  { re: /^customer refund (clearing|payable) account$/i, group: "refunds" },
];

const GATEWAYISH = /tabby|tamara|telr|stripe|checkout|shopify|cod|delivery|on ?track|smsa/i;

const REQUEST_TIMEOUT_MS = 30_000;
// /chartofaccounts/transactions has its own, much lower per-minute limit:
// ~51 calls in a minute got the endpoint blocked for an hour (code 43,
// Retry-After 3600) while /invoices kept answering. ~24/min stays well clear.
const TXN_GAP_MS = 2_500;

export class ZohoRateBlockedError extends Error {
  constructor(path: string) {
    super(`Zoho blocked ${path} for up to an hour (per-minute request limit). Older lines are kept; refresh again later.`);
    this.name = "ZohoRateBlockedError";
  }
}

async function books(path: string, query: Record<string, string>, token: string, attempt = 1): Promise<Record<string, unknown> & { page_context?: { has_more_page?: boolean } }> {
  const qs = new URLSearchParams({ organization_id: zohoOrgId(), ...query });
  let res: Response;
  try {
    // No timeout here once meant a single stalled socket left the snapshot
    // "running" forever (first live run: 55 of ~60 accounts, then silence).
    res = await zohoThrottledFetch(`${BASE}${path}?${qs}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, { label: `ledger${path}` });
  } catch (e) {
    if (attempt < 2) return books(path, query, token, attempt + 1);
    throw new Error(`Zoho ${path} timed out twice: ${(e as Error).message}`);
  }
  if (res.status === 429) throw new ZohoRateBlockedError(path);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.code !== 0) {
    throw new Error(`Zoho ${path} HTTP ${res.status}: ${json.message ?? "no body"}`);
  }
  return json as Record<string, unknown> & { page_context?: { has_more_page?: boolean } };
}

type RawBankAccount = { account_id: string; account_name: string; account_type: string; currency_code: string; balance: number; is_active?: boolean };
type RawCoa = { account_id: string; account_name: string; account_type: string; is_active?: boolean };
type RawTxn = {
  categorized_transaction_id?: string; transaction_id?: string; transaction_type?: string;
  transaction_type_formatted?: string; transaction_date?: string; account_id?: string;
  payee?: string; description?: string; entry_number?: string; reference_number?: string;
  offset_account_name?: string; debit_amount?: number | string; credit_amount?: number | string;
  currency_code?: string; reconcile_status?: string;
};

const num = (v: unknown) => (v === "" || v == null ? 0 : Number(v) || 0);

/** Pure: which accounts a snapshot reads. Exported for tests. */
export function pickWatchList(bank: RawBankAccount[], coa: RawCoa[]): LedgerAccount[] {
  const out = new Map<string, LedgerAccount>();
  for (const b of bank) {
    if (b.is_active === false) continue;
    const balance = Number(b.balance) || 0;
    // Dead couriers (Fetchr, Skynet…) sit at 0 forever — each would cost a
    // call to learn it has no lines.
    if (balance === 0 && !GATEWAYISH.test(b.account_name)) continue;
    const group: LedgerGroup = b.account_type === "payment_clearing" ? "clearing" : "bank";
    out.set(b.account_id, { account_id: b.account_id, name: b.account_name, type: b.account_type, group, balance, currency: b.currency_code || "AED" });
  }
  for (const a of coa) {
    if (a.is_active === false || out.has(a.account_id)) continue;
    const hit = NAMED.find((n) => n.re.test(a.account_name.trim()));
    if (hit) out.set(a.account_id, { account_id: a.account_id, name: a.account_name, type: a.account_type, group: hit.group, balance: null, currency: "AED" });
  }
  // Most useful first: if Zoho blocks mid-run, what's already read is what
  // matters most for reconciliation.
  const rank: Record<LedgerGroup, number> = { clearing: 0, fees: 1, fx: 2, bank: 3, refunds: 4, sales: 5, tax: 6, receivable: 7 };
  return [...out.values()].sort((a, b) => rank[a.group] - rank[b.group]);
}

export function monthRange(month: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`Bad month ${month}`);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

async function fetchAllCoa(token: string, counter: { n: number }): Promise<RawCoa[]> {
  const out: RawCoa[] = [];
  for (let page = 1; page <= 5; page++) {
    counter.n++;
    const j = await books("/chartofaccounts", { filter_by: "AccountType.All", per_page: "200", page: String(page) }, token);
    const rows = (j.chartofaccounts ?? []) as RawCoa[];
    if (rows.length === 0) break;
    out.push(...rows);
  }
  return out;
}

async function fetchAccountMonth(accountId: string, start: string, end: string, token: string, counter: { n: number }): Promise<RawTxn[]> {
  const out: RawTxn[] = [];
  for (let page = 1; page <= MAX_PAGES_PER_ACCOUNT; page++) {
    await new Promise((r) => setTimeout(r, TXN_GAP_MS));
    counter.n++;
    const j = await books("/chartofaccounts/transactions", {
      account_id: accountId, date_start: start, date_end: end, per_page: "200", page: String(page),
    }, token);
    const rows = (j.transactions ?? []) as RawTxn[];
    out.push(...rows);
    if (rows.length === 0 || !j.page_context?.has_more_page) break;
  }
  return out;
}

export type OpenCreditNote = {
  creditnote_id: string; creditnote_number: string; date: string; customer_name: string;
  reference_number: string; total: number; balance: number;
};

export type SnapshotRow = {
  month: string; status: string; started_at: string | null; finished_at: string | null;
  api_calls: number; line_count: number; accounts: LedgerAccount[]; error: string | null;
  open_credit_notes: OpenCreditNote[];
};

/** Every open credit note, any month — an old one never refunded still owes. */
async function fetchOpenCreditNotes(token: string, counter: { n: number }): Promise<OpenCreditNote[]> {
  const out: OpenCreditNote[] = [];
  for (let page = 1; page <= 20; page++) {
    counter.n++;
    const j = await books("/creditnotes", { status: "open", per_page: "200", page: String(page) }, token);
    const rows = (j.creditnotes ?? []) as Record<string, unknown>[];
    for (const r of rows) {
      out.push({
        creditnote_id: String(r.creditnote_id ?? ""), creditnote_number: String(r.creditnote_number ?? ""),
        date: String(r.date ?? ""), customer_name: String(r.customer_name ?? ""),
        reference_number: String(r.reference_number ?? ""), total: num(r.total), balance: num(r.balance),
      });
    }
    if (rows.length === 0 || !j.page_context?.has_more_page) break;
  }
  return out;
}

/** Storage key for a month's snapshot: the month itself for the default
 *  organisation (existing rows untouched), "<connection>:<month>" for others.
 *  zoho_ledger_* have month as the key, so this scopes them without a
 *  migration. */
export function ledgerKey(month: string): string {
  const c = zohoConnectionId();
  return c === ENV_CONNECTION_ID ? month : `${c}:${month}`;
}

export async function getSnapshot(month: string): Promise<SnapshotRow | null> {
  const { data } = await supabase.from("zoho_ledger_snapshots").select("*").eq("month", ledgerKey(month)).maybeSingle();
  if (!data) return null;
  const row = data as SnapshotRow;
  if (row.status === "running" && row.started_at && Date.now() - Date.parse(row.started_at) > STALE_RUN_MS) {
    return { ...row, status: "failed", error: "Snapshot run did not finish (server restarted?) — refresh again." };
  }
  return row;
}

/**
 * Starts a snapshot in the background and returns immediately. Refuses while
 * one is running, and inside the cooldown unless forced.
 */
export async function startLedgerSnapshot(month: string, opts: { force?: boolean; by?: string } = {}):
  Promise<{ started: boolean; reason?: string }> {
  monthRange(month);
  const prev = await getSnapshot(month);
  if (prev?.status === "running") return { started: false, reason: "A snapshot is already running." };
  if (!opts.force && prev?.status === "ready" && prev.finished_at && Date.now() - Date.parse(prev.finished_at) < LEDGER_COOLDOWN_MS) {
    return { started: false, reason: "Snapshot is under 15 minutes old." };
  }
  const runId = new Date().toISOString();
  const key = ledgerKey(month);
  const { error } = await supabase.from("zoho_ledger_snapshots").upsert({
    month: key, status: "running", started_at: runId, error: null, requested_by: opts.by ?? "",
    // keep previous accounts/line_count so the tab still renders the old data
    ...(prev ? {} : { accounts: [], line_count: 0, api_calls: 0 }),
  });
  if (error) throw new Error(error.message);
  void runSnapshot(month, runId).catch(async (e) => {
    console.error("[zoho-ledger] snapshot failed", e);
    await supabase.from("zoho_ledger_snapshots").update({ status: "failed", error: (e as Error).message, finished_at: new Date().toISOString() }).eq("month", key);
  });
  return { started: true };
}

async function runSnapshot(month: string, runId: string) {
  const { start, end } = monthRange(month);
  const key = ledgerKey(month); // storage key — month for the default org
  const token = await getAccessToken();
  const counter = { n: 0 };

  counter.n++;
  const bankJson = await books("/bankaccounts", { per_page: "200" }, token);
  const bank = (bankJson.bankaccounts ?? []) as RawBankAccount[];
  const coa = await fetchAllCoa(token, counter);
  const accounts = pickWatchList(bank, coa);

  let lineCount = 0;
  const failed: string[] = [];
  let blocked: string | null = null;
  for (const acct of accounts) {
    if (blocked) {
      failed.push(acct.name);
      await supabase.from("zoho_ledger_lines").update({ run_id: runId }).eq("month", key).eq("account_id", acct.account_id);
      continue;
    }
    let txns: RawTxn[];
    try {
      txns = await fetchAccountMonth(acct.account_id, start, end, token, counter);
    } catch (e) {
      // One bad account must not cost the other forty — keep going, and the
      // snapshot says which accounts are missing. Its old rows survive the
      // prune below only if we skip it, so leave them untouched.
      console.error(`[zoho-ledger] ${acct.name}:`, (e as Error).message);
      if (e instanceof ZohoRateBlockedError) blocked = e.message;
      failed.push(acct.name);
      await supabase.from("zoho_ledger_lines").update({ run_id: runId }).eq("month", key).eq("account_id", acct.account_id);
      continue;
    }
    const rows = txns.map((t, i) => ({
      id: `${key}|${acct.account_id}|${t.categorized_transaction_id || `${t.transaction_id}-${t.entry_number}-${i}`}`,
      month: key,
      run_id: runId,
      account_id: acct.account_id,
      account_name: acct.name,
      txn_date: t.transaction_date || null,
      txn_type: t.transaction_type ?? "",
      txn_type_label: t.transaction_type_formatted ?? "",
      transaction_id: t.transaction_id ?? "",
      entry_number: t.entry_number ?? "",
      reference_number: t.reference_number ?? "",
      payee: t.payee ?? "",
      description: t.description ?? "",
      offset_account: t.offset_account_name ?? "",
      debit: num(t.debit_amount),
      credit: num(t.credit_amount),
      currency_code: t.currency_code || "AED",
      reconcile_status: t.reconcile_status ?? "",
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("zoho_ledger_lines").upsert(rows.slice(i, i + 500));
      if (error) throw new Error(`zoho_ledger_lines upsert: ${error.message}`);
    }
    lineCount += rows.length;
    await supabase.from("zoho_ledger_snapshots").update({ api_calls: counter.n, line_count: lineCount }).eq("month", key);
  }

  // Credit notes are a normal Books list (not the rate-limited report), and
  // a failure here must not cost the ledger lines already read.
  let openCreditNotes: OpenCreditNote[] | null = null;
  try { openCreditNotes = await fetchOpenCreditNotes(token, counter); }
  catch (e) { failed.push(`open credit notes (${(e as Error).message})`); }

  // Only now drop what the previous run saw and this one didn't (deleted in Zoho).
  const { error: pruneErr } = await supabase.from("zoho_ledger_lines").delete().eq("month", key).neq("run_id", runId);
  if (pruneErr) throw new Error(`prune: ${pruneErr.message}`);

  await supabase.from("zoho_ledger_snapshots").update({
    status: "ready", finished_at: new Date().toISOString(), api_calls: counter.n,
    line_count: lineCount, accounts,
    ...(openCreditNotes ? { open_credit_notes: openCreditNotes } : {}),
    error: failed.length
      ? `${blocked ? `${blocked} ` : ""}Partial: not re-read — ${failed.join(", ")}.`
      : null,
  }).eq("month", key);
}
