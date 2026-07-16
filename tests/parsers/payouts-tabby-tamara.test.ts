import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseTabbyXlsx, parseTamaraXlsx } from "@/lib/parsers/payouts";

function xlsxBuffer(rows: (string | number)[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("parseTabbyXlsx: transactions[] sums to exactly the aggregate net, refund shares are negative", () => {
  const buf = xlsxBuffer([
    ["Statement # TabbyTEST"],
    ["Order Number", "Order Amount", "Transferred amount", "Total deduction", "Currency", "Type"],
    ["SA1001", "100", "95", "5", "SAR", "Sale"],
    ["SA1002", "50", "-47.50", "2.50", "SAR", "Refund"],
  ]);

  const [payout] = parseTabbyXlsx(buf, "tabby.xlsx");
  const sumNetShares = +payout.transactions!.reduce((s, t) => s + t.netShare, 0).toFixed(2);

  assert.equal(sumNetShares, payout.net);
  const sale = payout.transactions!.find((t) => t.ref === "SA1001")!;
  const refund = payout.transactions!.find((t) => t.ref === "SA1002")!;
  assert.equal(sale.isRefund, false);
  assert.equal(sale.quality, "clean");
  assert.equal(refund.isRefund, true);
  assert.equal(refund.quality, "refund");
  assert.ok(refund.netShare < 0);
});

test("parseTabbyXlsx: a duplicated order ref sums its shares instead of overwriting", () => {
  const buf = xlsxBuffer([
    ["Statement # TabbyTEST"],
    ["Order Number", "Order Amount", "Transferred amount", "Total deduction", "Currency", "Type"],
    ["SA2001", "50", "48", "2", "SAR", "Sale"],
    ["SA2001", "50", "48", "2", "SAR", "Sale"],
  ]);

  const [payout] = parseTabbyXlsx(buf, "tabby.xlsx");
  assert.equal(payout.transactions!.length, 1);
  const tx = payout.transactions![0];
  assert.equal(tx.quality, "multi");
  assert.equal(+(tx.netShare).toFixed(2), +(payout.net).toFixed(2));
});

test("parseTamaraXlsx: transactions[] sums to exactly the aggregate net", () => {
  const buf = xlsxBuffer([
    ["Merchant Order ID", "Tamara Order ID", "Order Amount", "Total Fees", "Total Payable to Merchant", "Currency", "Merchant Refund ID"],
    ["WA3001", "tam_1", "200", "10", "190", "AED", ""],
    ["WA3002", "tam_2", "80", "4", "76", "AED", ""],
  ]);

  const [payout] = parseTamaraXlsx(buf, "tamara.xlsx");
  const sumNetShares = +payout.transactions!.reduce((s, t) => s + t.netShare, 0).toFixed(2);

  assert.equal(sumNetShares, payout.net);
  assert.equal(payout.transactions!.length, 2);
});
