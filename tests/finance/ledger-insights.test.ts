import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dailyFlow, deductionsBySource, gatewayOf, ledgerTotals, summarizeAccounts,
  type LedgerAccountInfo, type LedgerLine,
} from "@/lib/reconciliation/ledger-insights";
import { monthRange, pickWatchList } from "@/lib/integrations/zoho-ledger";

const acct = (id: string, name: string, group: LedgerAccountInfo["group"], balance: number | null = null): LedgerAccountInfo =>
  ({ account_id: id, name, type: "x", group, balance, currency: "AED" });
let n = 0;
const line = (accountId: string, date: string, debit: number, credit: number, extra: Partial<LedgerLine> = {}): LedgerLine => ({
  id: String(n++), accountId, date, type: "", typeLabel: "", txnId: "", entry: "", ref: "", payee: "", desc: "",
  offset: "", debit, credit, linked: null, zohoRec: "", ...extra,
});

const ACCOUNTS = [
  acct("tabby", "TABBY AED", "clearing", 500),
  acct("sales", "Sales", "sales"),
  acct("fees", "Payment Gateway Charges", "fees"),
  acct("vat", "Input VAT", "tax"),
  acct("fx", "Exchange gain or loss (purchase)", "fx"),
  acct("sib", "Sharjah Islamic Bank - 12043598001", "bank", 1000),
];
const LINES = [
  line("sales", "2026-09-02", 0, 1050),
  line("sales", "2026-09-02", 50, 0), // a reversal
  line("tabby", "2026-09-02", 1000, 0, { linked: true }),
  line("tabby", "2026-09-05", 0, 900, { linked: false }),
  line("fees", "2026-09-05", 95.24, 0, { offset: "TABBY AED" }),
  line("vat", "2026-09-05", 4.76, 0, { offset: "TABBY AED" }),
  line("fx", "2026-09-06", 3, 0, { offset: "TABBY AED" }),
  line("sib", "2026-09-05", 900, 0),
];

test("summaries use each account's natural sign and derive opening from the live balance", () => {
  const s = summarizeAccounts(ACCOUNTS, LINES, { isCurrentMonth: true });
  const tabby = s.find((x) => x.account_id === "tabby")!;
  assert.equal(tabby.net, 100); // 1000 in − 900 out
  assert.equal(tabby.opening, 400); // 500 now − 100 movement
  assert.equal(tabby.unlinked, 1);
  const sales = s.find((x) => x.account_id === "sales")!;
  assert.equal(sales.net, 1000); // credit-natured
  assert.equal(sales.opening, null);
});

test("opening is not claimed for a past month", () => {
  const s = summarizeAccounts(ACCOUNTS, LINES, { isCurrentMonth: false });
  assert.equal(s.find((x) => x.account_id === "tabby")!.opening, null);
});

test("totals: sales, clearing in/out, fees, VAT, FX gain-positive", () => {
  const t = ledgerTotals(summarizeAccounts(ACCOUNTS, LINES, { isCurrentMonth: true }));
  assert.equal(t.sales, 1000);
  assert.equal(t.clearingIn, 1000);
  assert.equal(t.clearingOut, 900);
  assert.equal(t.openClearing, 500);
  assert.equal(t.fees, 95.24);
  assert.equal(t.inputVat, 4.76);
  assert.equal(t.fxNet, -3); // a debit to FX is a loss
  assert.equal(t.unlinked, 1);
});

test("deductions are attributed to the clearing account they went through", () => {
  const d = deductionsBySource(ACCOUNTS, LINES);
  assert.deepEqual(d, [{ source: "TABBY AED", gateway: "Tabby", fees: 95.24, vat: 4.76, fxLoss: 3, total: 103 }]);
});

test("daily flow covers every day of the month and ignores other accounts", () => {
  const days = dailyFlow(ACCOUNTS, LINES, monthRange("2026-09"));
  assert.equal(days.length, 30);
  const d2 = days.find((p) => p.day === "2026-09-02")!;
  assert.deepEqual([d2.sales, d2.clearingIn, d2.bankIn], [1000, 1000, 0]);
  assert.equal(days.find((p) => p.day === "2026-09-05")!.bankIn, 900);
});

test("gatewayOf maps real Zoho clearing account names", () => {
  assert.equal(gatewayOf("TABBY KSA"), "Tabby");
  assert.equal(gatewayOf("TAMARA KSA"), "Tamara");
  assert.equal(gatewayOf("Stripe Payment getaway"), "Stripe");
  assert.equal(gatewayOf("Telr Gateway"), "Telr");
  assert.equal(gatewayOf("Checkout - AED"), "Checkout");
  assert.equal(gatewayOf("ON TRACK"), "COD");
  assert.equal(gatewayOf("Petty Cash"), "Unclassified");
});

test("watch-list: clearing + named accounts, skips dead zero-balance couriers, clearing first", () => {
  const list = pickWatchList(
    [
      { account_id: "1", account_name: "Fetchr", account_type: "payment_clearing", currency_code: "AED", balance: 0 },
      { account_id: "2", account_name: "TABBY QTR", account_type: "payment_clearing", currency_code: "AED", balance: 0 },
      { account_id: "3", account_name: "Sharjah Islamic Bank", account_type: "bank", currency_code: "AED", balance: 10 },
    ],
    [
      { account_id: "9", account_name: "Sales", account_type: "income" },
      { account_id: "10", account_name: "Payment Gateway Charges", account_type: "expense" },
      { account_id: "11", account_name: "Office Supplies", account_type: "expense" },
    ],
  );
  assert.deepEqual(list.map((a) => [a.name, a.group]), [
    ["TABBY QTR", "clearing"], // zero balance but a gateway — kept
    ["Payment Gateway Charges", "fees"],
    ["Sharjah Islamic Bank", "bank"],
    ["Sales", "sales"],
  ]);
});

test("monthRange handles month lengths", () => {
  assert.deepEqual(monthRange("2026-09"), { start: "2026-09-01", end: "2026-09-30" });
  assert.deepEqual(monthRange("2028-02"), { start: "2028-02-01", end: "2028-02-29" });
  assert.throws(() => monthRange("2026-9"));
});
