// On Track Delivery Services — "Client Payment Voucher" PDF.
//
// One voucher = one remittance to us. Columns (left → right on the page):
//   Status · Client Money · Del Price · Pro Price · Customer Address · Mob No
//   · Customer · Bill No · Voucher No · SL
//
//   Client Money  what OnTrack pays us for the row (can be negative)
//   Del Price     their delivery charge EXCLUDING VAT (28.57 = 30 / 1.05)
//   Pro Price     what the customer paid the driver (0 = prepaid order)
//
// So a row is one of two things:
//   Pro Price > 0  → a COD order: the customer paid Pro Price in cash, OnTrack
//                    kept its fee (Pro Price − Client Money, VAT-inclusive)
//                    and remits the rest. Its invoice closes in full.
//   Pro Price = 0  → only a delivery charge (the order was prepaid through a
//                    gateway, or "rtn" — a return): Client Money is −30, an
//                    expense netted out of the remittance. No invoice to close.
//
// Why positioned text and not the plain text layer: flattened, a row reads
// "Delivered 0.0028.57-30.00 10508781313 80543" — three amounts glued
// together and SL glued to the phone number. The x position of each cell is
// unambiguous, and the header row tells us where each column starts.
// Bill No wraps onto the next line(s) ("80543" / "6" = 805436, "rtn" /
// "wa557" / "36" = return of WA55736), so a row owns every item down to the
// next row's Status cell.

import type { ParsedPayout, PayoutTransactionShare } from "./payouts";

export type PdfItem = { s: string; x: number; y: number };

export type CodDeliveryCharge = {
  /** Order the charge is for (normalised, e.g. "805436", "WA55736"). */
  ref: string;
  /** What OnTrack kept, VAT-inclusive (positive). */
  amount: number;
  /** The same, excluding VAT (Del Price). */
  exVat: number;
  vat: number;
  isReturn: boolean;
  voucherNo: string;
  status: string;
};

export type OnTrackVoucher = {
  cpNo: string;
  date: string | null;
  cod: { ref: string; proPrice: number; clientMoney: number; delPrice: number; voucherNo: string; status: string }[];
  charges: CodDeliveryCharge[];
  totalAmount: number | null;
  totalCount: number | null;
};

const HEADERS = {
  status: /^status$/i,
  clientMoney: /^client\s*money$/i,
  delPrice: /^del\s*price$/i,
  proPrice: /^pro\s*price$/i,
  address: /^customer\s*address$/i,
  mob: /^mob\s*no$/i,
  customer: /^customer$/i,
  bill: /^bill\s*no$/i,
  voucher: /^voucher\s*no$/i,
  sl: /^sl$/i,
} as const;
type Col = keyof typeof HEADERS;

const MONEY_RE = /^-?[\d,]+\.\d{2}$/;
const money = (s: string) => Number(s.replace(/,/g, ""));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Column bands from the header row: each column starts a little left of its
 *  label (values are right-aligned under it) and runs to the next one. */
function columnBands(items: PdfItem[]): { col: Col; from: number; to: number }[] | null {
  const found: { col: Col; x: number }[] = [];
  for (const [col, re] of Object.entries(HEADERS) as [Col, RegExp][]) {
    const hit = items.find((i) => re.test(i.s.trim()));
    if (hit) found.push({ col, x: hit.x });
  }
  const need: Col[] = ["status", "clientMoney", "delPrice", "proPrice", "bill"];
  if (!need.every((c) => found.some((f) => f.col === c))) return null;
  found.sort((a, b) => a.x - b.x);
  return found.map((f, i) => ({
    col: f.col,
    from: f.x - 12,
    to: i + 1 < found.length ? found[i + 1].x - 12 : Infinity,
  }));
}

