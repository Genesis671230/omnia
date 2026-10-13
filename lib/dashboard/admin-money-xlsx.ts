// Admin money → .xlsx: Daily, By gateway, Orders and How to read — the same
// rows the dashboard shows (lib/dashboard/admin-money), so the file and the
// screen agree to the fils. Pure: hand it the view, get a buffer.

import ExcelJS from "exceljs";
import type { AdminMoney } from "./admin-money.service";
import type { MoneyTotals } from "./admin-money";
import type { CancelledSum } from "./admin-money.service";

const MONEY = "#,##0.00;[Red]-#,##0.00";
const PCT = "0.00%";
const head = (s: ExcelJS.Worksheet) => {
  const r = s.getRow(1);
  r.font = { bold: true };
  r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF1FD" } };
  s.views = [{ state: "frozen", ySplit: 1 }];
};
const totalsCells = (t: MoneyTotals & { cancelled: CancelledSum }) => [
  t.orders, t.sale, t.fee, t.vat, t.deductions, t.deductionRate, t.refunds, t.netPayout, t.fx, t.netReceived, t.awaiting, t.overdue,
  t.cancelled.orders, t.cancelled.amount,
];
const MONEY_HEAD = ["Orders", "Gross sales", "Fee", "VAT", "Total deductions", "Deductions %", "Refunds", "Net payout", "FX charges", "Net received in bank", "Awaiting", "Of which overdue", "Cancelled orders", "Cancelled amount (not sales)"];

function moneyCols(s: ExcelJS.Worksheet, first: number, count: number, pctAt: number[] = []) {
  for (let i = first; i < first + count; i++) s.getColumn(i).numFmt = pctAt.includes(i) ? PCT : MONEY;
}

export async function buildAdminMoneyWorkbook(v: AdminMoney): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Omnia Finance OS";

  const daily = wb.addWorksheet("Daily");
  daily.addRow(["Date", ...MONEY_HEAD]);
  for (const d of v.days) daily.addRow([d.day, ...totalsCells(d)]);
  const dt = daily.addRow(["Total", ...totalsCells(v.totals)]);
  dt.font = { bold: true };
  head(daily);
  moneyCols(daily, 3, 12, [7]);
  daily.getColumn(14).numFmt = "0";
  daily.getColumn(15).numFmt = MONEY;
  daily.columns.forEach((c, i) => (c.width = i === 0 ? 12 : 15));

  const gw = wb.addWorksheet("By gateway");
  gw.addRow(["Gateway", ...MONEY_HEAD, "Usual days to bank", "Avg days to bank", "Oldest awaiting (days)"]);
  for (const g of v.gateways) gw.addRow([g.gateway, ...totalsCells(g), g.expectedDays, g.avgDaysToBank ?? "", g.oldestAwaitingDays || ""]);
  const gt = gw.addRow(["Total", ...totalsCells(v.totals)]);
  gt.font = { bold: true };
  head(gw);
  moneyCols(gw, 3, 12, [7]);
  gw.getColumn(14).numFmt = "0";
  gw.getColumn(15).numFmt = MONEY;
  gw.columns.forEach((c, i) => (c.width = i === 0 ? 18 : 15));

  const ord = wb.addWorksheet("Orders");
  ord.addRow(["Date", "Order", "Store", "Customer", "Gateway", "Status", "Sale", "Fee", "VAT", "Total deductions", "Refunds", "Net payout", "FX charges", "Net received", "Awaiting", "Received on", "Days", "Days overdue", "Stage", "Why"]);
  for (const o of v.orders) {
    ord.addRow([o.day, o.orderNumber, o.store, o.customer, o.gateway, o.status, o.sale, o.fee, o.vat, o.deductions, o.refunds, o.netPayout, o.fx,
      o.netReceived, o.awaiting, o.receivedOn ?? "", o.ageDays, o.overdueDays || "", o.stage, o.reason]);
  }
  // Cancelled orders sit under the sales, with 0 money so the columns still sum to the sales.
  for (const c of v.cancelled) {
    const r = ord.addRow([c.day, c.orderNumber, c.store, c.customer, c.gateway, "cancelled", 0, 0, 0, 0, 0, 0, 0, 0, 0, "", "", "", "",
      `Cancelled — AED ${c.amount.toFixed(2)} order, not a sale${c.creditNote ? ` · credit note ${c.creditNote}` : ""}${c.cancelledOn ? ` · ${c.cancelledOn}` : ""}`]);
    r.font = { color: { argb: "FF9AA6BD" } };
  }
  head(ord);
  moneyCols(ord, 7, 9);
  ord.columns.forEach((c, i) => (c.width = i === 19 ? 60 : i === 3 ? 22 : 13));
  ord.autoFilter = { from: "A1", to: "T1" };

  const can = wb.addWorksheet("Cancelled");
  can.addRow(["Date", "Order", "Store", "Customer", "Gateway", "Order amount (AED)", "Credit note", "Cancelled on"]);
  for (const c of v.cancelled) can.addRow([c.day, c.orderNumber, c.store, c.customer, c.gateway, c.amount, c.creditNote, c.cancelledOn]);
  const ct = can.addRow(["Total", `${v.cancelled.length} orders`, "", "", "", v.totals.cancelled.amount]);
  ct.font = { bold: true };
  if (!v.cancelled.length) can.addRow(["No cancelled orders in this range."]);
  head(can);
  can.getColumn(6).numFmt = MONEY;
  can.columns.forEach((c, i) => (c.width = i === 3 ? 22 : 15));

  const how = wb.addWorksheet("How to read");
  for (const line of [
    [`Omnia admin money · ${v.from} → ${v.to} · built ${v.today} (Dubai)`],
    [],
    ["Gross sales", "Paid orders by Dubai order date (same orders as the Gross Sales panel)."],
    ["Fee / VAT", "What the gateway kept, from its payout file or live charge. Never estimated: with no payout file yet the whole sale stays in Awaiting; where a file states no fee, deductions = sale − what reached the bank."],
    ["Total deductions", "Fee + VAT. Deductions % = deductions ÷ gross sales — identical in Daily, By gateway and the dashboard."],
    ["Refunds", "Orders returned / refunded with a credit note before any money moved."],
    ["Net payout", "Gross − deductions − refunds: what the gateway pays out."],
    ["FX charges", "Payouts that landed in the bank for less (SAR/KWD wires, bank charges): the gap split over the orders on that credit."],
    ["Net received in bank", "Net payout − FX for orders whose bank credit is confirmed."],
    ["Awaiting", "Net payout not in the bank yet. Overdue = older than the gateway's usual days + grace."],
    ["Cancelled", "Cancelled from the app: not sales, so not in gross sales. Listed in the Cancelled sheet, counted in the Cancelled columns, and shown greyed at the end of Orders."],
    ["Check", "Gross sales = deductions + refunds + FX + net received + awaiting, on every row."],
  ]) how.addRow(line);
  how.getColumn(1).width = 22;
  how.getColumn(2).width = 110;
  how.getRow(1).font = { bold: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
