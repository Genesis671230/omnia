//
// Converts the first non-empty sheet of an uploaded XLS/XLSX workbook into
// CSV text, so it runs through the exact same header-synonym CSV parsing
// path (tryParseCsvStatement inside lib/parsers/bank.ts) that already
// handles ENBD/ADCB/Mashreq/generic bank exports — one column-matching
// implementation instead of a second one duplicated for spreadsheets.
import * as XLSX from "xlsx";

export function xlsxToCsvText(buf: Buffer): string {
  const workbook = XLSX.read(buf, { type: "buffer" });
  for (const name of workbook.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]).trim();
    if (csv) return csv;
  }
  return "";
}
