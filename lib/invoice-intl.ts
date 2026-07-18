// International commercial invoice — the itemized customs invoice used for
// every non-UAE order (SMSA destinations). This is a pixel-guided reproduction
// of the founder's real sample, `#SA3671, Saudi Arabia.pdf`: www.omniastores.com
// header, INVOICE title, a DATE / INVOICE # / Customer ID strip, side-by-side
// SHIP TO + BILL TO blocks, the SALESPERSON/P.O.#/SHIP DATE/SHIP VIA/F.O.B./
// TERMS strip, an ITEM # / DESCRIPTION / QTY / UNIT PRICE / TOTAL line table,
// SUBTOTAL / Shipping / TOTAL, and the "Make all checks payable to OmniaStores
// LLC" footer. Unlike lib/invoice.ts (Ontrack) this is a single A4 page, not a
// two-up label.
//
// Amounts are always AED — the order's stored totals (total_aed / gross_aed)
// are already AED and the sample's columns are literally headed "AED", even for
// a SAR-priced KSA order.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { winAnsiSafe } from "@/lib/invoice";

export type IntlInvoiceItem = {
  itemNo: string;      // the order number (per spec — not a customs HS code)
  description: string; // product title + editable origin note
  qty: number;
  unitPrice: number;   // AED
};

export type IntlInvoiceFields = {
  invoiceNo: string;
  customerId: string;
  date: string;        // caller-formatted display string
  name: string;
  address: string;     // multi-line-ish; wrapped to the block width
  tel: string;
  email: string;
  shipDate: string;
  terms: string;
  items: IntlInvoiceItem[];
  shipping: number;    // AED
  currency: string;    // "AED"
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

const INK = rgb(0.12, 0.11, 0.09);
const MUTED = rgb(0.45, 0.43, 0.4);
const GOLD = rgb(0.69, 0.51, 0.26);
const LINE = rgb(0.82, 0.79, 0.73);
const BAND = rgb(0.94, 0.92, 0.88);

const LEFT = 48;
const RIGHT = 547;
const WIDTH = RIGHT - LEFT;

type Fonts = { bold: PDFFont; font: PDFFont };

function money(currency: string, v: number): string {
  return `${currency} ${(v || 0).toFixed(2)}`;
}

// Truncate to fit a column so a long product title can't overrun into the next
// cell — the item table uses fixed row heights, so wrapping isn't an option.
function fit(font: PDFFont, text: string, size: number, maxWidth: number): string {
  const t = winAnsiSafe(text);
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
  let s = t;
  while (s.length > 1 && font.widthOfTextAtSize(s + "…", size) > maxWidth) s = s.slice(0, -1);
  return s + "…";
}

// Simple greedy word-wrap for the address block (variable line count).
function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = winAnsiSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : ["—"];
}

function textRight(page: PDFPage, text: string, right: number, y: number, opts: { size: number; font: PDFFont; color: ReturnType<typeof rgb> }) {
  const w = opts.font.widthOfTextAtSize(text, opts.size);
  page.drawText(text, { x: right - w, y, size: opts.size, font: opts.font, color: opts.color });
}

