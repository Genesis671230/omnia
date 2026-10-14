import { test } from "node:test";
import assert from "node:assert/strict";
import { demoDataset, reconcile, categoriseBank, payroll, gratuity, einvoiceReadiness, loadTable } from "@/lib/ramza/demo/engine";
import { chartFor, INDUSTRIES, mapToChart, categorise } from "@/lib/ramza/demo/coa";
import { parseCsv, detectKind, day, num } from "@/lib/ramza/demo/csv";

test("every industry demo reconciles: most invoices cleared, every payout lands in the bank, journal balances", () => {
  for (const ind of INDUSTRIES) {
    const ds = demoDataset(ind);
    const r = reconcile(ds);
    assert.ok(r.summary.matchRate > 0.7, `${ind} match rate ${r.summary.matchRate}`);
    assert.equal(r.summary.bankMatched, r.summary.payouts, `${ind}: every payout finds its bank credit`);
    const dr = r.journal.reduce((a, j) => a + j.debit, 0), cr = r.journal.reduce((a, j) => a + j.credit, 0);
    assert.ok(Math.abs(dr - cr) < 0.05 * r.payouts.length + 0.01, `${ind}: journal balances ${dr} vs ${cr}`);
    // gross = fee + vat + net per line
    for (const row of r.rows.filter((x) => x.payoutId && x.status !== "refund")) assert.ok(Math.abs(row.grossAed - row.feeAed - row.vatAed - row.netAed) < 0.05, `${ind} ${row.ref}`);
  }
});

test("demo is deterministic and foreign payouts show an exchange difference", () => {
  assert.deepEqual(reconcile(demoDataset("ecommerce")).summary, reconcile(demoDataset("ecommerce")).summary);
  const r = reconcile(demoDataset("ecommerce"));
  assert.ok(r.summary.currencies.includes("USD"));
  assert.ok(r.payouts.some((p) => p.currency !== "AED" && p.fxAed !== 0));
  assert.ok(r.summary.unpaid > 0 || r.summary.shortPaid > 0, "the demo shows exceptions too");
});

test("bank lines go to the right accounts, and to a visitor's own chart", () => {
  const chart = chartFor("logistics");
  assert.equal(categorise("ENOC FUEL CARD OCT", -100, chart).account.name, "Fuel & tolls (Salik)");
  assert.equal(categorise("WPS SALARY OCT", -100, chart).account.name, "Salaries & wages");
  assert.equal(categorise("TABBY PAYOUT TABBY-AED-1", 100, chart).account.name, "Gateway clearing");
  const own = [{ code: "610", name: "Motor fuel", type: "Expense" as const }, { code: "999", name: "Uncategorised", type: "Expense" as const }];
  assert.equal(mapToChart("Fuel & tolls (Salik)", own)?.code, "610");
  const c = categoriseBank(demoDataset("ecommerce").bank, chartFor("ecommerce"));
  assert.ok(c.autoRate > 0.8);
});

test("gratuity follows 21/30 days of basic and the one-year rule", () => {
  assert.equal(gratuity(3000, 1000, "2026-01-01", "2026-10-01").amount, 0);
  assert.ok(Math.abs(gratuity(3000, 0, "2016-10-01", "2026-10-01").amount - 100 * (21 * 5 + 30 * 5)) < 60);
  assert.ok(payroll(demoDataset("construction").employees, "2026-10-31").totals.gross > 0);
});

test("e-invoice readiness flags missing buyer TRNs", () => {
  const r = einvoiceReadiness(demoDataset("wholesale").invoices, true);
  assert.ok(r.score > 0 && r.score < 100);
  assert.ok(r.fields.find((f) => f.key === "buyerTrn")!.missing > 0);
});

test("CSV: parse, detect and load a Stripe-style payout export", () => {
  const t = parseCsv('id,Created (UTC),Amount,Fee,Net,Currency,Description\nch_1,2026-10-02 10:00,"1,000.00",29.30,970.70,usd,Order SB1040\nch_2,02/10/2026,50,1.75,48.25,usd,SB1041\n');
  assert.equal(detectKind(t), "payout");
  const l = loadTable("stripe-payouts.csv", t, "ecommerce");
  assert.equal(l.gatewayGuess, "Stripe");
  assert.equal(l.payouts![0].gross, 1000);
  assert.equal(l.payouts![1].date, "2026-10-02");
  assert.equal(detectKind(parseCsv("Date,Description,Debit,Credit\n01/10/2026,DEWA,100,\n")), "bank");
  assert.equal(detectKind(parseCsv("Code,Account Name,Type\n6100,Rent,Expense\n")), "coa");
  assert.equal(day("5 Oct 2026"), "2026-10-05");
  assert.equal(num("(1,250.50)"), -1250.5);
});
