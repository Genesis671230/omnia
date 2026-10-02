// Dispatch reconciliation → .xlsx. Summary, every order with the three
// amounts and the full sheet row, then one sheet per problem plus the
// breakdowns ops asked for: cancelled & refunds, exchanges, timing
// differences, foreign currency.

import ExcelJS from "exceljs";
import type { TwRow, TwStatus, TwSummary } from "./three-way";
import { TW_ORDER } from "./three-way";

export const STATUS_LABEL: Record<TwStatus, string> = {
  missing_in_sheet: "Missing in dispatch sheet",
  cancel_mismatch: "Cancel/refund mismatch",
  sheet_only: "In sheet, not a sale",
  amount_diff: "Amounts differ",
  duplicate_in_sheet: "Duplicate in sheet",
  no_invoice: "No Zoho invoice",
  exchange: "Exchange / repair shipment",
  other_month: "Store order in another month",
  cancelled_refunded: "Cancelled / refunded (agree)",
  ok: "All three agree",
};

const COLS: Partial<ExcelJS.Column>[] = [
  { header: "Status", key: "status", width: 26 }, { header: "Why", key: "reason", width: 48 },
  { header: "Order", key: "order", width: 12 }, { header: "Store", key: "store", width: 7 }, { header: "Lane", key: "lane", width: 8 },
  { header: "Customer", key: "customer", width: 24 }, { header: "Country", key: "country", width: 8 }, { header: "Gateway", key: "gateway", width: 13 },
  { header: "Store status", key: "fin", width: 15 }, { header: "Store order day", key: "storeDay", width: 13 },
  { header: "Sheet day", key: "sheetDay", width: 12 }, { header: "Sheet time", key: "sheetTime", width: 9 }, { header: "Days apart", key: "timing", width: 10 },
  { header: "Store currency", key: "scur", width: 9 }, { header: "Store amount (orig.)", key: "sorig", width: 13 }, { header: "Store AED", key: "ours", width: 12 },
  { header: "Zoho invoiced AED", key: "verified", width: 14 }, { header: "Zoho invoice(s)", key: "inv", width: 22 },
  { header: "Sheet type", key: "kind", width: 14 }, { header: "Sheet sale type", key: "saleType", width: 14 },
  { header: "Sheet currency", key: "shcur", width: 9 }, { header: "Sheet amount (orig.)", key: "shorig", width: 13 }, { header: "Exc rate", key: "rate", width: 8 },
  { header: "Sheet original AED", key: "sheetAed", width: 13 }, { header: "Sheet left AED", key: "left", width: 12 }, { header: "Cancelled / refunded AED", key: "refunded", width: 14 },
  { header: "Refund date", key: "refundDate", width: 12 }, { header: "Sheet comment", key: "comments", width: 42 },
  { header: "Payment authorised", key: "auth", width: 14 }, { header: "Payment status", key: "pay", width: 16 }, { header: "Received on", key: "recv", width: 30 },
  { header: "Fee deducted", key: "fee", width: 11 }, { header: "Fee %", key: "feePct", width: 8 }, { header: "After deduction", key: "bal", width: 13 },
  { header: "Voucher #", key: "voucher", width: 10 }, { header: "OT invoice #", key: "ot", width: 10 }, { header: "Delivery by", key: "delivery", width: 11 },
  { header: "Shipment status", key: "ship", width: 13 }, { header: "Sales person", key: "sales", width: 12 },
  { header: "Sheet", key: "source", width: 16 }, { header: "Tab", key: "tab", width: 8 }, { header: "Row(s)", key: "row", width: 10 },
  { header: "Exchange / repair shipments", key: "shipments", width: 36 },
];
const MONEY = ["sorig", "ours", "verified", "shorig", "sheetAed", "left", "refunded", "fee", "bal"];

