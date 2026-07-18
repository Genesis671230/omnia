// Ontrack-style shipping invoice — a two-up label (the same block printed
// twice per A4 page, matching the founder's own courier paperwork), not an
// itemized tax invoice. Generated on demand, not stored; the founder edits
// the prefilled fields in the UI before generating since street address and
// a customer ID aren't captured anywhere in the synced order data today.
//
// Layout is a pixel-match of the founder's real Ontrack invoice sample
// (OMNIA / ON TRACK letterhead, boxed invoice number, black-bar SHIP TO and
// REMARKS tables) — see the reference PDF this was built against before
// changing row order, borders, or the header.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

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
  // When set, the TOTAL cell renders this text (e.g. "PAID") instead of the
  // numeric total — the founder's rule for an already-paid order. Absent =
  // ordinary numeric total.
  totalLabel?: string;
  paid: string; // "Yes" / "No" / "COD" — free text, not a boolean, matches the source label
  courier: string;
  currency: string;
};

// Helvetica/WinAnsi can only encode Latin-1-ish text — Omnia's customer
// names and cities are often Arabic. Strip anything outside that range
// rather than crash the whole invoice; the founder still gets a usable PDF.
export function winAnsiSafe(text: string): string {
  const kept = Array.from(text || "").filter((ch) => ch.codePointAt(0)! <= 0xff).join("");
  return kept.trim() || "—";
}

const INK = rgb(0.12, 0.11, 0.09);
const MUTED = rgb(0.45, 0.43, 0.4);
const GOLD = rgb(0.69, 0.51, 0.26);
const SLATE = rgb(0.28, 0.34, 0.4);
const LINE = rgb(0.82, 0.79, 0.73);

const LEFT = 48;
const RIGHT = 547;
const WIDTH = RIGHT - LEFT;

type Fonts = { bold: PDFFont; font: PDFFont; italic: PDFFont };

function letterSpacedWidth(font: PDFFont, text: string, size: number, spacing: number): number {
  return font.widthOfTextAtSize(text, size) + spacing * Math.max(text.length - 1, 0);
}

function drawLetterSpaced(page: PDFPage, text: string, x: number, y: number, opts: { size: number; font: PDFFont; color: ReturnType<typeof rgb>; spacing: number }) {
  let cx = x;
  for (const ch of text) {
    page.drawText(ch, { x: cx, y, size: opts.size, font: opts.font, color: opts.color });
    cx += opts.font.widthOfTextAtSize(ch, opts.size) + opts.spacing;
  }
}

function money(currency: string, v: number): string {
  return v ? `${currency} ${v.toFixed(2)}` : "-";
}

