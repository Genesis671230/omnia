// Management report → .xlsx. Built to be handed to management as is:
// a one-page summary (tied to the dashboard), gateways, receivables with
// ageing, refunds with every source side by side, cancellations, exchanges,
// every order, and the list of things the team must fix.
// addManagementSheets() is reused by the Dispatch export.

import ExcelJS from "exceljs";
import { BUCKET_LABEL, type ManagementReport, type MrOrderLine } from "./management-report";

const NAVY = "FF0A1A4A";
const money = "#,##0.00";

function header(ws: ExcelJS.Worksheet, row: number) {
  const r = ws.getRow(row);
  r.font = { bold: true, color: { argb: "FFFFFFFF" } };
  r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
}
function title(ws: ExcelJS.Worksheet, text: string) {
  ws.addRow([text]).font = { bold: true, size: 13 };
}

function summary(wb: ExcelJS.Workbook, r: ManagementReport) {
  const ws = wb.addWorksheet("Management summary");
  ws.columns = [{ width: 52 }, { width: 10 }, { width: 18 }, { width: 14 }];
  ws.addRow([`Sales report · ${r.month} · as of ${r.asOf}`]).font = { bold: true, size: 15 };
  ws.addRow(["Refunds reduce the month the order was placed · official refund = money returned by the gateway · exchanges are never sales · pending COD is receivable with the courier"]).font = { italic: true, color: { argb: "FF64748B" } };
  ws.addRow([]);
  title(ws, "1. Same figure as the dashboard");
  ws.addRow(["", "Orders", "AED"]); header(ws, ws.rowCount);
  ws.addRow(["Dashboard sales", r.fromDashboard.dashboard.orders, r.fromDashboard.dashboard.aed]);
  ws.addRow(["− Cancelled in the dispatch sheet, store not updated", -r.fromDashboard.sheetCancelled.orders, -r.fromDashboard.sheetCancelled.aed]);
  ws.addRow(["+ Fully refunded in the store (a sale that was refunded)", r.fromDashboard.refundedInStore.orders, r.fromDashboard.refundedInStore.aed]);
  ws.addRow(["= Gross sales", r.fromDashboard.grossSales.orders, r.fromDashboard.grossSales.aed]).font = { bold: true };
  ws.addRow([]);
  title(ws, "2. From orders placed to net sales");
  ws.addRow(["", "Orders", "AED", "% of gross"]); header(ws, ws.rowCount);
  const w = r.waterfall;
  const pct = (a: number) => (w.grossSales.aed ? a / w.grossSales.aed : 0);
  ws.addRow(["Orders placed", w.placed.orders, w.placed.aed]);
  ws.addRow(["− Failed / unpaid", w.failedUnpaid.orders, -w.failedUnpaid.aed]);
  ws.addRow([`− Cancelled (${w.cancelled.bySheetOnly} only in the sheet)`, w.cancelled.orders, -w.cancelled.aed]);
  ws.addRow(["= Gross sales", w.grossSales.orders, w.grossSales.aed, 1]).font = { bold: true };
  ws.addRow(["− Refunds (on this month's orders)", w.refunds.orders, -w.refunds.aed, -pct(w.refunds.aed)]);
  ws.addRow(["= Net sales", w.netSales.orders, w.netSales.aed, pct(w.netSales.aed)]).font = { bold: true };
  ws.addRow([]);
  title(ws, "3. Cash");
  ws.addRow(["", "Orders", "AED"]); header(ws, ws.rowCount);
  const t = r.cash.tie;
  ws.addRow(["Received in the bank (after gateway fees)", "", t.receivedAed]);
  ws.addRow(["+ Gateway fees on orders already paid out", "", t.feesOnReceivedAed]);
  ws.addRow(["+ Currency / other differences on those orders", "", t.fxOtherAed]);
  ws.addRow(["− Refunds on orders already received (returned to customers)", "", -t.refundsOnReceivedAed]);
  ws.addRow(["+ Receivable — still to come in (after refunds)", r.cash.receivableByBucket.reduce((s, b) => s + b.orders, 0), t.receivableAed]).font = { bold: true };
  ws.addRow(["= Net sales", "", t.netSalesAed]).font = { bold: true };
  ws.addRow(["Expected gateway fees on the receivable (not yet charged)", "", t.expectedFeesOnReceivableAed]).font = { italic: true };
  ws.addRow(["Receivable by where it is"]).font = { italic: true };
  for (const b of r.cash.receivableByBucket) ws.addRow([`   ${b.label} (oldest ${b.oldestDays} days)`, b.orders, b.aed]);
  ws.addRow(["Receivable by age"]).font = { italic: true };
  for (const a of r.cash.receivableByAge) ws.addRow([`   ${a.band}`, a.orders, a.aed]);
  ws.addRow([]);
  title(ws, "4. Refunds — when the money went out");
  ws.addRow(["", "Orders", "AED"]); header(ws, ws.rowCount);
  for (const p of r.refundsByPaidMonth) ws.addRow([`This month's orders refunded in ${p.month === "unknown" ? "— (no gateway date: Zoho / sheet only)" : p.month}`, p.orders, p.aed]);
  ws.addRow([`All refunds paid out in ${r.month} (any order month)`, r.refundsPaidThisMonth.orders, r.refundsPaidThisMonth.aed]);
  ws.addRow([`   of which for orders from earlier months`, r.refundsPaidThisMonth.ofEarlierMonths, ""]);
  ws.addRow([]);
  title(ws, "5. Exchanges (not sales)");
  ws.addRow(["Orders with an exchange", r.exchanges.orders]);
  ws.addRow(["Exchange events", r.exchanges.events]);
  ws.addRow(["Value of the orders involved", "", r.exchanges.valueOfOrdersAed]);
  ws.addRow(["Extra money collected on exchanges (delivery / price difference)", "", r.exchanges.extraCollectedAed]);
  ws.addRow(["Exchanges invoiced again in Zoho (sale counted twice there)", r.exchanges.reinvoicedInZoho]);
  ws.addRow([]);
  title(ws, "6. To fix (see the Issues sheet)");
  for (const i of r.issues) ws.addRow([i.label, i.orders.length]);
  ws.getColumn(3).numFmt = money;
  ws.getColumn(4).numFmt = "0.0%";
}