export async function buildIntlInvoicePdf(fields: IntlInvoiceFields): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fonts: Fonts = { bold, font };

  let y = 800;

  // ── Header: OMNIA STORES wordmark + site (left), INVOICE title (right) ──
  page.drawText("OMNIA STORES", { x: LEFT, y, size: 18, font: bold, color: INK });
  page.drawText("www.omniastores.com", { x: LEFT, y: y - 14, size: 9, font, color: MUTED });
  textRight(page, "INVOICE", RIGHT, y - 4, { size: 26, font: bold, color: GOLD });
  y -= 44;

  // ── DATE / INVOICE # / Customer ID strip ───────────────────────────────
  drawStrip(page, y, [
    ["DATE", fields.date],
    ["INVOICE #", fields.invoiceNo],
    ["CUSTOMER ID", fields.customerId || "—"],
  ], fonts);
  y -= 40;

  // ── SHIP TO / BILL TO (identical blocks side by side) ───────────────────
  const addrLines = wrap(font, fields.address, 8.5, WIDTH / 2 - 24);
  const partyLines = [
    winAnsiSafe(fields.name) || "—",
    ...addrLines,
    `Tel: ${winAnsiSafe(fields.tel) || "—"}`,
    `Email: ${winAnsiSafe(fields.email) || "—"}`,
  ];
  const blockH = 20 + partyLines.length * 12 + 8;
  const midX = LEFT + WIDTH / 2;
  drawParty(page, LEFT, y, WIDTH / 2 - 6, blockH, "SHIP TO:", partyLines, fonts);
  drawParty(page, midX + 6, y, WIDTH / 2 - 6, blockH, "BILL TO:", partyLines, fonts);
  y -= blockH + 14;

  // ── SALESPERSON / P.O. # / SHIP DATE / SHIP VIA / F.O.B. / TERMS strip ──
  drawStrip(page, y, [
    ["SALESPERSON", "-"],
    ["P.O. #", "-"],
    ["SHIP DATE", fields.shipDate || "-"],
    ["SHIP VIA", "SMSA"],
    ["F.O.B.", "-"],
    ["TERMS", fields.terms || "-"],
  ], fonts);
  y -= 44;

  // ── Items table ─────────────────────────────────────────────────────────
  // Columns: ITEM # | DESCRIPTION | QTY | UNIT PRICE AED | TOTAL AED
  const cItem = LEFT;
  const cDesc = LEFT + 60;
  const cQty = RIGHT - 187;
  const cUnit = RIGHT - 149;
  const cTotal = RIGHT - 77;
  const headH = 20;

  page.drawRectangle({ x: LEFT, y: y - headH, width: WIDTH, height: headH, color: INK });
  const th = (t: string, x: number) => page.drawText(t, { x: x + 5, y: y - headH + 6, size: 8, font: bold, color: rgb(1, 1, 1) });
  th("ITEM #", cItem);
  th("DESCRIPTION", cDesc);
  th("QTY", cQty);
  th("UNIT PRICE", cUnit);
  textRight(page, "TOTAL AED", RIGHT - 5, y - headH + 6, { size: 8, font: bold, color: rgb(1, 1, 1) });
  y -= headH;

  const rowH = 22;
  const cur = fields.currency || "AED";
  let subtotal = 0;
  const rows = fields.items.length ? fields.items : [{ itemNo: fields.invoiceNo, description: "—", qty: 0, unitPrice: 0 }];
  rows.forEach((it, i) => {
    const lineTotal = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
    subtotal += lineTotal;
    const ty = y - rowH + 7;
    if (i % 2 === 1) page.drawRectangle({ x: LEFT, y: y - rowH, width: WIDTH, height: rowH, color: rgb(0.98, 0.97, 0.95) });
    page.drawText(fit(font, it.itemNo, 8.5, cDesc - cItem - 8), { x: cItem + 5, y: ty, size: 8.5, font, color: INK });
    page.drawText(fit(font, it.description, 8.5, cQty - cDesc - 8), { x: cDesc + 5, y: ty, size: 8.5, font, color: INK });
    page.drawText(String(it.qty ?? 0), { x: cQty + 5, y: ty, size: 8.5, font, color: INK });
    page.drawText(money(cur, it.unitPrice).replace(`${cur} `, ""), { x: cUnit + 5, y: ty, size: 8.5, font, color: INK });
    textRight(page, money(cur, lineTotal).replace(`${cur} `, ""), RIGHT - 5, ty, { size: 8.5, font, color: INK });
    page.drawLine({ start: { x: LEFT, y: y - rowH }, end: { x: RIGHT, y: y - rowH }, thickness: 0.5, color: LINE });
    y -= rowH;
  });
  // outer border + column dividers
  const tableTop = y + rows.length * rowH;
  page.drawRectangle({ x: LEFT, y, width: WIDTH, height: tableTop - y, borderColor: LINE, borderWidth: 0.75 });
  for (const cx of [cDesc, cQty, cUnit, cTotal]) {
    page.drawLine({ start: { x: cx, y: tableTop }, end: { x: cx, y }, thickness: 0.5, color: LINE });
  }
  y -= 14;

  // ── Totals (right) + comments (left) ────────────────────────────────────
  const total = subtotal + (Number(fields.shipping) || 0);
  const labelX = RIGHT - 200;
  const totalRow = (label: string, value: string, emphasize = false) => {
    page.drawText(label, { x: labelX, y, size: emphasize ? 10 : 9, font: emphasize ? bold : font, color: emphasize ? INK : MUTED });
    textRight(page, value, RIGHT, y, { size: emphasize ? 10 : 9, font: emphasize ? bold : font, color: emphasize ? GOLD : INK });
    y -= 16;
  };
  page.drawText("Other Comments or Special Instructions", { x: LEFT, y, size: 8, font: bold, color: MUTED });
  totalRow("SUBTOTAL", money(cur, subtotal));
  totalRow("Shipping", money(cur, fields.shipping));
  page.drawLine({ start: { x: labelX, y: y + 6 }, end: { x: RIGHT, y: y + 6 }, thickness: 0.5, color: LINE });
  totalRow("TOTAL", money(cur, total), true);
  y -= 20;

  // ── Footer ──────────────────────────────────────────────────────────────
  page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.5, color: LINE });
  y -= 16;
  page.drawText("Make all checks payable to OmniaStores LLC", { x: LEFT, y, size: 9, font: bold, color: INK });
  y -= 14;
  page.drawText(
    `If you have any questions about this invoice, please contact ${winAnsiSafe(fields.contactName)}, ${fields.contactEmail}, Phone# ${fields.contactPhone}`,
    { x: LEFT, y, size: 8, font, color: MUTED, maxWidth: WIDTH },
  );
  y -= 20;
  const thanks = "Thank You For Your Business!";
  const tw = bold.widthOfTextAtSize(thanks, 11);
  page.drawText(thanks, { x: LEFT + (WIDTH - tw) / 2, y, size: 11, font: bold, color: GOLD });

  return doc.save();
}

