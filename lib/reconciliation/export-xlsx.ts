// Reconciliation → .xlsx workbook that mirrors the finance team's payments
// Google Sheet: an "SMSA Orders" tab (international orders), a "Local orders"
// tab (UAE orders), and a "Summary" tab (one row per bank credit / payout).
//
// The point is a founder can open one file and see, per order, which gateway
// it came through and whether the payout for it has actually landed in the
// bank — the same read the Google Sheet gives, but generated straight from
// the reconciliation engine instead of maintained by hand.

import ExcelJS from "exceljs";
import type { ReconLine } from "@/lib/reconciliation/engine";

// What the export needs from each settled/matched order. Sourced from the
// orders table (OrdersRepository.getDetailsByOrderNumbers) — a plain bag so
// the caller does the DB read and this module stays pure/testable.
export type ExportOrder = {
  order_number: string;
  order_date: string | null;
  customer_name: string | null;
  city: string | null;
  country: string | null;
  currency: string | null;
  gross_original: number | null;
  gross_aed: number | null;
  gateway: string | null;
};

const AED = (n: number | null | undefined) =>
  n == null ? "" : Number(n.toFixed(2));

// Same country split the dispatch sheet uses (lib/integrations/dispatch-sheet.ts
// tabForOrder): UAE → Local orders / OnTrack, everything else → SMSA Orders.
function isLocal(country: string | null | undefined): boolean {
  const c = (country ?? "").trim().toUpperCase();
  return c === "AE" || c === "UAE" || c === "UNITED ARAB EMIRATES";
}

function paymentStatusFor(line: ReconLine): string {
  switch (line.state) {
    case "SETTLED":
      return line.confirmedBy ? "Received — confirmed" : "Received";
    case "PAYOUT_VARIANCE":
      return "Received with variance";
    case "ORDERS_UNRESOLVED":
      return "Payout landed — order not synced";
    case "AWAITING_PAYOUT":
      return "Awaiting payout";
    default:
      return line.state;
  }
}

type OrderRow = {
  line: ReconLine;
  order: ExportOrder | undefined;
  orderNumber: string;
  gross: number | null;
  fee: number | null;
  net: number | null;
  isRefund: boolean;
};

// Flatten recon lines to one row per (payout, order), carrying the per-order
// gross/fee/net share the engine already computed.
function orderRows(lines: ReconLine[], orderByNumber: Map<string, ExportOrder>): OrderRow[] {
  const rows: OrderRow[] = [];
  for (const line of lines) {
    const shareByRef = new Map(line.transactions.map((t) => [String(t.ref), t]));
    const refs = [...line.resolvedOrders, ...line.refundedOrders];
    // A line awaiting its payout has no resolved orders yet — still worth a
    // row so "this credit exists but is unexplained" shows up in the tabs.
    if (refs.length === 0) {
      rows.push({
        line, order: undefined, orderNumber: "",
        gross: null, fee: null, net: null, isRefund: false,
      });
      continue;
    }
    for (const ref of refs) {
      const share = shareByRef.get(String(ref));
      const order = orderByNumber.get(String(ref));
      rows.push({
        line,
        order,
        orderNumber: String(ref),
        gross: share?.grossShare ?? order?.gross_aed ?? null,
        fee: share?.feeShare ?? null,
        net: share?.netShare ?? null,
        isRefund: line.refundedOrders.includes(ref),
      });
    }
  }
  return rows;
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FF1F1B16" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBF3E6" } };
  row.alignment = { vertical: "middle" };
}

function autoWidth(sheet: ExcelJS.Worksheet) {
  sheet.columns.forEach((col) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      max = Math.max(max, String(cell.value ?? "").length + 2);
    });
    col.width = Math.min(max, 48);
  });
}

