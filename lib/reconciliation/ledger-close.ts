/* Month-end close report for the Ledger tab — pure, client-safe.
 *
 * Answers the accountant's two questions without an export:
 *   1. per gateway: how much of this month's clearing movement is tied to a
 *      payout Omnia reconciled, and how much is still pending;
 *   2. what stops the books closing cleanly — every flag carries the amount,
 *      the count, a concrete next step, and (where it applies) the explorer
 *      filter that lists exactly the offending lines.
 */

import { gatewayOf, type AccountSummary, type LedgerLine } from "./ledger-insights";

export type StatementLine = {
  id: string;
  date: string | null;
  amount: number;
  direction: "credit" | "debit";
  reference: string;
  description: string;
  /** Recorded in Zoho — from the app's statement↔Zoho check, else amount ± 3 days. */
  inZoho: boolean;
  /** That check's state (in_zoho | uncategorized | amount_differs | not_found), null if never checked. */
  zohoState: string | null;
};

export type OpenCreditNote = {
  creditnote_id: string; creditnote_number: string; date: string; customer_name: string;
  reference_number: string; total: number; balance: number;
};

export type MissingFee = { orderNumber: string; gateway: string; fee: number; expenseId: string };

export type GatewayRecon = {
  accountId: string;
  name: string;
  gateway: string;
  moneyIn: number;
  moneyOut: number;
  reconciled: number;
  pending: number;
  unlinkedCount: number;
  balance: number | null;
  /** reconciled ÷ (in + out), 0–100. */
  pct: number;
  status: "clean" | "pending" | "attention";
};

