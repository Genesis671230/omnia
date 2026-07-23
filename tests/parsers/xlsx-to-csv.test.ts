import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { xlsxToCsvText } from "@/lib/parsers/xlsx-to-csv";
import { parseBankStatement } from "@/lib/parsers/bank";

function bufferFromRows(rows: (string | number)[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("xlsxToCsvText: converts a workbook's first sheet to CSV text", () => {
  const buf = bufferFromRows([
    ["Date", "Description", "Credit", "Debit"],
    ["11/07/2026", "ON TRACK DELIVERY SERVICES", 2462, ""],
  ]);
  const csv = xlsxToCsvText(buf);
  assert.ok(csv.includes("Date,Description,Credit,Debit"));
  assert.ok(csv.includes("ON TRACK DELIVERY SERVICES"));
});

test("xlsxToCsvText: skips a genuinely empty leading sheet and uses the first non-empty one", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), "Empty");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["Date", "Description", "Credit", "Debit"], ["11/07/2026", "SALARY", "", 5000]]),
    "Statement",
  );
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const csv = xlsxToCsvText(buf);
  assert.ok(csv.includes("SALARY"));
});

test("xlsxToCsvText -> parseBankStatement: an XLSX statement parses exactly like its CSV equivalent", () => {
  const buf = bufferFromRows([
    ["Date", "Description", "Credit", "Debit"],
    [
      "11/07/2026",
      "KWD Inward Telex Payment/L.L.C ON TRACK DELIVERY SERVICES//REF/invoice 16964/FT26192VXFKW FT26192VXFKW",
      2462,
      "",
    ],
  ]);
  const csv = xlsxToCsvText(buf);
  const { credits } = parseBankStatement(csv, "statement.csv");
  assert.equal(credits.length, 1);
  assert.equal(credits[0].amount, 2462);
  assert.equal(credits[0].reference, "FT26192VXFKW");
});
