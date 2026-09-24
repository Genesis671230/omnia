// Sales ledger → .xlsx. One day (from the day drawer) or a whole month (from
// the Gross Sales panel). Built so anyone — founder, accountant, auditor — can
// verify every order on its own row without opening the app:
//
//   Orders    ORDER (as the store recorded it: currency, amount, method,
//             status) → GATEWAY PAYOUT LINE (the payout file's own gross,
//             fee, VAT and net for this order, in its currency and in AED)
//             → CHECK (order amount vs payout gross) → BANK (credit date,
//             total, reference, net received). Column groups are colour-banded.
//   By gateway  every gateway on one tab: a summary line each (orders, gross,
//             fees, VAT, net, received vs not settled), then each gateway's
//             orders under it with a subtotal.
//   Payouts   one row per payout touched: its stated total vs the sum of its
//             lines, the part this export covers, and the bank credit vs the
//             payout net — so every payout foots on one line.
//   Summary   totals by status. Days / Missing payout files on month exports.
//   How to verify   what every column means and where the number comes from.
//
// Amounts are numbers with an AED/number format, so the file sums and pivots
// in Excel without cleanup. Pure: hand it a ledger, get a buffer.

import ExcelJS from "exceljs";
import type { LedgerDay, LedgerOrder, LedgerStatus, SalesLedger } from "./sales-ledger";

const STATUS_LABEL: Record<LedgerStatus, string> = {
  received: "Received in bank",
  in_review: "Needs confirming",
  awaiting_bank: "Awaiting bank credit",
  awaiting_payout: "Charged — payout not issued yet",
  no_payout_file: "Payout file not uploaded",
  cod: "Cash on delivery",
};
const BASIS_LABEL = {
  measured: "Payout file (this order's line)",
  allocated: "Payout file total, split by order value",
  estimated: "Estimated at gateway rate (no file yet)",
} as const;
const STATUSES = Object.keys(STATUS_LABEL) as LedgerStatus[];
const MONEY = "#,##0.00;[Red]-#,##0.00";
/** Order vs payout gross beyond this is worth a look (FX rounding sits below it). */
const DIFF_FLAG_AED = 1;

const FILL = {
  header: "FFFBF3E6",
  order: "FFF3EFE7",
  payout: "FFEDE9FE",
  check: "FFFEF3C7",
  bank: "FFD1FAE5",
  flag: "FFFDE68A",
};
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

function dubaiDateTime(iso: string): { date: string; time: string } {
  const d = new Date(new Date(iso).getTime() + 4 * 3600_000).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
}
const r2 = (n: number) => +n.toFixed(2);

function styleHeader(sheet: ExcelJS.Worksheet, row = 1) {
  const r = sheet.getRow(row);
  r.font = { bold: true, color: { argb: "FF1F1B16" } };
  r.fill = fill(FILL.header);
  r.alignment = { vertical: "middle", wrapText: true };
  r.height = 32;
}

function totalsRow(sheet: ExcelJS.Worksheet, values: Record<string, string | number | null>) {
  const row = sheet.addRow(values);
  row.font = { bold: true };
  row.border = { top: { style: "thin", color: { argb: "FF8A8175" } } };
  return row;
}


