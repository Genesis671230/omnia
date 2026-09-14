import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSheetSource } from "@/lib/finance/payments-sheet";

// Ops keeps ONE spreadsheet per month, registered in payment_sheet_months.
// GOOGLE_SHEETS_PAYMENTS_SPREADSHEET_ID names exactly one of them, so any
// surface that reaches for it directly shows that single month forever. The
// invoices workbench did exactly that: pinned to the August sheet, its chart,
// gateway tables and "From payments sheet" matcher could not see September's
// rows at all.

test("a registry with months always wins over the pinned env sheet", () => {
  assert.equal(resolveSheetSource(null, 3), "registry");
  assert.equal(resolveSheetSource(null, 1), "registry");
  assert.equal(resolveSheetSource("", 3), "registry");
  assert.equal(resolveSheetSource("   ", 3), "registry");
  assert.equal(resolveSheetSource(undefined, 3), "registry");
});

test("the pinned env sheet is only for an install with no months registered", () => {
  assert.equal(resolveSheetSource(null, 0), "env-default");
  assert.equal(resolveSheetSource(undefined, 0), "env-default");
  assert.equal(resolveSheetSource("", 0), "env-default");
});

test("an explicitly pasted sheet wins over everything — that is the point of pasting one", () => {
  assert.equal(resolveSheetSource("1AbCdEf", 0), "explicit");
  assert.equal(resolveSheetSource("1AbCdEf", 3), "explicit");
  assert.equal(resolveSheetSource("  1AbCdEf  ", 3), "explicit");
});

test("whitespace is not an explicit sheet", () => {
  // A blank input box must fall through to the registry, not read a sheet
  // called "   " and fail.
  assert.notEqual(resolveSheetSource("   ", 2), "explicit");
  assert.notEqual(resolveSheetSource("\t\n", 2), "explicit");
});