function gateways(wb: ExcelJS.Workbook, r: ManagementReport) {
  const ws = wb.addWorksheet("By gateway");
  ws.columns = [
    { header: "Gateway", width: 18 }, { header: "Sales", width: 8 }, { header: "Gross sales", width: 14 },
    { header: "Cancelled #", width: 11 }, { header: "Cancelled AED", width: 13 }, { header: "Refunds #", width: 10 }, { header: "Refunds AED", width: 13 },
    { header: "Refund rate", width: 11 }, { header: "Exchanges", width: 10 }, { header: "Net sales", width: 14 }, { header: "Received", width: 14 },
    { header: "Receivable", width: 14 }, { header: "Gateway fees", width: 13 },
  ];
  header(ws, 1);
  for (const g of r.byGateway) {
    ws.addRow([g.gateway, g.orders, g.grossAed, g.cancelled.orders, g.cancelled.aed, g.refunds.orders, g.refunds.aed, (g.refundRatePct ?? 0) / 100, g.exchanges, g.netSalesAed, g.receivedAed, g.receivableAed, g.feeAed]);
  }
  const t = r.byGateway.reduce((a, g) => ({
    o: a.o + g.orders, gr: a.gr + g.grossAed, co: a.co + g.cancelled.orders, ca: a.ca + g.cancelled.aed, ro: a.ro + g.refunds.orders, ra: a.ra + g.refunds.aed,
    ex: a.ex + g.exchanges, n: a.n + g.netSalesAed, rc: a.rc + g.receivedAed, rb: a.rb + g.receivableAed, f: a.f + g.feeAed,
  }), { o: 0, gr: 0, co: 0, ca: 0, ro: 0, ra: 0, ex: 0, n: 0, rc: 0, rb: 0, f: 0 });
  ws.addRow(["Total", t.o, t.gr, t.co, t.ca, t.ro, t.ra, t.gr ? t.ra / t.gr : 0, t.ex, t.n, t.rc, t.rb, t.f]).font = { bold: true };
  for (const c of [3, 5, 7, 10, 11, 12, 13]) ws.getColumn(c).numFmt = money;
  ws.getColumn(8).numFmt = "0.00%";
}

