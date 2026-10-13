// COD invoice report → .xlsx: a summary (by state, open by age, flags) and
// one row per COD order with its Zoho invoice, courier voucher and action.

import ExcelJS from "exceljs";
import { COD_STATE_LABEL, type CodReport } from "./cod-invoice-report";

const NAVY = "FF0A1A4A";
const MONEY = "#,##0.00";
const head = (ws: ExcelJS.Worksheet) => {
  const r = ws.getRow(ws.rowCount);
  r.font = { bold: true, color: { argb: "FFFFFFFF" } };
  r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
};

export async function codInvoiceReportXlsx(r: CodReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet("Summary");
  s.columns = [{ width: 44 }, { width: 10 }, { width: 16 }, { width: 16 }];
  s.addRow([`COD invoices · ${r.month} · ${r.homeOrg} · as of ${r.asOf}`]).font = { bold: true, size: 14 };
  s.addRow([]);
  s.addRow(["", "Orders", "Order amount AED", "Open AED"]); head(s);
  for (const b of r.byState) s.addRow([b.label, b.orders, b.grossAed, b.openAed]);
  s.addRow(["Total (excl. cancelled)", r.totals.orders, r.totals.grossAed, r.totals.openAed]).font = { bold: true };
  s.addRow(["Invoiced in Zoho", "", r.totals.invoicedAed]);
  s.addRow(["Paid in Zoho", "", r.totals.paidAed]);
  s.addRow([]);
  s.addRow(["Open by age", "Orders", "AED"]); head(s);
  for (const a of r.openByAge) s.addRow([a.band, a.orders, a.aed]);
  s.addRow([]);
  s.addRow(["To check", "Orders", "Order numbers"]); head(s);
  for (const f of r.flags) s.addRow([f.flag, f.orders.length, f.orders.join(", ")]);
  for (const c of [3, 4]) s.getColumn(c).numFmt = MONEY;

  const o = wb.addWorksheet("COD orders", { views: [{ state: "frozen", ySplit: 1, xSplit: 2 }] });
  o.columns = [
    { header: "Order date", key: "day", width: 11 }, { header: "Order #", key: "order", width: 11 }, { header: "Store", key: "store", width: 7 },
    { header: "Customer", key: "customer", width: 22 }, { header: "City", key: "city", width: 12 }, { header: "Order AED", key: "gross", width: 11 },
    { header: "State", key: "state", width: 34 }, { header: "Action", key: "action", width: 44 }, { header: "Age (days)", key: "age", width: 8 },
    { header: "Open AED", key: "open", width: 11 }, { header: "Zoho org", key: "org", width: 16 }, { header: "Invoice", key: "inv", width: 13 },
    { header: "Invoice date", key: "invDate", width: 11 }, { header: "Zoho status", key: "invStatus", width: 11 }, { header: "Invoice AED", key: "invTotal", width: 11 },
    { header: "Balance AED", key: "invBal", width: 11 }, { header: "Credit notes", key: "cns", width: 22 }, { header: "Courier voucher", key: "voucher", width: 22 },
    { header: "Bank date", key: "bank", width: 11 }, { header: "App adjustment", key: "adj", width: 26 }, { header: "Store status", key: "fs", width: 11 },
    { header: "Flags", key: "flags", width: 50 },
  ];
  head(o);
  for (const x of r.rows) {
    o.addRow({
      day: x.day, order: x.order, store: x.store, customer: x.customer, city: x.city, gross: x.grossAed, state: COD_STATE_LABEL[x.state], action: x.action,
      age: x.openAed > 0 ? x.ageDays : null, open: x.openAed || null, org: x.invoice?.org ?? "", inv: x.invoice?.number ?? "", invDate: x.invoice?.date ?? "",
      invStatus: x.invoice?.status ?? "", invTotal: x.invoice?.total ?? null, invBal: x.invoice?.balance ?? null,
      cns: x.creditNotes.map((c) => `${c.number} ${c.total.toFixed(2)}`).join(", "), voucher: x.courier?.voucher ?? "", bank: x.courier?.bankDate ?? "",
      adj: x.adjustment ? `${x.adjustment.kind}${x.adjustment.creditNote ? ` ${x.adjustment.creditNote}` : ""}` : "", fs: x.storeStatus, flags: x.flags.join(" · "),
    });
  }
  for (const k of ["gross", "open", "invTotal", "invBal"]) o.getColumn(k).numFmt = MONEY;
  o.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 22 } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