const aed = (n: number) => `AED ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isSettled = (o: LedgerOrder) => o.status === "received";
const isOpen = (o: LedgerOrder) => o.status !== "received" && o.status !== "cod";

/** Plain-words account of every amount taken out between the order amount
 *  and what the order nets in its payout: fee (and where the number comes
 *  from), VAT on the fee, and any gap between the order and its payout line. */
export function deductionNote(o: LedgerOrder): string {
  if (o.status === "cod") return "No gateway deduction: cash collected by the courier (arrives with the courier's remittance, less their COD charge).";
  const parts: string[] = [];
  const pct = o.grossAed > 0 ? ` (${((o.feeAed / o.grossAed) * 100).toFixed(2)}% of ${aed(o.grossAed)})` : "";
  const src =
    o.status === "awaiting_payout" ? `live charge from ${o.gateway}; the payout has not been issued yet`
    : o.feeBasis === "measured" ? `stated by ${o.gateway} for this order in the payout file`
    : o.feeBasis === "allocated" ? `this order's share of the payout file's total fee, split by order value`
    : `ESTIMATE at ${o.gateway}'s published rate; no payout file states it yet`;
  parts.push(`Gateway fee ${aed(o.feeAed)}${pct}: ${src}.`);
  if (o.vatAed) parts.push(`VAT on the fee ${aed(o.vatAed)}, charged by ${o.gateway}.`);
  const line = o.payoutLine;
  if (line?.isRefund) parts.push("The matched payout line is a refund: money returned to the customer.");
  if (line) {
    const gap = r2(o.grossAed - line.grossAed);
    if (Math.abs(gap) > DIFF_FLAG_AED) {
      parts.push(gap > 0
        ? `Payout line is ${aed(gap)} less than the order: a partial capture, a partial refund, or an FX conversion difference${o.currency !== "AED" ? ` on this ${o.currency} order` : ""}.`
        : `Payout line is ${aed(-gap)} more than the order: usually FX conversion${o.currency !== "AED" ? ` on this ${o.currency} order` : ""}, or shipping/tip added after the order.`);
    }
  }
  const total = r2(o.feeAed + (o.vatAed ?? 0));
  parts.push(`Total deducted ${aed(total)}; net for this order ${aed(o.payoutNetAed)}.`);
  return parts.join(" ");
}

/** The same for a whole payout: gross → fees → refunds → net, and any money
 *  in it that belongs to no order. */
function payoutDeductionNote(p: NonNullable<LedgerOrder["payout"]>): string {
  const parts: string[] = [];
  if (p.grossAed != null) parts.push(`Gross ${aed(p.grossAed)}`);
  if (p.feeAed != null) parts.push(`− fees ${aed(Math.abs(p.feeAed))}`);
  if (p.refundLines) parts.push(`− ${p.refundLines} refund line${p.refundLines === 1 ? "" : "s"} ${aed(p.refundsAed)}`);
  parts.push(`= net ${aed(p.netAed)}${p.currency !== "AED" && p.netOriginal != null ? ` (${p.currency} ${p.netOriginal})` : ""}.`);
  const gap = p.lineCount ? r2(p.netAed - p.linesNetAed) : 0;
  if (Math.abs(gap) > DIFF_FLAG_AED) {
    parts.push(`${aed(Math.abs(gap))} ${gap < 0 ? "was taken out" : "was added"} that belongs to no order: a chargeback/dispute, an adjustment, a reserve, or a line without an order number.`);
  }
  return parts.join(" ");
}

/* ── Orders ─────────────────────────────────────────────────────────────── */

type Col = Partial<ExcelJS.Column> & { key: string; group: keyof typeof FILL; money?: boolean };

