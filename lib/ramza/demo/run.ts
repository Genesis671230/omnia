/* One demo run: the industry's demo month, or the visitor's own files, turned
 * into everything the hero shows (and the numbers the report email carries).
 * Pure — called in the browser. */

import { chartFor, INDUSTRY_LABEL, type Account, type Industry } from "./coa";
import { categoriseBank, demoDataset, reconcile, type BankLine, type Invoice, type Loaded, type PayoutLine, type ReconResult } from "./engine";
import type { DemoSummary } from "../demo-report";

export type RunResult = {
  source: "demo" | "upload";
  label: string;
  lines: number;
  recon: ReconResult | null;
  expenses: ReturnType<typeof categoriseBank> | null;
  chart: Account[];
  customChart: boolean;
  notes: string[];
  report: DemoSummary;
};

export function runDemo(industry: Industry): RunResult {
  const ds = demoDataset(industry);
  const chart = chartFor(industry);
  const recon = reconcile(ds);
  return finish("demo", `${ds.company} · October 2026 (demo)`, ds.payouts.length + ds.bank.length + ds.invoices.length, recon, categoriseBank(ds.bank, chart), chart, false, []);
}

export function runFiles(industry: Industry, files: Loaded[]): RunResult {
  const payouts: PayoutLine[] = files.flatMap((f) => f.payouts ?? []);
  const invoices: Invoice[] = files.flatMap((f) => f.invoices ?? []);
  const bank: BankLine[] = files.flatMap((f) => f.bank ?? []);
  const own = files.find((f) => f.chart?.length)?.chart;
  const chart = own ?? chartFor(industry);
  const notes: string[] = [];
  const unknown = files.filter((f) => f.kind === "unknown");
  if (unknown.length) notes.push(`Couldn't tell what ${unknown.map((f) => f.name).join(", ")} is — RAMZA reads gateway payout exports, bank statements, invoice/order exports and charts of accounts.`);
  if (payouts.length && !invoices.length) notes.push("Add your invoices or orders export to see which invoices each payout clears — fees, VAT and net are split below already.");
  if (invoices.length && !payouts.length && !bank.length) notes.push("Add a gateway payout export or bank statement to match these invoices against.");
  // Bank credits that are gateway payouts (and no payout file for them): shown as payouts to the bank.
  const recon = payouts.length || invoices.length ? reconcile({ company: "", invoices, payouts, bank }) : null;
  const expenses = bank.length ? categoriseBank(bank, chart) : null;
  const lines = payouts.length + invoices.length + bank.length;
  return finish("upload", files.map((f) => f.name).join(" + "), lines, recon, expenses, chart, Boolean(own), notes);
}

function finish(source: "demo" | "upload", label: string, lines: number, recon: ReconResult | null, expenses: RunResult["expenses"], chart: Account[], customChart: boolean, notes: string[]): RunResult {
  const s = recon?.summary;
  const report: DemoSummary = {
    source, company: recon?.company ?? "",
    invoices: s?.invoices ?? 0, cleared: s?.cleared ?? 0, unpaid: s?.unpaid ?? 0, shortPaid: s?.shortPaid ?? 0, retention: s?.retention ?? 0,
    grossAed: s?.grossAed ?? 0, feeAed: s?.feeAed ?? 0, vatAed: s?.vatAed ?? 0, fxAed: s?.fxAed ?? 0, netAed: s?.netAed ?? 0, bankAed: s?.bankAed ?? 0,
    payouts: s?.payouts ?? 0, bankMatched: s?.bankMatched ?? 0,
    minutesSaved: (s?.minutesSaved ?? 0) + Math.round((expenses?.lines.length ?? 0) * 0.75),
    currencies: s?.currencies ?? [],
    gateways: (recon?.gateways ?? []).map((g) => ({ gateway: g.gateway, grossAed: g.grossAed, feeAed: g.feeAed, vatAed: g.vatAed, effectiveRate: g.effectiveRate })),
    expenses: expenses?.byAccount.filter((a) => a.total < 0).slice(0, 10).map((a) => ({ account: a.account.name, total: a.total })),
  };
  return { source, label, lines, recon, expenses, chart, customChart, notes, report };
}

export const industryName = (i: Industry) => INDUSTRY_LABEL[i];
