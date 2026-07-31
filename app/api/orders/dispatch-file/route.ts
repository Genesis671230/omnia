import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { OrdersRepository } from "@/lib/repositories/orders.repository";

// Column order MUST match SMSA's template exactly — they parse positionally,
// not by header name. Do not reorder.
const HEADERS = [
  "ReferenceNumber","HeaderPO","ShipCarrier","ShipService","ShipBilling","ShipAccount",
  "ShipDate","CancelDate","ShipToMobile","ShipToName","ShipToCompany","ShipToAddress1",
  "ShipToAddress2","ShipToCity","ShipToState","ShipToZip","ShipToCountry","ShipToPhone",
  "ShipToEmail","SKU","Quantity","SerialNo","LOTNo","ExpiryDate","CODCurrency","CODAmount",
  "ShipToGPS","TotalUnitCost","TotalSalesPrice","ShipmentValue","ShipmentValueCurrency",
  "InsuranceCurrency","InsuranceAmount","CarrierNotes",
];

// SMSA rejects rows where the mobile lacks the 966 country code — the sample
// file's clean rows all start with 966. Strip anything non-digit first so
// "+966 55 123 4567" and "00966..." and "055..." all land at "9665512..."
function normalizeKsaPhone(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("966")) return digits;
  if (digits.startsWith("00966")) return digits.slice(2);
  if (digits.startsWith("0")) return "966" + digits.slice(1);
  return "966" + digits;
}

// The sample uses a CSV-shaped string in ShipToAddress2 like
// "أحمد على المبارك,جدة,Saudi Arabia" — street + city + country in one cell.
// Mirror that; SMSA's importer keys on the commas.
function composeAddress2(a1: string, a2: string, city: string, country: string): string {
  const street = [a1, a2].filter(Boolean).join(" ").trim();
  const cityStr = (city || "").trim();
  const countryStr = country === "SA" ? "Saudi Arabia" : (country || "Saudi Arabia").trim();
  return [street, cityStr, countryStr].filter(Boolean).join(",");
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const uids: string[] = Array.isArray(body?.uids) ? body.uids : [];
  if (uids.length === 0) {
    return NextResponse.json({ error: "no uids provided" }, { status: 400 });
  }

  const orders = await OrdersRepository.getDispatchDetailsByUids(uids);
  if (orders.length === 0) {
    return NextResponse.json({ error: "no orders found" }, { status: 404 });
  }

  // ShipDate uses today's date at midnight — the sample file's format.
  const shipDate = new Date().toISOString().slice(0, 10) + " 00:00:00";
  const rows: (string | number)[][] = [HEADERS];
  const skipped: string[] = [];

  for (const o of orders) {
    const phone = normalizeKsaPhone(o.customer_phone);
    const address2 = composeAddress2(
      o.shipping_address1, o.shipping_address2, o.city, o.country
    );
    const items = Array.isArray(o.line_items) ? o.line_items : [];
    if (items.length === 0) { skipped.push(o.order_number); continue; }

    // ONE ROW PER SKU — same customer info repeats across N rows if an order
    // has N line items. That's how SMSA structures it.
    for (const li of items) {
      const sku = ((li.sku as string) || "").trim();
      if (!sku) continue;
      const row = new Array(34).fill("");
      row[0]  = o.order_number;                                 // ReferenceNumber
      row[2]  = "SMSA";                                         // ShipCarrier
      row[3]  = "DLV";                                          // ShipService
      row[6]  = shipDate;                                       // ShipDate
      row[8]  = phone;                                          // ShipToMobile
      row[9]  = o.customer_name || "";                          // ShipToName
      row[10] = "OMNIASTORES LLC (KSA FULFILLMENT)";            // ShipToCompany
      row[12] = address2;                                       // ShipToAddress2
      row[13] = o.city || "";                                   // ShipToCity
      row[16] = o.country === "SA" ? "Saudi Arabia" : (o.country || "Saudi Arabia");
      row[17] = phone;                                          // ShipToPhone
      row[19] = sku;                                            // SKU
      row[20] = Number(li.qty || 1);                            // Quantity
      row[25] = o.gateway === "COD" ? Number(o.gross_aed || 0) : 0; // CODAmount
      rows.push(row);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `SMSA_KSA_dispatch_${today}_${orders.length}orders.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Skipped-Orders": skipped.join(","),  // devtools-visible for diagnostics
    },
  });
}