// A horizontal labelled strip: a banded header row of small-caps labels with
// their values in the row below, boxed and column-divided. Used for both the
// DATE/INVOICE#/Customer ID row and the SALESPERSON/.../TERMS row.
function drawStrip(page: PDFPage, top: number, cells: [string, string][], { bold, font }: Fonts) {
  const n = cells.length;
  const colW = WIDTH / n;
  const headH = 15;
  const valH = 17;
  page.drawRectangle({ x: LEFT, y: top - headH, width: WIDTH, height: headH, color: BAND });
  page.drawRectangle({ x: LEFT, y: top - headH - valH, width: WIDTH, height: headH + valH, borderColor: LINE, borderWidth: 0.75 });
  cells.forEach(([label, value], i) => {
    const x = LEFT + i * colW;
    page.drawText(label, { x: x + 5, y: top - headH + 4, size: 6.5, font: bold, color: MUTED });
    page.drawText(fit(font, value, 8.5, colW - 8), { x: x + 5, y: top - headH - valH + 5, size: 8.5, font, color: INK });
    if (i > 0) page.drawLine({ start: { x, y: top }, end: { x, y: top - headH - valH }, thickness: 0.5, color: LINE });
  });
}

// One SHIP TO / BILL TO block: a black header bar and a bordered body holding
// the party's name/address/tel/email lines.
function drawParty(page: PDFPage, x: number, top: number, w: number, h: number, title: string, lines: string[], { bold, font }: Fonts) {
  const barH = 16;
  page.drawRectangle({ x, y: top - barH, width: w, height: barH, color: INK });
  page.drawText(title, { x: x + 5, y: top - barH + 5, size: 8.5, font: bold, color: rgb(1, 1, 1) });
  page.drawRectangle({ x, y: top - h, width: w, height: h, borderColor: LINE, borderWidth: 0.75 });
  let ly = top - barH - 12;
  lines.forEach((ln, i) => {
    page.drawText(fit(font, ln, 8.5, w - 12), { x: x + 6, y: ly, size: 8.5, font: i === 0 ? bold : font, color: INK });
    ly -= 12;
  });
}