export async function buildReconciliationWorkbook(
  lines: ReconLine[],
  orders: ExportOrder[],
  range: { from: string | null; to: string | null },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Omnia Finance OS";
  wb.created = new Date();

  const orderByNumber = new Map(orders.map((o) => [String(o.order_number), o]));
  const rows = orderRows(lines, orderByNumber);

  /* ── Summary ─────────────────────────────────────────────────────────── */
  const summary = wb.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 1 }] });
  summary.addRow([
    "Date", "Gateway", "Bank Reference", "Bank Amount (AED)",
    "Payout ID", "Payout Net (AED)", "Variance (AED)", "Currency", "FX Rate", "FX Source",
    "State", "Payment Status", "Confirmed By",
    "Orders Settled", "Orders Missing",
  ]);
  styleHeader(summary.getRow(1));
  for (const line of lines) {
    summary.addRow([
      line.date ? line.date.slice(0, 10) : "",
      line.provider,
      line.reference,
      AED(line.bankAmount),
      line.payout?.id ?? "",
      line.payout ? AED(line.payout.net) : "",
      AED(line.variance),
      line.payout?.currency ?? "AED",
      line.payout?.fxRate ?? "",
      line.payout?.fxSource === "bank" ? "Bank-quoted" : line.payout?.fxSource === "estimate" ? "Estimate" : "",
      line.state,
      paymentStatusFor(line),
      line.confirmedBy ?? "",
      line.resolvedOrders.map((o) => `#${o}`).join(" "),
      line.unresolvedRefs.map((o) => `#${o}`).join(" "),
    ]);
  }
  autoWidth(summary);

  /* ── SMSA Orders (international) ──────────────────────────────────────── */
  const smsa = wb.addWorksheet("SMSA Orders", { views: [{ state: "frozen", ySplit: 1 }] });
  smsa.addRow([
    "S.No", "Date", "Order #", "Total Amt", "Currency", "In AED", "Party",
    "Actual Payment Status", "Payment Received Date", "Total Amt (Same Cur)",
    "Fee Deducted", "Balance Received", "Cancelled / Refunded Amount", "Fee %",
    "Bank Reference", "Payout ID",
  ]);
  styleHeader(smsa.getRow(1));

  /* ── Local orders (UAE) ──────────────────────────────────────────────── */
  const local = wb.addWorksheet("Local orders", { views: [{ state: "frozen", ySplit: 1 }] });
  local.addRow([
    "S.No", "Date", "Order #", "Type of Sale", "Total", "Party", "Customer",
    "Actual Payment Status", "Payment Received on", "Total Amt",
    "Fee Deducted", "Amount After Deduction", "Bank Reference", "Payout ID",
  ]);
  styleHeader(local.getRow(1));

  let smsaN = 0;
  let localN = 0;
  for (const row of rows) {
    if (!row.orderNumber) continue; // awaiting-payout stub — Summary only
    const { line, order } = row;
    const date = (order?.order_date ?? line.date ?? "").slice(0, 10);
    const party = order?.gateway || line.provider;
    const feePct =
      row.gross && row.fee != null && row.gross !== 0
        ? Number(((row.fee / row.gross) * 100).toFixed(2))
        : "";
    const receivedDate = line.state === "SETTLED" ? (line.date ?? "").slice(0, 10) : "";

    if (isLocal(order?.country)) {
      local.addRow([
        ++localN,
        date,
        row.orderNumber,
        row.isRefund ? "Refund / Exchange" : "Sale",
        AED(order?.gross_aed ?? row.gross),
        party,
        order?.customer_name ?? "",
        paymentStatusFor(line),
        receivedDate,
        AED(row.gross),
        AED(row.fee),
        AED(row.net),
        line.reference,
        line.payout?.id ?? "",
      ]);
    } else {
      smsa.addRow([
        ++smsaN,
        date,
        row.orderNumber,
        order?.gross_original ?? AED(row.gross),
        order?.currency ?? "AED",
        AED(order?.gross_aed ?? row.gross),
        party,
        paymentStatusFor(line),
        receivedDate,
        order?.gross_original ?? "",
        AED(row.fee),
        AED(row.net),
        row.isRefund ? AED(row.gross) : "",
        feePct,
        line.reference,
        line.payout?.id ?? "",
      ]);
    }
  }
  autoWidth(smsa);
  autoWidth(local);

  // exceljs types writeBuffer as a generic ArrayBuffer-ish; Node Buffer is fine.
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
