import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseTelrXls, parsePayoutFile } from "@/lib/parsers/payouts";

function telrShapeXlsx(payoutId: string): Buffer {
  const rows = [
    [`Payout ID ${payoutId}`],
    [],
    ["Transaction", "", "", "", "", "", "", "Authorisation", "", "Settlement", "", "", "", "", ""],
    ["Ref", "Date", "Time", "Type", "CartID", "Description", "Name", "Currency", "Amount", "Currency", "Amount", "MDR", "Fees", "Tax", "Net"],
    ["030100000001", "01/09/2026", "10:00", "Sale", "700001_abc", "Your order", "Test Customer", "AED", 100, "AED", 100, -3, 0, -0.5, 96.5],
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Payout");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("parseTelrXls: defaults to Telr provider and TELR- id prefix (unchanged behavior)", () => {
  const [payout] = parseTelrXls(telrShapeXlsx("9000001"), "payout_9000001.xls");
  assert.equal(payout.provider, "Telr");
  assert.equal(payout.id, "TELR-9000001");
});

test("parseTelrXls: an explicit Stripe provider tags the payout Stripe with a NETWORK- id, not TELR-", () => {
  const [payout] = parseTelrXls(telrShapeXlsx("9000002"), "payout_9000002.xls", "Stripe");
  assert.equal(payout.provider, "Stripe");
  assert.equal(payout.id, "NETWORK-9000002");
  // math is untouched by the provider override — same computation either way
  assert.equal(payout.net, 96.5);
  assert.deepEqual(payout.orderRefs, ["700001"]);
});

test("parsePayoutFile: a Telr-shaped file uploaded with hint=Stripe is tagged Stripe/NETWORK-, not Telr", () => {
  const buf = telrShapeXlsx("9000003");
  const [payout] = parsePayoutFile(buf, "payout_9000003.xls", "Stripe");
  assert.equal(payout.provider, "Stripe");
  assert.equal(payout.id, "NETWORK-9000003");
});

test("parsePayoutFile: the same file with no hint (or hint=Telr) still tags Telr — no regression", () => {
  const buf = telrShapeXlsx("9000004");
  const [noHint] = parsePayoutFile(buf, "payout_9000004.xls");
  assert.equal(noHint.provider, "Telr");
  assert.equal(noHint.id, "TELR-9000004");

  const [telrHint] = parsePayoutFile(buf, "payout_9000004.xls", "Telr");
  assert.equal(telrHint.provider, "Telr");
  assert.equal(telrHint.id, "TELR-9000004");
});
