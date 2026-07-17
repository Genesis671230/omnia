// Ontrack-style shipping invoice — a two-up label (the same block printed
// twice per A4 page, matching the founder's own courier paperwork), not a
// itemized tax invoice. Generated on demand, not stored; the founder edits
// the prefilled fields in the UI before generating since street address and
// a customer ID aren't captured anywhere in the synced order data today.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type InvoiceFields = {
  orderNumber: string;
  invoiceNo: string;
  customerId: string;
  date: string; // display string, already formatted by the caller
  customerName: string;
  address1: string;
  address2: string;
  mobile: string;
  additionalNotes: string;
  remarks: string;
  orderValue: number;
  shipping: number;
  total: number;
  paid: string; // "Yes" / "No" / "COD" — free text, not a boolean, matches the source label
  courier: string;
  currency: string;
};

// Helvetica/WinAnsi can only encode Latin-1-ish text — Omnia's customer
// names and cities are often Arabic. Strip anything outside that range
// rather than crash the whole invoice; the founder still gets a usable PDF.
function winAnsiSafe(text: string): string {
  const kept = Array.from(text || "").filter((ch) => ch.codePointAt(0)! <= 0xff).join("");
  return kept.trim() || "—";
}

function drawBlock(page: import("pdf-lib").PDFPage, top: number, f: InvoiceFields, fonts: { bold: any; font: any }) {
  const { bold, font } = fonts;
  const ink = rgb(0.12, 0.11, 0.09);
  const muted = rgb(0.5, 0.47, 0.43);
  const gold = rgb(0.69, 0.51, 0.26);
  const left = 48;
  let y = top;

  const draw = (text: string, opts: { size?: number; f?: any; color?: any; x?: number } = {}) => {
    page.drawText(winAnsiSafe(text), { x: opts.x ?? left, y, size: opts.size ?? 10.5, font: opts.f ?? font, color: opts.color ?? ink });
  };
  const row = (label: string, value: string, opts: { size?: number } = {}) => {
    draw(label, { f: bold, size: opts.size, color: muted });
    draw(value, { x: left + 110, size: opts.size });
    y -= 18;
  };

  draw("OMNIA STORES", { size: 16, f: bold, color: gold });
  y -= 22;

  row("Date:", f.date);
  row("Customer ID:", f.customerId || "—");
  row("Invoice No#", f.invoiceNo);
  y -= 6;

  draw("SHIP TO:", { f: bold, size: 9.5, color: muted });
  y -= 16;
  row("Name:", f.customerName || "—");
  row("Address:", f.address1 || "—");
  row("Address:", f.address2 || "—");
  row("Mobile:", f.mobile || "—");
  row("Courier:", f.courier || "—");
  y -= 4;

  draw("Additional Notes:", { f: bold, size: 9.5, color: muted });
  y -= 14;
  draw(f.additionalNotes || "—", { size: 9.5 });
  y -= 22;

  page.drawLine({ start: { x: left, y }, end: { x: 300, y }, thickness: 0.75, color: rgb(0.85, 0.81, 0.73) });
  y -= 16;

  const money = (v: number) => `${f.currency} ${v.toFixed(2)}`;
  row("REMARKS", f.remarks || "—", { size: 9.5 });
  row("ORDER VALUE", money(f.orderValue));
  row("SHIPPING", money(f.shipping));
  draw("TOTAL", { f: bold, color: ink });
  draw(money(f.total), { x: left + 110, f: bold, color: gold });
  y -= 18;
  row("PAID", f.paid || "—");
}

export async function buildInvoicePdf(fields: InvoiceFields): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Two-up: the identical block printed twice per page, top and bottom half,
  // matching the founder's existing Ontrack courier paperwork so it can be
  // cut in half and one copy kept, one copy travels with the shipment.
  drawBlock(page, 800, fields, { bold, font });
  page.drawLine({ start: { x: 20, y: 421 }, end: { x: 575, y: 421 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8), dashArray: [3, 3] });
  drawBlock(page, 400, fields, { bold, font });

  return doc.save();
}