const ORDER_COLS: Col[] = [
  // ORDER — as the store recorded it
  { header: "Order date (Dubai)", key: "date", width: 12, group: "order" },
  { header: "Time", key: "time", width: 7, group: "order" },
  { header: "Store", key: "store", width: 7, group: "order" },
  { header: "Order #", key: "order", width: 11, group: "order" },
  { header: "Customer", key: "customer", width: 22, group: "order" },
  { header: "Payment method (store)", key: "method", width: 24, group: "order" },
  { header: "Order status", key: "ostatus", width: 12, group: "order" },
  { header: "Order currency", key: "ocur", width: 9, group: "order" },
  { header: "Order amount (order currency)", key: "oamt", width: 14, group: "order", money: true },
  { header: "Order amount (AED)", key: "gross", width: 13, group: "order", money: true },
  // GATEWAY PAYOUT LINE — the payout file's own numbers for this order
  { header: "Gateway", key: "gateway", width: 15, group: "payout" },
  { header: "Payout ID", key: "payoutId", width: 28, group: "payout" },
  { header: "Payout file", key: "payoutFile", width: 30, group: "payout" },
  { header: "Payout currency", key: "lcur", width: 9, group: "payout" },
  { header: "Payout line gross (payout currency)", key: "lgo", width: 14, group: "payout", money: true },
  { header: "Payout line fee (payout currency)", key: "lfo", width: 13, group: "payout", money: true },
  { header: "Payout line net (payout currency)", key: "lno", width: 14, group: "payout", money: true },
  { header: "Payout line gross (AED)", key: "lg", width: 13, group: "payout", money: true },
  { header: "Fee (AED)", key: "fee", width: 11, group: "payout", money: true },
  { header: "VAT on fee (AED)", key: "vat", width: 10, group: "payout", money: true },
  { header: "Net payout for this order (AED)", key: "pnet", width: 14, group: "payout", money: true },
  { header: "Fee source", key: "basis", width: 30, group: "payout" },
  { header: "Deductions (what was taken and why)", key: "ded", width: 70, group: "payout" },
  // CHECK
  { header: "Order vs payout gross (AED)", key: "diff", width: 13, group: "check", money: true },
  // BANK
  { header: "Status", key: "status", width: 22, group: "bank" },
  { header: "Bank credit date", key: "bankDate", width: 12, group: "bank" },
  { header: "Bank credit total (AED)", key: "bankAmount", width: 14, group: "bank", money: true },
  { header: "Bank reference", key: "bankRef", width: 16, group: "bank" },
  { header: "Net received in bank (AED)", key: "recv", width: 14, group: "bank", money: true },
  { header: "Reason / what's missing", key: "reason", width: 60, group: "bank" },
];

function orderRow(o: LedgerOrder): Record<string, string | number | null> {
  const { date, time } = dubaiDateTime(o.orderDate);
  const cod = o.status === "cod";
  const line = o.payoutLine;
  return {
    date, time, store: o.store, order: o.orderNumber, customer: o.customerName,
    method: o.paymentMethod, ostatus: o.financialStatus, ocur: o.currency,
    oamt: o.grossOriginal ?? o.grossAed,
    gross: o.grossAed,
    gateway: o.gateway,
    payoutId: o.payout?.id ?? "",
    payoutFile: o.payout?.source ?? "",
    lcur: line?.currency ?? "",
    lgo: line ? (line.grossOriginal ?? line.grossAed) : null,
    lfo: line ? (line.feeOriginal ?? line.feeAed) : null,
    lno: line ? (line.netOriginal ?? line.netAed) : null,
    lg: line?.grossAed ?? null,
    fee: cod ? null : o.feeAed,
    vat: o.vatAed,
    pnet: cod ? null : o.payoutNetAed,
    basis: cod ? "Cash on delivery — no gateway fee" : o.status === "awaiting_payout" ? "Gateway charge, live (payout not issued yet)" : BASIS_LABEL[o.feeBasis],
    ded: deductionNote(o),
    diff: line ? r2(o.grossAed - line.grossAed) : null,
    status: STATUS_LABEL[o.status],
    bankDate: o.bank?.date ?? "",
    bankAmount: o.bank ? o.bank.amountAed : null,
    bankRef: o.bank?.reference ?? "",
    recv: o.status === "received" ? o.receivedAed : null,
    reason: o.reason,
  };
}

function ordersSheet(wb: ExcelJS.Workbook, orders: LedgerOrder[]) {
  const s = wb.addWorksheet("Orders", { views: [{ state: "frozen", ySplit: 1, xSplit: 4 }] });
  s.columns = ORDER_COLS.map(({ group: _g, money: _m, ...c }) => c);

  for (const o of orders) {
    const row = s.addRow(orderRow(o));
    // An estimated fee is a forecast, not a fact — grey italic so nobody
    // mistakes it for a number the gateway stated.
    if (o.feeBasis === "estimated" && o.status !== "cod") {
      for (const k of ["fee", "pnet"]) row.getCell(k).font = { italic: true, color: { argb: "FF8A8175" } };
    }
    const diff = row.getCell("diff").value;
    if (typeof diff === "number" && Math.abs(diff) > DIFF_FLAG_AED) row.getCell("diff").fill = fill(FILL.flag);
  }

  const sum = (f: (o: LedgerOrder) => number | null | undefined) => r2(orders.reduce((a, o) => a + (Number(f(o)) || 0), 0));
  totalsRow(s, {
    date: "Total", order: `${orders.length} orders`,
    gross: sum((o) => o.grossAed),
    lg: sum((o) => o.payoutLine?.grossAed),
    fee: sum((o) => (o.status === "cod" ? 0 : o.feeAed)),
    vat: sum((o) => o.vatAed),
    pnet: sum((o) => (o.status === "cod" ? 0 : o.payoutNetAed)),
    recv: sum((o) => (o.status === "received" ? o.receivedAed : 0)),
  });

  // Column bands: header tinted by group so ORDER → PAYOUT → CHECK → BANK reads left to right.
  ORDER_COLS.forEach((c, i) => {
    const col = s.getColumn(i + 1);
    if (c.money) col.numFmt = MONEY;
    s.getRow(1).getCell(i + 1).fill = fill(FILL[c.group]);
  });
  styleHeader(s);
  ORDER_COLS.forEach((c, i) => (s.getRow(1).getCell(i + 1).fill = fill(FILL[c.group])));
  s.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ORDER_COLS.length } };
}


