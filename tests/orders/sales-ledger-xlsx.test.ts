import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { computeSalesLedger, type LedgerPayoutInput } from "@/lib/orders/sales-ledger";
import { buildDayWorkbook, buildMonthWorkbook } from "@/lib/orders/sales-ledger-xlsx";

const ledger = computeSalesLedger({
  month: "2026-09",
  orders: [
    { uid: "UAE_1", store_id: "UAE", order_number: "3439", order_date: "2026-09-10T08:00:00Z", customer_name: "A", gateway: "Shopify Payments", gross_aed: 988.21, financial_status: "paid", payout_id: null, payout_status: null },
    { uid: "MAIN_2", store_id: "MAIN", order_number: "OS3769", order_date: "2026-09-10T09:00:00Z", customer_name: "B", gateway: "Tabby", gross_aed: 964.5, financial_status: "paid", payout_id: null, payout_status: null },
  ],
  payouts: [{
    id: "SHOPIFY-UAE-1", gateway: "Shopify Payments", net_amount: 930.53, gross_amount: 988.21, fee_amount: 57.68, source: "export.csv",
    transactions: [{ order_ref: "3439", is_refund: false, quality: "clean", gross_aed: 988.21, fee_aed: 57.68, net_aed: 930.53 }],
  }] as LedgerPayoutInput[],
  recon: [{ payout_id: "SHOPIFY-UAE-1", bank_line_id: "B1", match_status: "SETTLED", confirmed_by: null, delta: 0 }],
  bank: [{ id: "B1", statement_date: "2026-09-12T00:00:00", amount: 930.53, reference: "FT1", description: "" }],
  stores: ["UAE", "KSA", "WA", "WOO", "MAIN"],
});

async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

/** Rows of a sheet as objects keyed by header text. */
function rowsOf(ws: ExcelJS.Worksheet): Record<string, unknown>[] {
  const header = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? ""));
  const out: Record<string, unknown>[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const vals = row.values as unknown[];
    out.push(Object.fromEntries(header.map((h, j) => [h, vals[j] ?? null]).filter(([h]) => h)));
  });
  return out;
}

test("day export: each order is verifiable — order amount, payout line, fee, net, bank", async () => {
  const wb = await load(await buildDayWorkbook(ledger.days.find((d) => d.day === "2026-09-10")!));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Summary", "Orders", "Payouts", "How to verify"]);
  const rows = rowsOf(wb.getWorksheet("Orders")!);

  const uae = rows.find((r) => r["Order #"] === "3439")!;
  assert.equal(uae["Order amount (AED)"], 988.21);
  assert.equal(uae["Payment method (store)"], "Shopify Payments");
  assert.equal(uae["Payout ID"], "SHOPIFY-UAE-1");
  assert.equal(uae["Payout line gross (AED)"], 988.21);
  assert.equal(uae["Fee (AED)"], 57.68);
  assert.equal(uae["Net payout for this order (AED)"], 930.53);
  assert.equal(uae["Order vs payout gross (AED)"], 0);
  assert.equal(uae["Fee source"], "Payout file (this order's line)");
  assert.equal(uae["Bank credit date"], "2026-09-12");
  assert.equal(uae["Bank reference"], "FT1");
  assert.equal(uae["Net received in bank (AED)"], 930.53);

  const main = rows.find((r) => r["Order #"] === "OS3769")!;
  assert.equal(main["Payout line gross (AED)"], null); // no file → blank, never a made-up line
  assert.equal(main["Net received in bank (AED)"], null);
  assert.equal(main["Fee source"], "Estimated at gateway rate (no file yet)");
  assert.equal(main["Status"], "Payout file not uploaded");

  const total = rows.find((r) => r["Order date (Dubai)"] === "Total")!;
  assert.equal(total["Order amount (AED)"], 1952.71);

  const payout = rowsOf(wb.getWorksheet("Payouts")!)[0];
  assert.equal(payout["Payout net total (AED)"], 930.53);
  assert.equal(payout["Sum of line nets (AED)"], 930.53);
  assert.equal(payout["Payout total vs lines (AED)"], 0);
  assert.equal(payout["Bank vs payout net (AED)"], 0);
});

test("month export adds Days and Missing payout files sheets", async () => {
  const wb = await load(await buildMonthWorkbook(ledger));
  assert.deepEqual(
    wb.worksheets.map((w) => w.name),
    ["Summary", "Days", "Orders", "Payouts", "Missing payout files", "How to verify"],
  );
  assert.equal(rowsOf(wb.getWorksheet("Missing payout files")!)[0]["Gateway"], "Tabby");
});