function addRows(ws: ExcelJS.Worksheet, rows: TwRow[]) {
  ws.columns = COLS;
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A1A4A" } };
  ws.views = [{ state: "frozen", xSplit: 3, ySplit: 1 }];
  for (const r of rows) {
    const s = r.sheet[0] ?? r.shipments[0];
    ws.addRow({
      status: STATUS_LABEL[r.status], reason: r.reason, order: r.order, store: r.store, lane: r.lane === "Local" ? "Local" : "SMSA",
      customer: r.customer, country: r.country, gateway: r.gateway, fin: r.financialStatus,
      storeDay: r.storeDay, sheetDay: r.sheetDay, sheetTime: s?.time ?? "", timing: r.timingDays,
      scur: r.storeCurrency, sorig: r.storeOriginal, ours: r.oursAed, verified: r.verifiedAed, inv: r.invoices.join(", "),
      kind: r.sheetKind ?? "", saleType: s?.saleType ?? "", shcur: r.sheetCurrency, shorig: r.sheetOriginal, rate: s?.exchangeRate,
      sheetAed: r.sheetAed, left: r.sheetLeftAed, refunded: r.sheetRefundedAed, refundDate: s?.refundDate ?? "", comments: s?.comments ?? "",
      auth: s?.paymentAuthorised ?? "", pay: s?.paymentStatus ?? "", recv: s?.receivedOn ?? "", fee: s?.feeDeducted, feePct: s?.feePct ?? "",
      bal: s?.balanceReceived, voucher: s?.voucher ?? "", ot: s?.otInvoice ?? "", delivery: s?.deliveryBy ?? "", ship: s?.shipmentStatus ?? "",
      sales: s?.salesPerson ?? "", source: s?.source ?? "", tab: s?.tab ?? "", row: [...r.sheet, ...r.shipments].map((x) => x.row).join(", "),
      shipments: r.shipments.map((x) => `${x.saleType || x.kind} ${x.day ?? ""} AED ${x.amountAed ?? 0}`).join(" · "),
    });
  }
  for (const k of MONEY) ws.getColumn(k).numFmt = "#,##0.00";
  ws.autoFilter = { from: "A1", to: { row: 1, column: COLS.length } };
}

export async function threeWayXlsx(rows: TwRow[], summary: TwSummary, label: string, sources: string[] = []): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sum = wb.addWorksheet("Summary");
  sum.columns = [{ width: 34 }, { width: 12 }, { width: 18 }, { width: 18 }];
  sum.addRow([`Dispatch reconciliation · ${label}`]).font = { bold: true, size: 14 };
  sum.addRow([`Dispatch sheets read: ${sources.join(", ") || "—"}`]);
  sum.addRow([]);
  sum.addRow(["Source", "Orders", "AED"]).font = { bold: true };
  sum.addRow(["Store (counted sales)", summary.ours.orders, summary.ours.aed]);
  sum.addRow(["Zoho invoiced (verified)", summary.verified.orders, summary.verified.aed]);
  sum.addRow(["Dispatch sheet — original sales", summary.sheet.orders, summary.sheet.aed]);
  sum.addRow(["Dispatch sheet — cancelled / refunded", "", summary.sheet.refundedAed]);
  sum.addRow(["Dispatch sheet — left after refunds", "", summary.sheet.leftAed]);
  sum.addRow([]);
  sum.addRow(["Status", "Orders", "Store AED", "Sheet AED"]).font = { bold: true };
  for (const st of TW_ORDER) { const v = summary.byStatus[st]; if (v.orders) sum.addRow([STATUS_LABEL[st], v.orders, v.oursAed, v.sheetAed]); }
  sum.addRow([]);
  sum.addRow(["Lane", "Sales", "Logged in sheet", "Store AED"]).font = { bold: true };
  for (const [k, v] of Object.entries(summary.byLane)) sum.addRow([k === "Local" ? "Local orders (OnTrack, UAE)" : "SMSA Orders (KSA & Gulf)", v.orders, v.inSheet, v.oursAed]);
  sum.addRow([]);
  sum.addRow(["Logged on a different day", summary.timing.differentDay]);
  sum.addRow(["…in a different month", summary.timing.differentMonth]);
  sum.addRow(["Foreign-currency orders", summary.foreignCurrency]);
  sum.addRow(["Exchange / repair shipments", summary.shipments]);
  sum.getColumn(3).numFmt = "#,##0.00";
  sum.getColumn(4).numFmt = "#,##0.00";

  addRows(wb.addWorksheet("All orders"), rows);
  for (const st of TW_ORDER.filter((s) => s !== "ok")) {
    const list = rows.filter((r) => r.status === st);
    if (list.length) addRows(wb.addWorksheet(STATUS_LABEL[st].replace(/[/\\?*[\]:]/g, "-").slice(0, 31)), list);
  }
  const extra: [string, TwRow[]][] = [
    ["Refunds (all)", rows.filter((r) => (r.sheetRefundedAed ?? 0) > 0 || /refund/.test(r.financialStatus))],
    ["Timing differences", rows.filter((r) => r.timingDays)],
    ["Foreign currency", rows.filter((r) => r.storeCurrency !== "AED" || r.sheetCurrency !== "AED")],
  ];
  for (const [name, list] of extra) if (list.length) addRows(wb.addWorksheet(name), list);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