/* ── By gateway ─────────────────────────────────────────────────────────── */

const GW_SUMMARY_HEAD = [
  "Gateway", "Orders", "Order amount (AED)", "Fees (AED)", "VAT on fees (AED)", "Net payout (AED)",
  "Received in bank: orders", "Received in bank: net (AED)", "Not settled yet: orders", "Not settled yet: order amount (AED)",
  "Effective fee %", "Fee source",
];
const GW_ORDER_HEAD = [
  "Gateway", "Order date (Dubai)", "Time", "Store", "Order #", "Customer", "Order amount (AED)", "Fees (AED)",
  "VAT on fee (AED)", "Net payout (AED)", "Net received in bank (AED)", "Status", "Payout ID", "Bank credit date",
  "Bank reference", "Deductions (what was taken and why)",
];
const GW_WIDTHS = [18, 12, 7, 7, 11, 22, 14, 11, 11, 13, 14, 26, 28, 12, 16, 80];

function gatewaysSheet(wb: ExcelJS.Workbook, orders: LedgerOrder[]) {
  const s = wb.addWorksheet("By gateway");
  GW_WIDTHS.forEach((w, i) => (s.getColumn(i + 1).width = w));
  const moneyCells = (row: ExcelJS.Row, cols: number[]) => cols.forEach((c) => (row.getCell(c).numFmt = MONEY));
  const head = (values: string[]) => {
    const row = s.addRow(values);
    row.font = { bold: true, color: { argb: "FF1F1B16" } };
    row.alignment = { vertical: "middle", wrapText: true };
    row.height = 32;
    values.forEach((_, i) => (row.getCell(i + 1).fill = fill(FILL.header)));
    return row;
  };
  const title = (text: string) => {
    const row = s.addRow([text]);
    row.font = { bold: true, size: 13 };
    return row;
  };

  const groups = new Map<string, LedgerOrder[]>();
  for (const o of orders) groups.set(o.gateway || "Unknown", [...(groups.get(o.gateway || "Unknown") ?? []), o]);
  const sum = (list: LedgerOrder[], f: (o: LedgerOrder) => number | null | undefined) =>
    r2(list.reduce((a, o) => a + (Number(f(o)) || 0), 0));
  const stats = (list: LedgerOrder[]) => {
    const gross = sum(list, (o) => o.grossAed);
    const fee = sum(list, (o) => (o.status === "cod" ? 0 : o.feeAed));
    return {
      gross, fee,
      vat: sum(list, (o) => o.vatAed),
      net: sum(list, (o) => (o.status === "cod" ? 0 : o.payoutNetAed)),
      recvN: list.filter(isSettled).length,
      recv: sum(list.filter(isSettled), (o) => o.receivedAed),
      openN: list.filter(isOpen).length,
      open: sum(list.filter(isOpen), (o) => o.grossAed),
      pct: gross > 0 ? `${((fee / gross) * 100).toFixed(2)}%` : "",
    };
  };
  const sorted = [...groups.entries()].sort((a, b) => stats(b[1]).gross - stats(a[1]).gross);

  // 1. One line per gateway.
  title("Gateway summary");
  head(GW_SUMMARY_HEAD);
  for (const [gw, list] of sorted) {
    const t = stats(list);
    const bases = [...new Set(list.map((o) =>
      o.status === "cod" ? "cash on delivery" : o.status === "awaiting_payout" ? "live gateway charge" : o.feeBasis))].join(", ");
    const row = s.addRow([gw, list.length, t.gross, t.fee, t.vat, t.net, t.recvN, t.recv, t.openN, t.open, t.pct, bases]);
    moneyCells(row, [3, 4, 5, 6, 8, 10]);
    if (t.openN > 0) row.getCell(10).fill = fill(FILL.flag);
  }
  const all = stats(orders);
  const tot = totalsRowArr(s, ["Total", orders.length, all.gross, all.fee, all.vat, all.net, all.recvN, all.recv, all.openN, all.open, all.pct, ""]);
  moneyCells(tot, [3, 4, 5, 6, 8, 10]);

  // 2. Each gateway's orders, with a subtotal.
  s.addRow([]);
  title("Orders by gateway");
  const headerRow = head(GW_ORDER_HEAD);
  for (const [gw, list] of sorted) {
    const band = s.addRow([`${gw}: ${list.length} order${list.length === 1 ? "" : "s"}`]);
    band.font = { bold: true };
    GW_ORDER_HEAD.forEach((_, i) => (band.getCell(i + 1).fill = fill(FILL.payout)));
    for (const o of list.slice().sort((a, b) => (a.orderDate < b.orderDate ? -1 : 1))) {
      const { date, time } = dubaiDateTime(o.orderDate);
      const cod = o.status === "cod";
      const row = s.addRow([
        gw, date, time, o.store, o.orderNumber, o.customerName, o.grossAed,
        cod ? null : o.feeAed, o.vatAed, cod ? null : o.payoutNetAed,
        isSettled(o) ? o.receivedAed : null, STATUS_LABEL[o.status],
        o.payout?.id ?? "", o.bank?.date ?? "", o.bank?.reference ?? "", deductionNote(o),
      ]);
      moneyCells(row, [7, 8, 9, 10, 11]);
      if (o.feeBasis === "estimated" && !cod) for (const c of [8, 10]) row.getCell(c).font = { italic: true, color: { argb: "FF8A8175" } };
      if (isSettled(o)) row.getCell(12).fill = fill(FILL.bank);
    }
    const t = stats(list);
    const sub = totalsRowArr(s, [`${gw} subtotal`, "", "", "", `${list.length} orders`, "", t.gross, t.fee, t.vat, t.net, t.recv,
      `${t.recvN} received · ${t.openN} not settled`]);
    moneyCells(sub, [7, 8, 9, 10, 11]);
    s.addRow([]);
  }
  s.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: GW_ORDER_HEAD.length } };
}