export type CloseFlag = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  amount: number;
  count: number;
  suggestion: string;
  /** Opens the explorer on the lines behind this flag. */
  focus?: { accountId: string; onlyUnlinked: boolean };
  /** Small list of the items themselves, for flags with no ledger lines. */
  items?: { label: string; amount: number; note?: string }[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const RESIDUAL_AED = 1;

export function gatewayRecon(summaries: AccountSummary[], lines: LedgerLine[]): GatewayRecon[] {
  const byAcct = new Map<string, LedgerLine[]>();
  for (const l of lines) byAcct.set(l.accountId, [...(byAcct.get(l.accountId) ?? []), l]);
  return summaries
    .filter((s) => s.group === "clearing" && (s.lineCount > 0 || Math.abs(s.balance ?? 0) >= RESIDUAL_AED))
    .map((s) => {
      const ls = byAcct.get(s.account_id) ?? [];
      let reconciled = 0, pending = 0, unlinkedCount = 0;
      for (const l of ls) {
        const amt = l.debit + l.credit;
        if (l.linked) reconciled += amt; else { pending += amt; unlinkedCount += 1; }
      }
      const total = reconciled + pending;
      const pct = total > 0 ? Math.round((reconciled / total) * 1000) / 10 : 100;
      const residual = Math.abs(s.balance ?? 0) >= RESIDUAL_AED;
      const status: GatewayRecon["status"] = unlinkedCount === 0 && !residual ? "clean" : pct < 50 ? "attention" : "pending";
      return {
        accountId: s.account_id, name: s.name, gateway: gatewayOf(s.name),
        moneyIn: s.debit, moneyOut: s.credit, reconciled: r2(reconciled), pending: r2(pending),
        unlinkedCount, balance: s.balance, pct, status,
      };
    })
    .sort((a, b) => b.pending - a.pending);
}

export function closeFlags(input: {
  summaries: AccountSummary[];
  lines: LedgerLine[];
  statement: StatementLine[];
  openCreditNotes: OpenCreditNote[];
  missingFees?: MissingFee[];
}): CloseFlag[] {
  const { summaries, lines, statement, openCreditNotes, missingFees = [] } = input;
  const flags: CloseFlag[] = [];
  const byAcct = new Map<string, LedgerLine[]>();
  for (const l of lines) byAcct.set(l.accountId, [...(byAcct.get(l.accountId) ?? []), l]);

  // Bank: statement ↔ Zoho, both directions.
  const missing = statement.filter((s) => !s.inZoho);
  if (missing.length) {
    flags.push({
      id: "statement-not-in-zoho", severity: "critical",
      title: `${missing.length} bank statement line${missing.length === 1 ? "" : "s"} not recorded in Zoho`,
      amount: r2(missing.reduce((t, s) => t + s.amount, 0)), count: missing.length,
      suggestion: "Refresh the Zoho status in Bank Transactions first (it only updates on refresh), then post what is still missing — payout credits via Reconciliation. Until then Zoho's bank balance won't match the statement.",
      items: [...missing].sort((a, b) => b.amount - a.amount).slice(0, 8).map((s) => ({
        label: `${s.date ?? "—"} · ${s.reference || s.description.slice(0, 40)}`,
        amount: s.direction === "debit" ? -s.amount : s.amount,
        note: s.zohoState === "uncategorized" ? "in Zoho feed, not categorised" : s.zohoState === "amount_differs" ? "amount differs in Zoho" : undefined,
      })),
    });
  }
  for (const s of summaries.filter((x) => x.group === "bank")) {
    const ls = byAcct.get(s.account_id) ?? [];
    const orphan = ls.filter((l) => l.linked === false);
    if (orphan.length && /bank/i.test(s.name) && !/personal|closing/i.test(s.name)) {
      flags.push({
        id: `bank-orphan-${s.account_id}`, severity: "critical",
        title: `${orphan.length} ${s.name} entr${orphan.length === 1 ? "y" : "ies"} in Zoho with no statement line`,
        amount: r2(orphan.reduce((t, l) => t + l.debit + l.credit, 0)), count: orphan.length,
        suggestion: "Usually a duplicate or a wrong date/amount on a manual entry. Compare with the statement; delete or correct in Zoho.",
        focus: { accountId: s.account_id, onlyUnlinked: true },
      });
    }
    const unrec = ls.filter((l) => l.zohoRec && l.zohoRec !== "reconciled");
    if (unrec.length) {
      flags.push({
        id: `bank-unreconciled-${s.account_id}`, severity: "info",
        title: `${unrec.length} ${s.name} line${unrec.length === 1 ? "" : "s"} not yet reconciled in Zoho`,
        amount: r2(unrec.reduce((t, l) => t + l.debit + l.credit, 0)), count: unrec.length,
        suggestion: "Run Zoho's bank reconciliation for the month once the flags above are cleared.",
        focus: { accountId: s.account_id, onlyUnlinked: false },
      });
    }
  }

  // Gateways: residual balances and unlinked movement.
  for (const s of summaries.filter((x) => x.group === "clearing")) {
    const ls = byAcct.get(s.account_id) ?? [];
    const unlinked = ls.filter((l) => l.linked === false);
    if (s.balance != null && Math.abs(s.balance) >= RESIDUAL_AED) {
      flags.push({
        id: `residual-${s.account_id}`, severity: Math.abs(s.balance) >= 1000 ? "warning" : "info",
        title: `${s.name} carries ${s.balance < 0 ? "a negative" : "a"} live balance of ${s.balance.toFixed(2)} (all months)`,
        amount: r2(s.balance), count: 1,
        suggestion: s.balance < 0
          ? "More left the clearing account than came in: a payout or fee booked without its customer payment, or a double transfer."
          : "Customer payments not yet settled out: book the matching payouts, or it is money still in transit at the gateway.",
        focus: unlinked.length ? { accountId: s.account_id, onlyUnlinked: true } : undefined,
      });
    }
    if (unlinked.length) {
      flags.push({
        id: `clearing-unlinked-${s.account_id}`, severity: "warning",
        title: `${unlinked.length} ${s.name} entr${unlinked.length === 1 ? "y" : "ies"} not tied to an Omnia payout`,
        amount: r2(unlinked.reduce((t, l) => t + l.debit + l.credit, 0)), count: unlinked.length,
        suggestion: "Booked by hand in Zoho or from an older flow. Check each against the gateway's payout file; link or correct.",
        focus: { accountId: s.account_id, onlyUnlinked: true },
      });
    }
  }

  // Gateway fees Omnia booked whose Zoho expense has since been deleted.
  if (missingFees.length) {
    flags.push({
      id: "fees-missing-in-zoho", severity: "critical",
      title: `${missingFees.length} gateway fee${missingFees.length === 1 ? "" : "s"} booked by Omnia but missing in Zoho`,
      amount: r2(missingFees.reduce((t, f) => t + f.fee, 0)), count: missingFees.length,
      suggestion: "The expense was deleted in Zoho after posting. Open the order's bank credit in Reconciliation, press \"Check invoices in Zoho\" — the order becomes bookable again — then book it.",
      items: [...missingFees].sort((a, b) => b.fee - a.fee).slice(0, 8)
        .map((f) => ({ label: `#${f.orderNumber} · ${f.gateway}`, amount: f.fee })),
    });
  }

  // Credit notes owed to customers with no refund and no application.
  const cn = openCreditNotes.filter((c) => c.balance >= 0.01);
  if (cn.length) {
    flags.push({
      id: "open-credit-notes", severity: "warning",
      title: `${cn.length} open credit note${cn.length === 1 ? "" : "s"} with no refund or application (all months)`,
      amount: r2(cn.reduce((t, c) => t + c.balance, 0)), count: cn.length,
      suggestion: "Refund each from the gateway's clearing account (Refunds on this payout), or apply it to the customer's next invoice.",
      items: [...cn].sort((a, b) => b.balance - a.balance).slice(0, 8)
        .map((c) => ({ label: `${c.creditnote_number} · ${c.customer_name}`, amount: c.balance, note: c.date })),
    });
  }

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return flags.sort((a, b) => rank[a.severity] - rank[b.severity] || Math.abs(b.amount) - Math.abs(a.amount));
}