const ORDER_COLS: Partial<ExcelJS.Column>[] = [
  { header: "Order", key: "order", width: 12 }, { header: "Day", key: "day", width: 11 }, { header: "Store", key: "store", width: 7 },
  { header: "Gateway", key: "gateway", width: 15 }, { header: "Customer", key: "customer", width: 24 }, { header: "Country", key: "country", width: 8 },
  { header: "Currency", key: "currency", width: 8 }, { header: "Store status", key: "storeStatus", width: 15 }, { header: "Stage", key: "stage", width: 12 },
  { header: "Gross AED", key: "gross", width: 12 }, { header: "Cancelled by", key: "cancelledBy", width: 11 },
  { header: "Refund (official)", key: "refund", width: 13 }, { header: "Refund source", key: "refundSource", width: 12 }, { header: "Refund paid month", key: "paidMonth", width: 12 },
  { header: "Gateway refund", key: "gwRefund", width: 13 }, { header: "Gateway refund dates", key: "gwDates", width: 16 },
  { header: "Zoho credit notes", key: "zohoRefund", width: 13 }, { header: "Credit note #", key: "zohoNotes", width: 18 },
  { header: "Sheet refund", key: "sheetRefund", width: 12 }, { header: "Sheet note", key: "sheetNote", width: 32 },
  { header: "Exchanges", key: "exch", width: 9 }, { header: "Exchange credit notes", key: "exchNotes", width: 18 }, { header: "Exchange extra collected", key: "exchExtra", width: 13 },
  { header: "Net sales AED", key: "net", width: 13 }, { header: "Gateway fee", key: "fee", width: 11 }, { header: "Received (bank)", key: "received", width: 13 },
  { header: "Receivable", key: "receivable", width: 12 }, { header: "Receivable — where", key: "bucket", width: 34 }, { header: "Age (days)", key: "age", width: 9 },
  { header: "Zoho amount", key: "zohoAmt", width: 12 }, { header: "Zoho amount from", key: "zohoOrg", width: 16 },
  { header: "Zoho invoices by organisation", key: "zohoByOrg", width: 48 },
  { header: "Issues", key: "issues", width: 60 },
];
function orders(ws: ExcelJS.Worksheet, list: MrOrderLine[]) {
  ws.columns = ORDER_COLS;
  header(ws, 1);
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  for (const l of list) {
    ws.addRow({
      order: l.order, day: l.day, store: l.store, gateway: l.gateway, customer: l.customer, country: l.country, currency: l.currency,
      storeStatus: l.storeStatus, stage: l.stage.replace("_", " "), gross: l.grossAed, cancelledBy: l.cancelledBy ?? "",
      refund: l.refund.officialAed || null, refundSource: l.refund.source ?? "", paidMonth: l.refund.paidMonth ?? "",
      gwRefund: l.refund.gatewayAed || null, gwDates: l.refund.gatewayDates.join(", "), zohoRefund: l.refund.zohoAed || null, zohoNotes: l.refund.zohoNotes.join(", "),
      sheetRefund: l.refund.sheetAed || null, sheetNote: l.refund.sheetNote, exch: l.exchange.count || null, exchNotes: l.exchange.zohoNotes.join(", "),
      exchExtra: l.exchange.extraAed || null, net: l.netSalesAed, fee: l.feeAed || null, received: l.receivedAed || null, receivable: l.receivableAed || null,
      bucket: l.receivableBucket ? BUCKET_LABEL[l.receivableBucket] : "", age: l.ageDays,
      zohoAmt: l.zoho?.amountAed ?? null, zohoOrg: l.zoho?.amountOrg ?? "",
      zohoByOrg: (l.zoho?.byOrg ?? []).map((x) => `${x.org}: ${x.numbers.join("/")} = ${x.totalAed.toFixed(2)}`).join(" · "),
      issues: l.issues.map((i) => i.text).join(" · "),
    });
  }
  for (const k of ["gross", "refund", "gwRefund", "zohoRefund", "sheetRefund", "exchExtra", "net", "fee", "received", "receivable", "zohoAmt"]) ws.getColumn(k).numFmt = money;
  ws.autoFilter = { from: "A1", to: { row: 1, column: ORDER_COLS.length } };
}