function totalsRowArr(sheet: ExcelJS.Worksheet, values: (string | number | null)[]) {
  const row = sheet.addRow(values);
  row.font = { bold: true };
  row.border = { top: { style: "thin", color: { argb: "FF8A8175" } } };
  return row;
}

/* ── Payouts ────────────────────────────────────────────────────────────── */

function payoutsSheet(wb: ExcelJS.Workbook, orders: LedgerOrder[]) {
  const byPayout = new Map<string, LedgerOrder[]>();
  for (const o of orders) if (o.payout) byPayout.set(o.payout.id, [...(byPayout.get(o.payout.id) ?? []), o]);

  const s = wb.addWorksheet("Payouts", { views: [{ state: "frozen", ySplit: 1 }] });
  s.columns = [
    { header: "Payout ID", key: "id", width: 30 },
    { header: "Gateway", key: "gw", width: 15 },
    { header: "Payout file", key: "file", width: 32 },
    { header: "Payout gross (AED)", key: "pg", width: 13 },
    { header: "Payout fees (AED)", key: "pf", width: 12 },
    { header: "Payout net total (AED)", key: "pn", width: 14 },
    { header: "Payout currency", key: "pcur", width: 9 },
    { header: "Payout net (payout currency)", key: "pno", width: 14 },
    { header: "Lines in payout file", key: "lines", width: 10 },
    { header: "Sum of line nets (AED)", key: "ln", width: 14 },
    { header: "Payout total vs lines (AED)", key: "foot", width: 13 },
    { header: "Orders in this export", key: "n", width: 10 },
    { header: "Their order amount (AED)", key: "og", width: 14 },
    { header: "Their fees (AED)", key: "of", width: 12 },
    { header: "Their net payout (AED)", key: "on", width: 14 },
    { header: "Bank credit date", key: "bd", width: 12 },
    { header: "Bank credit (AED)", key: "ba", width: 13 },
    { header: "Bank reference", key: "br", width: 16 },
    { header: "Bank vs payout net (AED)", key: "bdiff", width: 13 },
    { header: "Bank's rate (AED per 1 payout currency)", key: "brate", width: 14 },
    { header: "Refunds in payout (AED)", key: "rf", width: 12 },
    { header: "Deductions (what was taken and why)", key: "ded", width: 70 },
    { header: "Note", key: "note", width: 50 },
  ];
  for (const [id, list] of byPayout) {
    const p = list[0].payout!;
    const bank = list.find((o) => o.bank)?.bank ?? null;
    const row = s.addRow({
      id, gw: p.gateway, file: p.source ?? "",
      pg: p.grossAed, pf: p.feeAed, pn: p.netAed,
      lines: p.lineCount || null,
      ln: p.lineCount ? p.linesNetAed : null,
      foot: p.lineCount ? r2(p.netAed - p.linesNetAed) : null,
      n: list.length,
      og: r2(list.reduce((a, o) => a + o.grossAed, 0)),
      of: r2(list.reduce((a, o) => a + o.feeAed, 0)),
      on: r2(list.reduce((a, o) => a + o.payoutNetAed, 0)),
      bd: bank?.date ?? "", ba: bank ? bank.amountAed : null, br: bank?.reference ?? "",
      bdiff: bank ? r2(bank.amountAed - p.netAed) : null,
      pcur: p.currency,
      pno: p.currency !== "AED" ? p.netOriginal : null,
      brate: bank && p.currency !== "AED" && p.netOriginal ? +(bank.amountAed / p.netOriginal).toFixed(6) : null,
      rf: p.refundLines ? p.refundsAed : null,
      ded: payoutDeductionNote(p),
      note: "",
    });
    const cross = p.currency !== "AED";
    const bdiff = row.getCell("bdiff").value;
    if (cross && typeof bdiff === "number" && Math.abs(bdiff) > DIFF_FLAG_AED) {
      // The AED "payout net" is our estimate at a fixed rate; the bank converted
      // at its own. The gap is exchange, not missing money — say so instead of
      // flagging it like one.
      row.getCell("note").value =
        `${p.currency} payout: the gap is the bank's conversion rate vs our estimate (${p.currency} ${p.netOriginal ?? "?"} credited as AED ${bank?.amountAed}).`;
    } else {
      for (const k of ["foot", "bdiff"]) {
        const v = row.getCell(k).value;
        if (typeof v === "number" && Math.abs(v) > DIFF_FLAG_AED) row.getCell(k).fill = fill(FILL.flag);
      }
    }
  }
  for (const k of ["pg", "pf", "pn", "pno", "ln", "foot", "og", "of", "on", "ba", "bdiff", "rf"]) s.getColumn(k).numFmt = MONEY;
  styleHeader(s);
}

