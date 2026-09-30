import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeAccounts, type LedgerAccountInfo, type LedgerLine } from "@/lib/reconciliation/ledger-insights";
import { closeFlags, gatewayRecon } from "@/lib/reconciliation/ledger-close";

const acct = (id: string, name: string, group: LedgerAccountInfo["group"], balance: number | null): LedgerAccountInfo =>
  ({ account_id: id, name, type: "x", group, balance, currency: "AED" });
let n = 0;
const line = (accountId: string, debit: number, credit: number, extra: Partial<LedgerLine> = {}): LedgerLine => ({
  id: String(n++), accountId, date: "2026-09-10", type: "", typeLabel: "", txnId: "", entry: "", ref: "", payee: "",
  desc: "", offset: "", debit, credit, linked: null, zohoRec: "", ...extra,
});

const ACCOUNTS = [
  acct("tabby", "TABBY AED", "clearing", 0),
  acct("stripe", "Stripe Payment getaway", "clearing", -360.5),
  acct("sib", "Sharjah Islamic Bank - 12043598001", "bank", 1000),
];
const LINES = [
  line("tabby", 1000, 0, { linked: true }),
  line("tabby", 0, 1000, { linked: true }),
  line("stripe", 300, 0, { linked: true }),
  line("stripe", 0, 660.5, { linked: false }),
  line("sib", 660.5, 0, { linked: true, zohoRec: "reconciled" }),
  line("sib", 0, 50, { linked: false, zohoRec: "unreconciled" }),
];
const summaries = summarizeAccounts(ACCOUNTS, LINES, { isCurrentMonth: true });

test("gateway recon: fully linked + zero balance is clean; unlinked movement is pending", () => {
  const g = gatewayRecon(summaries, LINES);
  const tabby = g.find((x) => x.name === "TABBY AED")!;
  assert.equal(tabby.status, "clean");
  assert.equal(tabby.pct, 100);
  const stripe = g.find((x) => x.name.startsWith("Stripe"))!;
  assert.equal(stripe.reconciled, 300);
  assert.equal(stripe.pending, 660.5);
  assert.equal(stripe.unlinkedCount, 1);
  assert.equal(stripe.status, "attention"); // 31% reconciled
  assert.equal(g[0].name, stripe.name, "most pending first");
});

test("close flags: statement gaps first, then gateway residuals, orphans and credit notes", () => {
  const flags = closeFlags({
    summaries, lines: LINES,
    statement: [
      { id: "b1", date: "2026-09-10", amount: 660.5, direction: "credit", reference: "FT1", description: "", inZoho: true, zohoState: "in_zoho" },
      { id: "b2", date: "2026-09-12", amount: 785.79, direction: "credit", reference: "FT26267TVX45", description: "", inZoho: false, zohoState: "not_found" },
    ],
    openCreditNotes: [
      { creditnote_id: "1", creditnote_number: "CN-1", date: "2026-09-03", customer_name: "A", reference_number: "", total: 120, balance: 120 },
      { creditnote_id: "2", creditnote_number: "CN-2", date: "2026-09-04", customer_name: "B", reference_number: "", total: 50, balance: 0 },
    ],
  });
  const ids = flags.map((f) => f.id);
  assert.equal(flags[0].severity, "critical");
  assert.ok(ids.includes("statement-not-in-zoho"));
  assert.equal(flags.find((f) => f.id === "statement-not-in-zoho")!.amount, 785.79);
  assert.ok(ids.includes("bank-orphan-sib"), "Zoho bank line with no statement line");
  assert.ok(ids.includes("bank-unreconciled-sib"));
  assert.ok(ids.includes("residual-stripe"));
  assert.ok(!ids.includes("residual-tabby"), "a zero balance is not a flag");
  assert.deepEqual(flags.find((f) => f.id === "clearing-unlinked-stripe")!.focus, { accountId: "stripe", onlyUnlinked: true });
  const cn = flags.find((f) => f.id === "open-credit-notes")!;
  assert.equal(cn.count, 1, "fully applied credit notes don't count");
  assert.equal(cn.amount, 120);
  assert.deepEqual(flags.map((f) => f.severity), [...flags.map((f) => f.severity)].sort((a, b) => ["critical", "warning", "info"].indexOf(a) - ["critical", "warning", "info"].indexOf(b)));
});
