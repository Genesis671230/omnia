import { NextResponse } from "next/server";
import { SettlementsRepository } from "@/lib/repositories/settlements.repository";

// GET /api/reports/daily/export?date=YYYY-MM-DD — the same day's settlement
// proof as an invoice-shaped CSV. Column names are deliberately plain
// (Invoice Number / Date / Customer / Item / Amount …) so they map cleanly
// onto Zoho Books' "Import Invoices" field mapper without a fixed template.
const csvCell = (v: string | number) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date query param required (YYYY-MM-DD)" }, { status: 400 });

  const records = await SettlementsRepository.listByDate(date);

  const header = [
    "Invoice Number", "Invoice Date", "Customer Name", "Customer Email",
    "Item Name", "Quantity", "Item Price", "Item Total", "Currency",
    "Payment Gateway", "Bank Reference", "Store", "Order Date",
  ];
  const rows = records.map((r) => [
    r.order_number,
    r.settlement_date ?? "",
    r.customer_name,
    r.customer_email,
    `Order #${r.order_number} — ${r.gateway} settlement`,
    1,
    r.gross_aed.toFixed(2),
    r.gross_aed.toFixed(2),
    r.currency,
    r.gateway,
    r.bank_reference,
    r.store_id,
    r.order_date ? r.order_date.slice(0, 10) : "",
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="omnia-settlement-${date}.csv"`,
    },
  });
}