/* ── Summary / How to verify ────────────────────────────────────────────── */

function summarySheet(
  wb: ExcelJS.Workbook,
  title: string,
  t: { grossAed: number; orders: number; feeAed: number; receivedAed: number; receivedGrossAed: number;
    statusCounts: Record<LedgerStatus, { orders: number; grossAed: number }> },
  orders: LedgerOrder[],
  reason?: string,
) {
  const s = wb.addWorksheet("Summary");
  s.columns = [
    { header: title, key: "k", width: 44 },
    { header: "Orders", key: "n", width: 10 },
    { header: "AED", key: "v", width: 16 },
  ];
  const measured = orders.filter((o) => o.feeBasis === "measured" && o.status !== "cod");
  s.addRow({ k: "Gross sales (order amounts)", n: t.orders, v: t.grossAed });
  s.addRow({ k: "Gateway fees", v: t.feeAed });
  s.addRow({ k: "  of which stated per order by the payout file", n: measured.length, v: r2(measured.reduce((a, o) => a + o.feeAed, 0)) });
  s.addRow({ k: "VAT on fees (where itemised)", v: r2(orders.reduce((a, o) => a + (o.vatAed ?? 0), 0)) });
  s.addRow({ k: "Net payout for these orders", v: r2(orders.reduce((a, o) => a + (o.status === "cod" ? 0 : o.payoutNetAed), 0)) });
  s.addRow({ k: "Net received in bank", n: t.statusCounts.received.orders, v: t.receivedAed });
  s.addRow({ k: "Not in bank yet (order amounts)", n: t.orders - t.statusCounts.received.orders, v: r2(Math.max(t.grossAed - t.receivedGrossAed, 0)) });
  s.addRow({});
  s.addRow({ k: "By status" }).font = { bold: true };
  for (const st of STATUSES) {
    if (t.statusCounts[st].orders === 0) continue;
    s.addRow({ k: STATUS_LABEL[st], n: t.statusCounts[st].orders, v: t.statusCounts[st].grossAed });
  }
  if (reason) {
    s.addRow({});
    s.addRow({ k: "Why", n: reason });
  }
  s.getColumn("v").numFmt = MONEY;
  styleHeader(s);
}