export function parseOnTrackVoucherPages(pages: PdfItem[][]): OnTrackVoucher {
  const all = pages.flat();
  const text = all.map((i) => i.s).join(" ");
  const cpNo = /\(CP(\d+)\)/i.exec(text)?.[1] ?? /\bCP\s*(\d{4,})\b/i.exec(text)?.[1] ?? "";
  if (!/on\s*track/i.test(text) || !/client\s*money/i.test(text)) {
    throw new Error("Not an OnTrack Client Payment Voucher (no 'On Track' / 'Client Money' header found).");
  }
  const dateRaw = /Date\s*:\s*(\d{1,2}-[A-Za-z]+-\d{4})/.exec(text)?.[1] ?? null;
  const date = dateRaw ? toIsoDate(dateRaw) : null;

  const out: OnTrackVoucher = { cpNo, date, cod: [], charges: [], totalAmount: null, totalCount: null };
  let bands: ReturnType<typeof columnBands> = null;

  for (const page of pages) {
    bands = columnBands(page) ?? bands; // later pages may omit the header
    if (!bands) continue;
    const band = (x: number): Col | null => bands!.find((b) => x >= b.from && x < b.to)?.col ?? null;
    // Rows sit below this page's header row; a continuation page has none.
    const headerYs = page.filter((i) => HEADERS.status.test(i.s.trim()) || HEADERS.clientMoney.test(i.s.trim())).map((i) => i.y);
    const headerY = headerYs.length ? Math.min(...headerYs) : Infinity;

    // A row starts at its Client Money amount — every row has exactly one, on
    // its first line. (Anchoring on the Status word broke on a status that
    // wraps: "Delivered With" / "Price Change", printed left of the column.)
    const anchors = page
      .filter((i) => band(i.x) === "clientMoney" && MONEY_RE.test(i.s.trim()) && i.y < headerY)
      .sort((a, b) => b.y - a.y);

    anchors.forEach((a, idx) => {
      const top = a.y + 2;
      const bottom = idx + 1 < anchors.length ? anchors[idx + 1].y + 2 : -Infinity;
      const cells = page.filter((i) => i.y <= top && i.y > bottom).sort((p, q) => q.y - p.y || p.x - q.x);
      const pick = (c: Col) => cells.filter((i) => band(i.x) === c).map((i) => i.s.trim()).filter(Boolean);
      const num = (c: Col) => {
        const v = pick(c).find((s) => MONEY_RE.test(s));
        return v == null ? null : money(v);
      };
      const clientMoney = num("clientMoney");
      const proPrice = num("proPrice");
      const delPrice = num("delPrice");
      if (clientMoney == null || proPrice == null) return; // not a data row (footer text in the band)

      const billParts = pick("bill");
      const isReturn = billParts[0]?.toLowerCase() === "rtn";
      // "#3492" is printed for some stores; our order numbers carry no "#".
      const ref = (isReturn ? billParts.slice(1) : billParts).join("").replace(/\s+/g, "").replace(/^#/, "").toUpperCase();
      const voucherNo = pick("voucher").join("");
      // Status text may start a few points left of its column and wrap.
      const status = cells.filter((i) => i.x < (bands!.find((b) => b.col === "clientMoney")?.from ?? 100) && /^[A-Za-z]/.test(i.s.trim()) && !/^total/i.test(i.s.trim()))
        .map((i) => i.s.trim()).join(" ") || "Delivered";

      if (proPrice > 0) {
        out.cod.push({ ref, proPrice, clientMoney, delPrice: delPrice ?? 0, voucherNo, status });
      } else {
        const amount = r2(-clientMoney);
        const exVat = delPrice ?? r2(amount / 1.05);
        out.charges.push({ ref, amount, exVat, vat: r2(amount - exVat), isReturn, voucherNo, status });
      }
    });

    // Footer: "Total Count 26" / "Total Amount 1,482.00" (values sit on roughly the same line).
    for (const label of page.filter((i) => /^total\s*(amount|count)$/i.test(i.s.trim()))) {
      const isAmount = /amount/i.test(label.s);
      const near = page
        .filter((i) => i !== label && Math.abs(i.y - label.y) <= 4 && (isAmount ? MONEY_RE.test(i.s.trim()) : /^\d+$/.test(i.s.trim())))
        .sort((p, q) => Math.abs(p.y - label.y) - Math.abs(q.y - label.y))[0];
      if (near) {
        if (isAmount) out.totalAmount = money(near.s.trim());
        else out.totalCount = Number(near.s.trim());
      }
    }
  }
  return out;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function toIsoDate(s: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]+)-(\d{4})$/.exec(s);
  if (!m) return null;
  const mi = MONTHS.findIndex((x) => x.startsWith(m[2].toLowerCase().slice(0, 3)));
  return mi < 0 ? null : `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** Voucher → the payout the reconciler and the booking bar work with. */
export function onTrackVoucherToPayout(v: OnTrackVoucher, filename: string): ParsedPayout & { deliveryCharges: CodDeliveryCharge[] } {
  const rows = v.cod.length + v.charges.length;
  if (rows === 0) throw new Error("OnTrack voucher: no rows found.");
  const net = r2(v.cod.reduce((s, r) => s + r.clientMoney, 0) - v.charges.reduce((s, c) => s + c.amount, 0));

  // The voucher states its own totals — refuse a parse that doesn't foot.
  if (v.totalCount != null && v.totalCount !== rows) {
    throw new Error(`OnTrack voucher CP${v.cpNo}: read ${rows} rows but the voucher says Total Count ${v.totalCount}. Nothing was saved.`);
  }
  if (v.totalAmount != null && Math.abs(v.totalAmount - net) > 0.01) {
    throw new Error(`OnTrack voucher CP${v.cpNo}: rows add up to AED ${net.toFixed(2)} but the voucher says Total Amount ${v.totalAmount.toFixed(2)}. Nothing was saved.`);
  }
  const missingRef = [...v.cod, ...v.charges].filter((r) => !r.ref);
  if (missingRef.length) throw new Error(`OnTrack voucher CP${v.cpNo}: ${missingRef.length} row(s) have no Bill No.`);

  // A COD order can appear twice (split delivery) — one share per order.
  const byRef = new Map<string, PayoutTransactionShare>();
  for (const r of v.cod) {
    const prev = byRef.get(r.ref);
    const fee = r2(r.proPrice - r.clientMoney);
    byRef.set(r.ref, {
      ref: r.ref,
      grossShare: r2((prev?.grossShare ?? 0) + r.proPrice),
      feeShare: r2((prev?.feeShare ?? 0) + fee),
      netShare: r2((prev?.netShare ?? 0) + r.clientMoney),
      isRefund: false,
      quality: "clean",
    });
  }
  const transactions = [...byRef.values()];
  const gross = r2(transactions.reduce((s, t) => s + t.grossShare, 0));
  const chargesTotal = r2(v.charges.reduce((s, c) => s + c.amount, 0));

  return {
    id: `COD-${v.cpNo || (/(\d{3,})/.exec(filename)?.[1] ?? "UNKNOWN")}`,
    provider: "COD",
    net,
    gross,
    fees: r2(gross - net),
    orderRefs: transactions.map((t) => t.ref),
    transactions,
    deliveryCharges: v.charges,
    source: filename,
    statementNo: v.cpNo ? `CP${v.cpNo}` : undefined,
    notes:
      `OnTrack voucher CP${v.cpNo}${v.date ? ` · ${v.date}` : ""} · ${v.cod.length} COD order(s) AED ${gross.toFixed(2)} collected · ` +
      `${v.charges.length} delivery charge(s) AED ${chargesTotal.toFixed(2)}` +
      `${v.charges.some((c) => c.isReturn) ? ` (${v.charges.filter((c) => c.isReturn).length} return)` : ""} · remitted AED ${net.toFixed(2)}` +
      (v.totalAmount == null ? " · voucher total not found, not cross-checked" : " · matches voucher total"),
  };
}

/** Positioned text items of every page, via unpdf (already a dependency). */
export async function extractPdfItems(buf: Buffer | Uint8Array): Promise<PdfItem[][]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const pages: PdfItem[][] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const tc = await (await pdf.getPage(n)).getTextContent();
    pages.push(
      (tc.items as { str?: string; transform?: number[] }[])
        .filter((i) => i.str && i.str.trim() && i.transform)
        .map((i) => ({ s: i.str!, x: Math.round(i.transform![4]), y: Math.round(i.transform![5]) })),
    );
  }
  return pages;
}

export async function parseOnTrackVoucherPdf(buf: Buffer | Uint8Array, filename: string) {
  return onTrackVoucherToPayout(parseOnTrackVoucherPages(await extractPdfItems(buf)), filename);
}
