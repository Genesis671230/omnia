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

// The header below is verbatim from a real Tamara merchant statement
// (Tamara_Omnia-Stores_Invoice_20260703_AED_*.xlsx). Note there is no
// "Merchant Refund ID" column — that name was invented by the original
// fixture, so refund detection silently never fired against a real export.
const TAMARA_REAL_HEADER = [
  "Transaction Date DD/MM/YYYY", "Tamara Order ID", "Merchant Order ID", "Refund Reason",
  "Payment Type", "Order Status", "Currency", "Order Amount", "Event", "Event Amount",
  "Event Date DD/MM/YYYY", "Tamara Fixed Fees", "Tamara Variable Fees %",
  "Tamara Variable Fees", "Total Fees", "VAT Collected by Tamara",
  "Total Payable to Merchant", "Installments",
];

function tamaraRow(o: {
  ref: string; tamaraId: string; refundReason?: string; status?: string;
  gross: string; event: string; fees: string; net: string;
}) {
  return [
    "03/07/2026", o.tamaraId, o.ref, o.refundReason ?? "", "PAY_BY_INSTALMENTS",
    o.status ?? "fully_captured", "AED", o.gross, o.event, o.gross, "03/07/2026",
    "1.50", "5.99%", "0.00", o.fees, "0.00", o.net, "6",
  ];
}

test("parseTamaraXlsx: real-export layout — a Refunded event is flagged and nets negative", () => {
  const buf = xlsxBuffer([
    TAMARA_REAL_HEADER,
    tamaraRow({ ref: "WA4001", tamaraId: "tam_a", gross: "200.00", event: "Captured", fees: "10.00", net: "190.00" }),
    tamaraRow({ ref: "WA4002", tamaraId: "tam_b", gross: "80.00", event: "Refunded", status: "refunded", fees: "4.00", net: "76.00" }),
  ]);

  const [payout] = parseTamaraXlsx(buf, "tamara.xlsx");
  const sale = payout.transactions!.find((t) => t.ref === "WA4001")!;
  const refund = payout.transactions!.find((t) => t.ref === "WA4002")!;

  assert.equal(sale.isRefund, false);
  assert.equal(refund.isRefund, true);
  assert.equal(refund.quality, "refund");
  assert.equal(refund.netShare, -76.00);
  // 190.00 + (-76.00) — a refund must reduce the payout, never inflate it.
  assert.equal(payout.net, 114.00);
  const sumNetShares = +payout.transactions!.reduce((s, t) => s + t.netShare, 0).toFixed(2);
  assert.equal(sumNetShares, payout.net);
});

test("parseTamaraXlsx: real-export layout — a populated Refund Reason also marks a refund", () => {
  const buf = xlsxBuffer([
    TAMARA_REAL_HEADER,
    tamaraRow({ ref: "WA4003", tamaraId: "tam_c", refundReason: "customer returned item", gross: "50.00", event: "Captured", fees: "2.00", net: "48.00" }),
  ]);

  const [payout] = parseTamaraXlsx(buf, "tamara.xlsx");
  assert.equal(payout.transactions![0].isRefund, true);
  assert.equal(payout.net, -48.00);
});

test("parseTamaraXlsx: real-export layout — an all-captured statement reports no refunds", () => {
  const buf = xlsxBuffer([
    TAMARA_REAL_HEADER,
    tamaraRow({ ref: "WA4004", tamaraId: "tam_d", gross: "2042.85", event: "Captured", fees: "123.87", net: "1912.79" }),
    tamaraRow({ ref: "WA4005", tamaraId: "tam_e", gross: "754.50", event: "Captured", fees: "46.69", net: "705.48" }),
  ]);

  const [payout] = parseTamaraXlsx(buf, "tamara.xlsx");
  assert.equal(payout.transactions!.filter((t) => t.isRefund).length, 0);
  // hand-computed from the real statement's first two rows: 1912.79 + 705.48
  assert.equal(payout.net, 2618.27);
});