function howToSheet(wb: ExcelJS.Workbook) {
  const s = wb.addWorksheet("How to verify");
  s.columns = [{ header: "Column", key: "c", width: 34 }, { header: "What it is / where it comes from", key: "d", width: 110 }];
  const rows: [string, string][] = [
    ["Order amount (order currency / AED)", "The order total as the store recorded it (Shopify current total, WooCommerce total). AED is the store's own conversion for SAR orders."],
    ["Payout line gross / fee / net", "This order's own row in the gateway payout file (Shopify Payments, Stripe, Tabby, Tamara, Telr…), exactly as the gateway stated it, first in the payout currency, then in AED. Blank when the file has no per-order rows or no file has been uploaded yet."],
    ["Fee (AED)", "The gateway's fee for this order. 'Fee source' says whether the payout file stated it for this order, split its file total by order value, or — with no file yet — it is estimated at the gateway's published rate (grey italic)."],
    ["VAT on fee (AED)", "VAT the gateway charged on its fee, when the file itemises it separately (Tamara)."],
    ["Net payout for this order (AED)", "What this order contributes to its payout: gross − fee − VAT."],
    ["Order vs payout gross (AED)", "Order amount minus the payout line's gross. Should be ~0; highlighted when over AED 1 (a partial capture, a refund, or an FX conversion difference on a SAR order)."],
    ["Bank credit date / total / reference", "The bank statement credit the whole payout landed in. One credit usually carries many orders — see the Payouts sheet."],
    ["Net received in bank (AED)", "Filled only once the payout's bank credit is matched and settled in Reconciliation."],
    ["Payouts sheet", "'Payout total vs lines' checks the payout adds up from its order lines; 'Bank vs payout net' checks the bank credited what the gateway said it paid. Highlighted when over AED 1."],
    ["Payout total vs lines ≠ 0", "The payout carries money that belongs to no order — a dispute or chargeback, an adjustment, a reserve, or a charge whose description had no order number (common on Stripe). Open the payout file and look for rows without an order."],
    ["SAR / KWD payouts", "The AED figures for a payout settled in another currency are converted at a fixed estimate. The bank converts at its own rate, shown as 'Bank's rate' — a gap there is exchange rate, not missing money. The reconciliation matches these using the rate quoted in the bank narration."],
    ["By gateway sheet", "Top: one line per gateway (orders, order amount, fees, VAT, net payout, what is received in the bank and what is not settled yet). Below: each gateway's orders with a subtotal. 'Not settled yet' = not confirmed in the bank; cash-on-delivery is counted in neither."],
    ["Deductions (what was taken and why)", "Every amount taken out between the order amount and the order's net: the gateway fee (as a % of the order, and whether the gateway stated it, it was split from a file total, or it is an estimate), VAT on the fee, refunds, and any gap between the order and its payout line. On the Payouts sheet: gross − fees − refunds = net, plus any money in the payout that belongs to no order."],
    ["Dates", "All order dates and times are Dubai time; a 'day' is the Dubai calendar day."],
  ];
  for (const [c, d] of rows) s.addRow({ c, d }).alignment = { wrapText: true, vertical: "top" };
  styleHeader(s);
}

