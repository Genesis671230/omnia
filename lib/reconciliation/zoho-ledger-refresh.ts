// The Refresh button's server side: read the Zoho Books ledger once for the
// visible date range, work out which bank lines are already booked there, and
// store the answer so every later page load reads the DB instead of Zoho.
//
// Quota: /banktransactions returns 200 rows a page, so a month of statement
// activity is typically 2–4 calls. A short cooldown stops a double-click (or
// two open tabs) from spending that twice.

import { getAccessToken, zohoConfigured } from "@/lib/integrations/zoho";
import { listZohoBankTransactions } from "@/lib/integrations/zoho-books-banking";
import { zohoQuotaStatus } from "@/lib/integrations/zoho-throttle";
import { BankRepository } from "@/lib/repositories/bank.repository";
import { BankLineZohoStatusRepository, ZohoBankTxnRepository } from "@/lib/repositories/zoho-bank-txn.repository";
import { matchBankLinesToZoho, type LedgerZohoTxn } from "./zoho-ledger-match";

const COOLDOWN_MS = 30_000;
/** Zoho entries are often dated on the value date, a day or two off the statement. */
const DATE_SLACK_DAYS = 3;

const lastRun = new Map<string, number>();

function shiftDay(ymd: string, days: number): string {
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type LedgerRefreshResult = {
  checkedAt: string;
  lines: number;
  zohoTransactions: number;
  inZoho: number;
  uncategorized: number;
  amountDiffers: number;
  notFound: number;
  zohoCalls: number;
  quota: { used: number; budget: number } | null;
  cached: boolean;
};

export async function refreshZohoLedgerStatus(opts: {
  from: string; to: string; accountId?: string; force?: boolean;
}): Promise<LedgerRefreshResult> {
  if (!zohoConfigured()) throw new Error("Zoho is not configured");
  const key = `${opts.accountId ?? ""}|${opts.from}|${opts.to}`;
  const cooling = Date.now() - (lastRun.get(key) ?? 0) < COOLDOWN_MS;

  const lines = await BankRepository.listAll({ from: opts.from, to: opts.to });
  if (cooling && !opts.force) {
    return {
      checkedAt: new Date(lastRun.get(key)!).toISOString(), lines: lines.length, zohoTransactions: 0,
      inZoho: 0, uncategorized: 0, amountDiffers: 0, notFound: 0, zohoCalls: 0,
      quota: await zohoQuotaStatus(), cached: true,
    };
  }
  lastRun.set(key, Date.now());

  const before = await zohoQuotaStatus();
  const accessToken = await getAccessToken();
  const zohoTxns = (await listZohoBankTransactions(
    { accountId: opts.accountId, dateStart: shiftDay(opts.from, -DATE_SLACK_DAYS), dateEnd: shiftDay(opts.to, DATE_SLACK_DAYS) },
    accessToken,
  )) as unknown as LedgerZohoTxn[];
  const after = await zohoQuotaStatus();

  const matched = matchBankLinesToZoho(
    lines.map((l) => ({
      id: l.id, date: l.statement_date, amount: Number(l.amount), direction: l.direction as "credit" | "debit",
      reference: l.reference, description: l.description,
    })),
    zohoTxns,
  );

  const checkedAt = new Date().toISOString();
  const rows = lines.map((l) => {
    const s = matched.get(l.id)!;
    return {
      bank_line_id: l.id,
      state: s.state,
      match_kind: s.matchKind,
      zoho_transaction_ids: s.zohoTransactionIds,
      zoho_reference: s.zohoReference,
      zoho_amount: s.zohoAmount,
      zoho_type: s.zohoType,
      zoho_account: s.zohoAccount,
      zoho_status: s.zohoStatus,
      zoho_date: s.zohoDate,
    };
  });
  await BankLineZohoStatusRepository.upsert(rows, checkedAt);

  // Keep what this app posted in step with the ledger: a posting the
  // accountant voided in Zoho must stop reading as done.
  const postings = await ZohoBankTxnRepository.listPostingsFor(lines.map((l) => l.id));
  for (const p of postings) {
    if (p.status === "failed") continue;
    const s = matched.get(p.bank_line_id);
    if (s?.state === "in_zoho") {
      await ZohoBankTxnRepository.markVerified(p.bank_line_id, { zoho_transaction_id: s.zohoTransactionIds[0], zoho_status: s.zohoStatus ?? "" });
    } else if (p.status !== "missing_in_zoho") {
      await ZohoBankTxnRepository.markMissingInZoho(p.bank_line_id);
    }
  }

  const count = (st: string) => rows.filter((r) => r.state === st).length;
  return {
    checkedAt,
    lines: lines.length,
    zohoTransactions: zohoTxns.length,
    inZoho: count("in_zoho"),
    uncategorized: count("uncategorized"),
    amountDiffers: count("amount_differs"),
    notFound: count("not_found"),
    zohoCalls: before && after ? Math.max(0, after.used - before.used) : Math.ceil(zohoTxns.length / 200) || 1,
    quota: after,
    cached: false,
  };
}
