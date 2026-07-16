import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseCodCsv, parseCodXlsx } from "@/lib/parsers/payouts";

function xlsxBuffer(rows: (string | number)[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("parseCodCsv: sums COD Amount column exactly and extracts order refs", () => {
  const csv = [
    "Invoice No,Order Number,COD Amount",
    "16964,5001,1230.50",
    "16964,5002,1231.50",
  ].join("\n");

  const [payout] = parseCodCsv(csv, "on-track-delivery.csv");

  assert.equal(payout.provider, "COD");
  assert.equal(payout.id, "COD-16964");
  assert.equal(payout.net, 2462.00); // hand-computed: 1230.50 + 1231.50
  assert.deepEqual(payout.orderRefs, ["5001", "5002"]);
  // AED-native by design — must never guess an FX rate for COD cash.
  assert.equal(payout.originalCurrency, undefined);
  assert.equal(payout.netOriginal, undefined);
});

test("parseCodXlsx: finds the header row after a banner, extracts invoice number from the banner text", () => {
  const buf = xlsxBuffer([
    ["ON TRACK DELIVERY SERVICES — INVOICE #16964"],
    [""],
    ["Order No.", "Amount Collected"],
    ["5001", "1230.50"],
    ["5002", "1231.50"],
  ]);

  const [payout] = parseCodXlsx(buf, "remittance.xlsx");

  assert.equal(payout.id, "COD-16964");
  assert.equal(payout.net, 2462.00);
  assert.deepEqual(payout.orderRefs, ["5001", "5002"]);
});

test("parseCodXlsx: falls back to the filename for the invoice number when no banner or column has one", () => {
  const buf = xlsxBuffer([
    ["Order No.", "Net Amount"],
    ["5001", "500"],
  ]);

  const [payout] = parseCodXlsx(buf, "cod-statement-16999.xlsx");

  assert.equal(payout.id, "COD-16999");
  assert.equal(payout.net, 500);
});

test("parseCodCsv: throws with the seen columns when no amount column is found", () => {
  const csv = ["Order Number,Notes", "5001,foo"].join("\n");
  assert.throws(
    () => parseCodCsv(csv, "bad.csv"),
    /no amount column found in \[order number, notes\]/,
  );
});