/* ── workbooks ──────────────────────────────────────────────────────────── */

/** The day drawer's report. */
export async function buildDayWorkbook(day: LedgerDay): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  summarySheet(wb, `Sales on ${day.day} (Dubai day)`, { ...day }, day.orderList, day.reason);
  gatewaysSheet(wb, day.orderList);
  ordersSheet(wb, day.orderList);
  payoutsSheet(wb, day.orderList);
  howToSheet(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The whole month: summary, every day, every order, every payout, what's missing. */
export async function buildMonthWorkbook(ledger: SalesLedger): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const orders = ledger.days.flatMap((x) => x.orderList);
  summarySheet(wb, `Sales · ${ledger.label}`, ledger.totals, orders);
  gatewaysSheet(wb, orders);

  const d = wb.addWorksheet("Days", { views: [{ state: "frozen", ySplit: 1 }] });
  d.columns = [
    { header: "Date", key: "day", width: 11 },
    { header: "Orders", key: "orders", width: 8 },
    { header: "Order amount (AED)", key: "gross", width: 13 },
    { header: "Fees (AED)", key: "fee", width: 12 },
    { header: "Net payout (AED)", key: "pnet", width: 13 },
    { header: "Net received in bank (AED)", key: "net", width: 15 },
    { header: "Not in bank yet (AED)", key: "pending", width: 14 },
    ...ledger.stores.map((s) => ({ header: `${s} (AED)`, key: `store_${s}`, width: 12 })),
    { header: "Status", key: "reason", width: 80 },
  ];
  for (const day of ledger.days) {
    if (day.orders === 0) continue;
    d.addRow({
      day: day.day, orders: day.orders, gross: day.grossAed, fee: day.feeAed,
      pnet: r2(day.orderList.reduce((a, o) => a + (o.status === "cod" ? 0 : o.payoutNetAed), 0)),
      net: day.receivedAed,
      pending: r2(Math.max(day.grossAed - day.receivedGrossAed, 0)),
      ...Object.fromEntries(ledger.stores.map((s) => [`store_${s}`, day.byStore[s] ?? 0])),
      reason: day.reason,
    });
  }
  totalsRow(d, {
    day: "Total", orders: ledger.totals.orders, gross: ledger.totals.grossAed, fee: ledger.totals.feeAed,
    pnet: r2(orders.reduce((a, o) => a + (o.status === "cod" ? 0 : o.payoutNetAed), 0)),
    net: ledger.totals.receivedAed,
    pending: r2(Math.max(ledger.totals.grossAed - ledger.totals.receivedGrossAed, 0)),
  });
  for (const k of ["gross", "fee", "pnet", "net", "pending", ...ledger.stores.map((s) => `store_${s}`)]) d.getColumn(k).numFmt = MONEY;
  styleHeader(d);

  ordersSheet(wb, orders);
  payoutsSheet(wb, orders);

  if (ledger.missingPayoutFiles.length > 0) {
    const m = wb.addWorksheet("Missing payout files");
    m.columns = [
      { header: "Gateway", key: "g", width: 18 },
      { header: "Orders", key: "n", width: 9 },
      { header: "Order amount (AED)", key: "v", width: 14 },
      { header: "Order days", key: "days", width: 90 },
    ];
    for (const x of ledger.missingPayoutFiles) m.addRow({ g: x.gateway, n: x.orders, v: x.grossAed, days: x.days.join(", ") });
    m.getColumn("v").numFmt = MONEY;
    styleHeader(m);
  }
  howToSheet(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