// One printed block — the founder's real invoice repeats this identically,
// top and bottom half of the page, so it can be cut in half.
function drawBlock(page: PDFPage, top: number, f: InvoiceFields, fonts: Fonts) {
  const { bold, font, italic } = fonts;
  let y = top;

  // ── Letterhead: OMNIA on the left, ON TRACK on the right ──────────────
  drawLetterSpaced(page, "OMNIA", LEFT, y, { size: 19, font: bold, color: INK, spacing: 2 });
  drawLetterSpaced(page, "LUXURY FASHION JEWELLERY STORE", LEFT, y - 13, { size: 6, font, color: MUTED, spacing: 0.6 });

  const onTrack = "ON TRACK";
  const onTrackSize = 15;
  const onTrackW = letterSpacedWidth(bold, onTrack, onTrackSize, 1.5);
  drawLetterSpaced(page, onTrack, RIGHT - onTrackW, y, { size: onTrackSize, font: bold, color: SLATE, spacing: 1.5 });
  const tagline = "We deliver";
  const taglineW = italic.widthOfTextAtSize(tagline, 8);
  page.drawText(tagline, { x: RIGHT - taglineW, y: y - 13, size: 8, font: italic, color: MUTED });
  y -= 42;

  // ── Date / Customer ID (left) + boxed Invoice No# (right) ─────────────
  const labelX = LEFT, valueX = LEFT + 78;
  page.drawText("Date:", { x: labelX, y, size: 10, font: bold, color: INK });
  page.drawText(f.date, { x: valueX, y, size: 10, font, color: INK });
  const dateRowY = y;
  y -= 18;
  page.drawText("Customer ID:", { x: labelX, y, size: 10, font: bold, color: INK });
  page.drawText(f.customerId || "—", { x: valueX, y, size: 10, font, color: INK });

  const boxX = 300, boxW = RIGHT - boxX, boxTop = dateRowY + 12, boxH = 34;
  page.drawRectangle({ x: boxX, y: boxTop - boxH, width: boxW, height: boxH, borderColor: INK, borderWidth: 1 });
  const invoiceLabel = `Invoice No# ${f.invoiceNo}`;
  const invoiceLabelW = bold.widthOfTextAtSize(invoiceLabel, 12);
  page.drawText(invoiceLabel, { x: boxX + (boxW - invoiceLabelW) / 2, y: boxTop - boxH / 2 - 4, size: 12, font: bold, color: INK });
  y -= 26;

  // ── SHIP TO table ───────────────────────────────────────────────────
  const barH = 18;
  page.drawRectangle({ x: LEFT, y: y - barH, width: WIDTH, height: barH, color: INK });
  page.drawText("SHIP TO:", { x: LEFT + 6, y: y - barH + 5, size: 9.5, font: bold, color: rgb(1, 1, 1) });
  y -= barH;

  const shipRows: [string, string][] = [
    ["Name:", f.customerName || "—"],
    ["Address:", f.address1 || "—"],
    ["Address:", f.address2 || "—"],
    ["Mobile:", f.mobile || "—"],
    ["Additional Notes:", f.additionalNotes || ""],
  ];
  const rowH = 20;
  const colDivX = LEFT + 108;
  for (const [label, value] of shipRows) {
    page.drawText(label, { x: LEFT + 6, y: y - rowH + 7, size: 9, font: bold, color: INK });
    page.drawText(value, { x: colDivX + 6, y: y - rowH + 7, size: 9, font, color: INK, maxWidth: RIGHT - colDivX - 12 });
    page.drawLine({ start: { x: LEFT, y: y - rowH }, end: { x: RIGHT, y: y - rowH }, thickness: 0.75, color: LINE });
    y -= rowH;
  }
  const tableTop = y + shipRows.length * rowH + barH;
  page.drawRectangle({ x: LEFT, y, width: WIDTH, height: tableTop - y, borderColor: LINE, borderWidth: 0.75 });
  page.drawLine({ start: { x: colDivX, y }, end: { x: colDivX, y: tableTop - barH }, thickness: 0.75, color: LINE });
  y -= 16;

  // ── REMARKS / ORDER VALUE / SHIPPING / TOTAL table ─────────────────
  const cols = 4, colW = WIDTH / cols;
  const headers = ["REMARKS", "ORDER VALUE", "SHIPPING", "TOTAL"];
  page.drawRectangle({ x: LEFT, y: y - barH, width: WIDTH, height: barH, color: INK });
  headers.forEach((h, i) => {
    page.drawText(h, { x: LEFT + i * colW + 6, y: y - barH + 5, size: 8.5, font: bold, color: rgb(1, 1, 1) });
  });
  y -= barH;

  const values = [f.remarks || "—", money(f.currency, f.orderValue), money(f.currency, f.shipping), f.totalLabel || money(f.currency, f.total)];
  const dataRowH = 24;
  values.forEach((v, i) => {
    const cx = LEFT + i * colW;
    const w = bold.widthOfTextAtSize(v, 9.5);
    page.drawText(v, { x: cx + (colW - w) / 2, y: y - dataRowH + 9, size: 9.5, font: bold, color: i === 0 ? INK : GOLD });
  });
  page.drawRectangle({ x: LEFT, y: y - dataRowH, width: WIDTH, height: barH + dataRowH, borderColor: LINE, borderWidth: 0.75 });
  for (let i = 1; i < cols; i++) {
    const cx = LEFT + i * colW;
    page.drawLine({ start: { x: cx, y: y + barH }, end: { x: cx, y: y - dataRowH }, thickness: 0.75, color: LINE });
  }
}

export async function buildInvoicePdf(fields: InvoiceFields): Promise<Uint8Array> {
  // winAnsiSafe() turns "" into "—"; additionalNotes should stay genuinely
  // blank when the founder left it empty, matching the sample — everything
  // else falls back to "—" for a missing value.
  const safeFields: InvoiceFields = {
    ...fields,
    customerName: winAnsiSafe(fields.customerName),
    address1: winAnsiSafe(fields.address1),
    address2: winAnsiSafe(fields.address2),
    additionalNotes: fields.additionalNotes ? winAnsiSafe(fields.additionalNotes) : "",
    remarks: fields.remarks ? winAnsiSafe(fields.remarks) : "—",
  };

  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const fonts: Fonts = { bold, font, italic };

  // Two-up: the identical block printed twice per page, top and bottom half,
  // matching the founder's existing Ontrack courier paperwork so it can be
  // cut in half — one copy kept, one copy travels with the shipment.
  drawBlock(page, 800, safeFields, fonts);
  page.drawLine({ start: { x: 20, y: 421 }, end: { x: 575, y: 421 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8), dashArray: [3, 3] });
  drawBlock(page, 400, safeFields, fonts);

  return doc.save();
}