/** COD in both organisations: the summary, then one row per COD sale. */
function codSheet(wb: ExcelJS.Workbook, r: ManagementReport) {
  if (!r.cod?.orders) return;
  const ws = wb.addWorksheet("COD by organisation");
  ws.addRow([`COD sales — amount taken from ${r.cod.amountOrg}`]).font = { bold: true, size: 13 };
  ws.addRow(["Store COD sales", r.cod.orders, r.cod.grossAed]);
  ws.addRow([]);
  ws.addRow(["Organisation", "Orders invoiced", "Invoiced AED", "Role"]).font = { bold: true };
  for (const o of r.cod.byOrg) ws.addRow([o.org, o.orders, o.invoicedAed, o.org === r.cod.amountOrg ? "COD amount" : "intercompany copy"]);
  ws.addRow([]);
  if (r.cod.notInAmountOrg.length) ws.addRow([`Not invoiced in ${r.cod.amountOrg}`, r.cod.notInAmountOrg.join(", ")]);
  ws.addRow([]);
  const orgs = r.cod.byOrg.map((o) => o.org);
  ws.addRow(["Order", "Day", "Store AED", ...orgs.map((o) => `${o} invoice`), ...orgs.map((o) => `${o} AED`), `Store − ${r.cod.amountOrg}`, "Ledger status"]).font = { bold: true };
  for (const l of r.lines.filter((x) => x.stage === "sale" && x.gateway.trim().toUpperCase() === "COD")) {
    const by = (o: string) => l.zoho.byOrg.find((x) => x.org === o);
    const amt = by(r.cod.amountOrg)?.totalAed;
    ws.addRow([l.order, l.day, l.grossAed, ...orgs.map((o) => by(o)?.numbers.join(", ") ?? ""), ...orgs.map((o) => by(o)?.totalAed ?? null), amt == null ? null : Math.round((l.grossAed - amt) * 100) / 100, l.ledgerStatus ?? ""]);
  }
  ws.columns.forEach((c, i) => { c.width = i === 0 ? 14 : 18; });
}

export function addManagementSheets(wb: ExcelJS.Workbook, r: ManagementReport) {
  summary(wb, r);
  gateways(wb, r);
  orders(wb.addWorksheet("Receivables"), r.lines.filter((l) => l.receivableAed > 0).sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0)));
  orders(wb.addWorksheet("Refunds"), r.lines.filter((l) => l.refund.officialAed > 0 || l.refund.zohoAed > 0 || l.refund.sheetAed > 0 || l.refund.gatewayAed > 0));
  orders(wb.addWorksheet("Cancellations"), r.lines.filter((l) => l.stage === "cancelled"));
  orders(wb.addWorksheet("Exchanges"), r.lines.filter((l) => l.exchange.count > 0));
  orders(wb.addWorksheet("Issues to fix"), r.lines.filter((l) => l.issues.length));
  codSheet(wb, r);
  orders(wb.addWorksheet("All orders (management)"), r.lines);
}

export async function managementReportXlsx(r: ManagementReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addManagementSheets(wb, r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
