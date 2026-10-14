// // On Track Delivery Services — "Client Payment Voucher" PDF.
// //
// // One voucher = one remittance to us. Columns (left → right on the page):
// //   Status · Client Money · Del Price · Pro Price · Customer Address · Mob No
// //   · Customer · Bill No · Voucher No · SL
// //
// //   Client Money  what OnTrack pays us for the row (can be negative)
// //   Del Price     their delivery charge EXCLUDING VAT (28.57 = 30 / 1.05)
// //   Pro Price     what the customer paid the driver (0 = prepaid order)
// //
// // So a row is one of two things:
// //   Pro Price > 0  → a COD order: the customer paid Pro Price in cash, OnTrack
// //                    kept its fee (Pro Price − Client Money, VAT-inclusive)
// //                    and remits the rest. Its invoice closes in full.
// //   Pro Price = 0  → only a delivery charge (the order was prepaid through a
// //                    gateway, or "rtn" — a return): Client Money is −30, an
// //                    expense netted out of the remittance. No invoice to close.
// //
// // Why positioned text and not the plain text layer: flattened, a row reads
// // "Delivered 0.0028.57-30.00 10508781313 80543" — three amounts glued
// // together and SL glued to the phone number. The x position of each cell is
// // unambiguous, and the header row tells us where each column starts.
// // Bill No wraps onto the next line(s) ("80543" / "6" = 805436, "rtn" /
// // "wa557" / "36" = return of WA55736), so a row owns every item down to the
// // next row's Status cell.

// import type { ParsedPayout, PayoutTransactionShare } from "./payouts";

// export type PdfItem = { s: string; x: number; y: number };
// export type CodDeliveryCharge = {
//   /** Merchant order reference, when supplied; otherwise internal invoice. */
//   ref: string;

//   /** Charge netted out of the payout: grossAmount - collectedOffset. */
//   amount: number;

//   /** Unknown when the statement does not provide a VAT breakdown. */
//   exVat: number | null;
//   vat: number | null;

//   isReturn: boolean;
//   voucherNo: string;
//   status: string;

//   /** Additional fields supplied by the merchant-statement parser. */
//   invoiceNo?: string;
//   merchantRef?: string;
//   grossAmount?: number;
//   collectedOffset?: number;
//   isExchange?: boolean;
//   isCancelled?: boolean;
// };

// export type OnTrackVoucher = {
//   /** CP digits for legacy vouchers; full MS identifier for statements. */
//   cpNo: string;
//   statementNo?: string;
//   format?: "legacy" | "merchant-statement";

//   date: string | null;

//   cod: {
//     ref: string;
//     proPrice: number;
//     clientMoney: number;

//     /** Legacy Del Price. Unknown for the new statement. */
//     delPrice: number | null;

//     voucherNo: string;
//     status: string;
//     invoiceNo?: string;
//   }[];

//   charges: CodDeliveryCharge[];

//   totalAmount: number | null;
//   totalCount: number | null;

//   totalCollected?: number | null;
//   totalCharges?: number | null;
// };
// const HEADERS = {
//   status: /^status$/i,
//   clientMoney: /^client\s*money$/i,
//   delPrice: /^del\s*price$/i,
//   proPrice: /^pro\s*price$/i,
//   address: /^customer\s*address$/i,
//   mob: /^mob\s*no$/i,
//   customer: /^customer$/i,
//   bill: /^bill\s*no$/i,
//   voucher: /^voucher\s*no$/i,
//   sl: /^sl$/i,
// } as const;
// type Col = keyof typeof HEADERS;

// const MONEY_RE = /^-?[\d,]+\.\d{2}$/;
// const money = (s: string) => Number(s.replace(/,/g, ""));
// const r2 = (n: number) => Math.round(n * 100) / 100;

// /** Column bands from the header row: each column starts a little left of its
//  *  label (values are right-aligned under it) and runs to the next one. */
// function columnBands(items: PdfItem[]): { col: Col; from: number; to: number }[] | null {
//   const found: { col: Col; x: number }[] = [];
//   for (const [col, re] of Object.entries(HEADERS) as [Col, RegExp][]) {
//     const hit = items.find((i) => re.test(i.s.trim()));
//     if (hit) found.push({ col, x: hit.x });
//   }
//   const need: Col[] = ["status", "clientMoney", "delPrice", "proPrice", "bill"];
//   if (!need.every((c) => found.some((f) => f.col === c))) return null;
//   found.sort((a, b) => a.x - b.x);
//   return found.map((f, i) => ({
//     col: f.col,
//     from: f.x - 12,
//     to: i + 1 < found.length ? found[i + 1].x - 12 : Infinity,
//   }));
// }

// export function parseOnTrackVoucherPages(pages: PdfItem[][]): OnTrackVoucher {
//   const all = pages.flat();
//   const text = all.map((i) => i.s).join(" ");
//   const cpNo = /\(CP(\d+)\)/i.exec(text)?.[1] ?? /\bCP\s*(\d{4,})\b/i.exec(text)?.[1] ?? "";
//   if (!/on\s*track/i.test(text) || !/client\s*money/i.test(text)) {
//     throw new Error("Not an OnTrack Client Payment Voucher (no 'On Track' / 'Client Money' header found).");
//   }
//   const dateRaw = /Date\s*:\s*(\d{1,2}-[A-Za-z]+-\d{4})/.exec(text)?.[1] ?? null;
//   const date = dateRaw ? toIsoDate(dateRaw) : null;

//   const out: OnTrackVoucher = { cpNo, date, cod: [], charges: [], totalAmount: null, totalCount: null };
//   let bands: ReturnType<typeof columnBands> = null;

//   for (const page of pages) {
//     bands = columnBands(page) ?? bands; // later pages may omit the header
//     if (!bands) continue;
//     const band = (x: number): Col | null => bands!.find((b) => x >= b.from && x < b.to)?.col ?? null;
//     // Rows sit below this page's header row; a continuation page has none.
//     const headerYs = page.filter((i) => HEADERS.status.test(i.s.trim()) || HEADERS.clientMoney.test(i.s.trim())).map((i) => i.y);
//     const headerY = headerYs.length ? Math.min(...headerYs) : Infinity;

//     // A row starts at its Client Money amount — every row has exactly one, on
//     // its first line. (Anchoring on the Status word broke on a status that
//     // wraps: "Delivered With" / "Price Change", printed left of the column.)
//     const anchors = page
//       .filter((i) => band(i.x) === "clientMoney" && MONEY_RE.test(i.s.trim()) && i.y < headerY)
//       .sort((a, b) => b.y - a.y);

//     anchors.forEach((a, idx) => {
//       const top = a.y + 2;
//       const bottom = idx + 1 < anchors.length ? anchors[idx + 1].y + 2 : -Infinity;
//       const cells = page.filter((i) => i.y <= top && i.y > bottom).sort((p, q) => q.y - p.y || p.x - q.x);
//       const pick = (c: Col) => cells.filter((i) => band(i.x) === c).map((i) => i.s.trim()).filter(Boolean);
//       const num = (c: Col) => {
//         const v = pick(c).find((s) => MONEY_RE.test(s));
//         return v == null ? null : money(v);
//       };
//       const clientMoney = num("clientMoney");
//       const proPrice = num("proPrice");
//       const delPrice = num("delPrice");
//       if (clientMoney == null || proPrice == null) return; // not a data row (footer text in the band)

//       const billParts = pick("bill");
//       const isReturn = billParts[0]?.toLowerCase() === "rtn";
//       // "#3492" is printed for some stores; our order numbers carry no "#".
//       const ref = (isReturn ? billParts.slice(1) : billParts).join("").replace(/\s+/g, "").replace(/^#/, "").toUpperCase();
//       const voucherNo = pick("voucher").join("");
//       // Status text may start a few points left of its column and wrap.
//       const status = cells.filter((i) => i.x < (bands!.find((b) => b.col === "clientMoney")?.from ?? 100) && /^[A-Za-z]/.test(i.s.trim()) && !/^total/i.test(i.s.trim()))
//         .map((i) => i.s.trim()).join(" ") || "Delivered";

//       if (proPrice > 0) {
//         out.cod.push({ ref, proPrice, clientMoney, delPrice: delPrice ?? 0, voucherNo, status });
//       } else {
//         const amount = r2(-clientMoney);
//         const exVat = delPrice ?? r2(amount / 1.05);
//         out.charges.push({ ref, amount, exVat, vat: r2(amount - exVat), isReturn, voucherNo, status });
//       }
//     });

//     // Footer: "Total Count 26" / "Total Amount 1,482.00" (values sit on roughly the same line).
//     for (const label of page.filter((i) => /^total\s*(amount|count)$/i.test(i.s.trim()))) {
//       const isAmount = /amount/i.test(label.s);
//       const near = page
//         .filter((i) => i !== label && Math.abs(i.y - label.y) <= 4 && (isAmount ? MONEY_RE.test(i.s.trim()) : /^\d+$/.test(i.s.trim())))
//         .sort((p, q) => Math.abs(p.y - label.y) - Math.abs(q.y - label.y))[0];
//       if (near) {
//         if (isAmount) out.totalAmount = money(near.s.trim());
//         else out.totalCount = Number(near.s.trim());
//       }
//     }
//   }
//   return out;
// }

// const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// function toIsoDate(s: string): string | null {
//   const m = /^(\d{1,2})-([A-Za-z]+)-(\d{4})$/.exec(s);
//   if (!m) return null;
//   const mi = MONTHS.findIndex((x) => x.startsWith(m[2].toLowerCase().slice(0, 3)));
//   return mi < 0 ? null : `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
// }

// /** Voucher → the payout the reconciler and the booking bar work with. */
// export function onTrackVoucherToPayout(v: OnTrackVoucher, filename: string): ParsedPayout & { deliveryCharges: CodDeliveryCharge[] } {
//   const rows = v.cod.length + v.charges.length;
//   if (rows === 0) throw new Error("OnTrack voucher: no rows found.");
//   const net = r2(v.cod.reduce((s, r) => s + r.clientMoney, 0) - v.charges.reduce((s, c) => s + c.amount, 0));

//   // The voucher states its own totals — refuse a parse that doesn't foot.
//   if (v.totalCount != null && v.totalCount !== rows) {
//     throw new Error(`OnTrack voucher CP${v.cpNo}: read ${rows} rows but the voucher says Total Count ${v.totalCount}. Nothing was saved.`);
//   }
//   if (v.totalAmount != null && Math.abs(v.totalAmount - net) > 0.01) {
//     throw new Error(`OnTrack voucher CP${v.cpNo}: rows add up to AED ${net.toFixed(2)} but the voucher says Total Amount ${v.totalAmount.toFixed(2)}. Nothing was saved.`);
//   }
//   const missingRef = [...v.cod, ...v.charges].filter((r) => !r.ref);
//   if (missingRef.length) throw new Error(`OnTrack voucher CP${v.cpNo}: ${missingRef.length} row(s) have no Bill No.`);

//   // A COD order can appear twice (split delivery) — one share per order.
//   const byRef = new Map<string, PayoutTransactionShare>();
//   for (const r of v.cod) {
//     const prev = byRef.get(r.ref);
//     const fee = r2(r.proPrice - r.clientMoney);
//     byRef.set(r.ref, {
//       ref: r.ref,
//       grossShare: r2((prev?.grossShare ?? 0) + r.proPrice),
//       feeShare: r2((prev?.feeShare ?? 0) + fee),
//       netShare: r2((prev?.netShare ?? 0) + r.clientMoney),
//       isRefund: false,
//       quality: "clean",
//     });
//   }
//   const transactions = [...byRef.values()];
//   const gross = r2(transactions.reduce((s, t) => s + t.grossShare, 0));
//   const chargesTotal = r2(v.charges.reduce((s, c) => s + c.amount, 0));

//   return {
//     id: `COD-${v.cpNo || (/(\d{3,})/.exec(filename)?.[1] ?? "UNKNOWN")}`,
//     provider: "COD",
//     net,
//     gross,
//     fees: r2(gross - net),
//     orderRefs: transactions.map((t) => t.ref),
//     transactions,
//     deliveryCharges: v.charges,
//     source: filename,
//     statementNo: v.cpNo ? `CP${v.cpNo}` : undefined,
//     notes:
//       `OnTrack voucher CP${v.cpNo}${v.date ? ` · ${v.date}` : ""} · ${v.cod.length} COD order(s) AED ${gross.toFixed(2)} collected · ` +
//       `${v.charges.length} delivery charge(s) AED ${chargesTotal.toFixed(2)}` +
//       `${v.charges.some((c) => c.isReturn) ? ` (${v.charges.filter((c) => c.isReturn).length} return)` : ""} · remitted AED ${net.toFixed(2)}` +
//       (v.totalAmount == null ? " · voucher total not found, not cross-checked" : " · matches voucher total"),
//   };
// }

// /** Positioned text items of every page, via unpdf (already a dependency). */
// export async function extractPdfItems(buf: Buffer | Uint8Array): Promise<PdfItem[][]> {
//   const { getDocumentProxy } = await import("unpdf");
//   const pdf = await getDocumentProxy(new Uint8Array(buf));
//   const pages: PdfItem[][] = [];
//   for (let n = 1; n <= pdf.numPages; n++) {
//     const tc = await (await pdf.getPage(n)).getTextContent();
//     pages.push(
//       (tc.items as { str?: string; transform?: number[] }[])
//         .filter((i) => i.str && i.str.trim() && i.transform)
//         .map((i) => ({ s: i.str!, x: Math.round(i.transform![4]), y: Math.round(i.transform![5]) })),
//     );
//   }
//   return pages;
// }

// export async function parseOnTrackVoucherPdf(buf: Buffer | Uint8Array, filename: string) {
//   return onTrackVoucherToPayout(parseOnTrackVoucherPages(await extractPdfItems(buf)), filename);
// }




// OnTrack payout PDFs.
//
// Supported formats:
// 1. Legacy "Client Payment Voucher":
//    Status · Client Money · Del Price · Pro Price · ... · Bill No
//
// 2. New "Merchant statement":
//    # · Ref · Invoice · Merchant invoice · Customer · Zone · Status
//    · Collected · Charges · Net
//
// One document represents one net settlement.
//
// Ordinary COD deliveries close sale invoices.
// Prepaid deliveries, returns, exchanges, and cancellations do not.
//
// In the new format, exchange/return collections offset their charges;
// they are not treated as new sale collections.
//
// Positioned text is used to preserve column and wrapped-row structure.

import type {
  ParsedPayout,
  PayoutTransactionShare,
} from "./payouts";

export type PdfItem = {
  s: string;
  x: number;
  y: number;
};

export type CodDeliveryCharge = {
  /** Merchant reference when supplied; otherwise internal invoice number. */
  ref: string;

  /**
   * Net deduction from the payout.
   * For merchant statements: grossAmount - collectedOffset.
   * Can be negative when a non-sale row contributes money to the payout.
   */
  amount: number;

  /** Unknown when the document does not provide a VAT breakdown. */
  exVat: number | null;
  vat: number | null;

  isReturn: boolean;
  voucherNo: string;
  status: string;

  invoiceNo?: string;
  merchantRef?: string;

  /** Full delivery charge before any non-sale collection offset. */
  grossAmount?: number;

  /** Collection on an exchange/return/non-sale row. */
  collectedOffset?: number;

  isExchange?: boolean;
  isCancelled?: boolean;
};

export type OnTrackVoucher = {
  /** Legacy CP digits, or full MS identifier for merchant statements. */
  cpNo: string;

  statementNo?: string;
  format?: "legacy" | "merchant-statement";

  date: string | null;

  cod: {
    ref: string;
    proPrice: number;
    clientMoney: number;

    /** Legacy Del Price, excluding VAT; unknown in merchant statements. */
    delPrice: number | null;

    voucherNo: string;
    status: string;
    invoiceNo?: string;
  }[];

  charges: CodDeliveryCharge[];

  totalAmount: number | null;
  totalCount: number | null;

  /** Original merchant-statement totals. */
  totalCollected?: number | null;
  totalCharges?: number | null;
};

type OnTrackParsedPayout = ParsedPayout & {
  deliveryCharges: CodDeliveryCharge[];
};

// ── Shared helpers ──────────────────────────────────────────────────────────

const r2 = (n: number): number => Math.round(n * 100) / 100;
const cents = (n: number): number => Math.round(n * 100);

function cleanText(s: string): string {
  return s
    .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/[−–]/g, "-")
    .replace(/\u00A0/g, " ")
    .trim();
}

function cleanPages(pages: PdfItem[][]): PdfItem[][] {
  return pages.map((page) =>
    page
      .map((item) => ({
        ...item,
        s: cleanText(item.s),
      }))
      .filter((item) => item.s.length > 0),
  );
}

function documentText(pages: PdfItem[][]): string {
  return pages
    .flat()
    .map((item) => item.s)
    .join(" ");
}

const MONEY_RE = /^[+-]?\d[\d,]*\.\d{2}$/;

function parseMoney(s: string): number | null {
  const value = cleanText(s).replace(/\s+/g, "");

  if (!MONEY_RE.test(value)) return null;

  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normalizeRef(parts: string[]): string {
  const ref = parts
    .join("")
    .replace(/\s+/g, "")
    .replace(/^#/, "")
    .toUpperCase();

  return /^[-—]*$/.test(ref) ? "" : ref;
}

function assertMoneyMatches(
  label: string,
  field: string,
  actual: number,
  expected: number | null | undefined,
): void {
  if (
    expected != null &&
    Math.abs(cents(actual) - cents(expected)) > 1
  ) {
    throw new Error(
      `OnTrack ${label}: ${field} rows add up to AED ` +
        `${actual.toFixed(2)}, but the document says AED ` +
        `${expected.toFixed(2)}. Nothing was saved.`,
    );
  }
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function validIsoDate(
  year: number,
  month: number,
  day: number,
): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return (
    `${String(year).padStart(4, "0")}-` +
    `${String(month).padStart(2, "0")}-` +
    `${String(day).padStart(2, "0")}`
  );
}

function toIsoDate(s: string): string | null {
  const match = /^(\d{1,2})-([A-Za-z]+)-(\d{4})$/.exec(s);
  if (!match) return null;

  const month = MONTHS.findIndex((name) =>
    name.startsWith(match[2].toLowerCase().slice(0, 3)),
  );

  if (month < 0) return null;

  return validIsoDate(
    Number(match[3]),
    month + 1,
    Number(match[1]),
  );
}

// ── Legacy Client Payment Voucher ───────────────────────────────────────────

const LEGACY_HEADERS = {
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

type LegacyCol = keyof typeof LEGACY_HEADERS;

type LegacyBand = {
  col: LegacyCol;
  from: number;
  to: number;
};

function legacyColumnBands(
  items: PdfItem[],
): LegacyBand[] | null {
  const found: { col: LegacyCol; x: number }[] = [];

  for (const [col, re] of Object.entries(LEGACY_HEADERS) as [
    LegacyCol,
    RegExp,
  ][]) {
    const hit = items.find((item) => re.test(item.s));

    if (hit) {
      found.push({ col, x: hit.x });
    }
  }

  const required: LegacyCol[] = [
    "status",
    "clientMoney",
    "delPrice",
    "proPrice",
    "bill",
  ];

  if (
    !required.every((col) =>
      found.some((item) => item.col === col),
    )
  ) {
    return null;
  }

  found.sort((a, b) => a.x - b.x);

  return found.map((item, index) => ({
    col: item.col,
    from: item.x - 12,
    to:
      index + 1 < found.length
        ? found[index + 1].x - 12
        : Infinity,
  }));
}

function parseLegacyOnTrackVoucherPages(
  pages: PdfItem[][],
): OnTrackVoucher {
  const text = documentText(pages);

  if (
    !/on\s*track/i.test(text) ||
    !/client\s*money/i.test(text)
  ) {
    throw new Error(
      "Not an OnTrack Client Payment Voucher " +
        "(no 'On Track' / 'Client Money' header found).",
    );
  }

  const cpNo =
    /\(CP(\d+)\)/i.exec(text)?.[1] ??
    /\bCP\s*(\d{4,})\b/i.exec(text)?.[1] ??
    "";

  const dateRaw =
    /Date\s*:\s*(\d{1,2}-[A-Za-z]+-\d{4})/i.exec(text)?.[1] ??
    null;

  const out: OnTrackVoucher = {
    cpNo,
    statementNo: cpNo ? `CP${cpNo}` : undefined,
    format: "legacy",
    date: dateRaw ? toIsoDate(dateRaw) : null,
    cod: [],
    charges: [],
    totalAmount: null,
    totalCount: null,
  };

  let bands: LegacyBand[] | null = null;

  for (const page of pages) {
    bands = legacyColumnBands(page) ?? bands;
    if (!bands) continue;

    const currentBands = bands;

    const band = (x: number): LegacyCol | null =>
      currentBands.find((b) => x >= b.from && x < b.to)?.col ??
      null;

    const headerYs = page
      .filter(
        (item) =>
          LEGACY_HEADERS.status.test(item.s) ||
          LEGACY_HEADERS.clientMoney.test(item.s),
      )
      .map((item) => item.y);

    const headerY = headerYs.length
      ? Math.min(...headerYs)
      : Infinity;

    const anchors = page
      .filter(
        (item) =>
          band(item.x) === "clientMoney" &&
          parseMoney(item.s) !== null &&
          item.y < headerY,
      )
      .sort((a, b) => b.y - a.y);

    anchors.forEach((anchor, index) => {
      const top = anchor.y + 2;

      const bottom =
        index + 1 < anchors.length
          ? anchors[index + 1].y + 2
          : -Infinity;

      const cells = page
        .filter((item) => item.y <= top && item.y > bottom)
        .sort((a, b) => b.y - a.y || a.x - b.x);

      const pick = (col: LegacyCol): string[] =>
        cells
          .filter((item) => band(item.x) === col)
          .map((item) => item.s)
          .filter(Boolean);

      const num = (col: LegacyCol): number | null => {
        for (const value of pick(col)) {
          const parsed = parseMoney(value);
          if (parsed !== null) return parsed;
        }
        return null;
      };

      const clientMoney = num("clientMoney");
      const proPrice = num("proPrice");
      const delPrice = num("delPrice");

      if (clientMoney == null || proPrice == null) return;

      const billParts = pick("bill");
      const isReturn = /^rtn$/i.test(billParts[0] ?? "");

      const ref = normalizeRef(
        isReturn ? billParts.slice(1) : billParts,
      );

      const voucherNo = pick("voucher").join("");

      const clientMoneyFrom =
        currentBands.find((b) => b.col === "clientMoney")
          ?.from ?? 100;

      const status =
        cells
          .filter(
            (item) =>
              item.x < clientMoneyFrom &&
              /^[A-Za-z]/.test(item.s) &&
              !/^total/i.test(item.s),
          )
          .map((item) => item.s)
          .join(" ") || "Delivered";

      // Preserve the original legacy classification.
      if (proPrice > 0) {
        out.cod.push({
          ref,
          proPrice,
          clientMoney,
          delPrice: delPrice ?? 0,
          voucherNo,
          status,
        });
      } else {
        const amount = r2(-clientMoney);
        const exVat = delPrice ?? r2(amount / 1.05);

        out.charges.push({
          ref,
          amount,
          exVat,
          vat: r2(amount - exVat),
          isReturn,
          voucherNo,
          status,
        });
      }
    });

    for (const label of page.filter((item) =>
      /^total\s*(amount|count)$/i.test(item.s),
    )) {
      const isAmount = /amount/i.test(label.s);

      const near = page
        .filter(
          (item) =>
            item !== label &&
            Math.abs(item.y - label.y) <= 4 &&
            (isAmount
              ? parseMoney(item.s) !== null
              : /^\d+$/.test(item.s)),
        )
        .sort(
          (a, b) =>
            Math.abs(a.y - label.y) -
            Math.abs(b.y - label.y),
        )[0];

      if (!near) continue;

      if (isAmount) {
        out.totalAmount = parseMoney(near.s);
      } else {
        out.totalCount = Number(near.s);
      }
    }
  }

  return out;
}

// ── Merchant statement ──────────────────────────────────────────────────────

type StatementCol =
  | "sl"
  | "ref"
  | "invoice"
  | "merchant"
  | "customer"
  | "zone"
  | "status"
  | "collected"
  | "charges"
  | "net";

type StatementBand = {
  col: StatementCol;
  from: number;
  to: number;
};

type StatementHeader = {
  bands: StatementBand[];
  y: number;
};

const STATEMENT_HEADERS: Record<StatementCol, RegExp> = {
  sl: /^#$/,
  ref: /^ref$/i,
  invoice: /^invoice$/i,
  merchant: /^merchant(?:\s+invoice)?$/i,
  customer: /^customer$/i,
  zone: /^zone$/i,
  status: /^status$/i,
  collected: /^collected$/i,
  charges: /^charges$/i,
  net: /^net$/i,
};

function statementHeader(
  page: PdfItem[],
): StatementHeader | null {
  // The footer also has "Collected", so require neighbouring headers.
  const candidates = page
    .filter((item) => /^collected$/i.test(item.s))
    .sort((a, b) => b.y - a.y);

  for (const candidate of candidates) {
    const headerItems = page.filter(
      (item) => Math.abs(item.y - candidate.y) <= 14,
    );

    const found: { col: StatementCol; x: number }[] = [];

    for (const [col, re] of Object.entries(
      STATEMENT_HEADERS,
    ) as [StatementCol, RegExp][]) {
      const hits = headerItems
        .filter((item) => re.test(item.s))
        .sort((a, b) => a.x - b.x);

      // "Merchant invoice" may occupy two lines.
      // The internal "Invoice" header is the leftmost Invoice match.
      const hit = hits[0];

      if (hit) {
        found.push({ col, x: hit.x });
      }
    }

    const required: StatementCol[] = [
      "sl",
      "ref",
      "invoice",
      "merchant",
      "customer",
      "zone",
      "status",
      "collected",
      "charges",
      "net",
    ];

    if (
      !required.every((col) =>
        found.some((item) => item.col === col),
      )
    ) {
      continue;
    }

    found.sort((a, b) => a.x - b.x);

    return {
      // Ignore all header lines, including wrapped "Merchant invoice".
      y: Math.min(
        ...headerItems
          .filter((item) =>
            Object.values(STATEMENT_HEADERS).some((re) =>
              re.test(item.s),
            ),
          )
          .map((item) => item.y),
      ),
      bands: found.map((item, index) => ({
        col: item.col,
        from: item.x - 8,
        to:
          index + 1 < found.length
            ? found[index + 1].x - 8
            : Infinity,
      })),
    };
  }

  return null;
}

function statementFooterValue(
  page: PdfItem[],
  label: PdfItem,
  integer = false,
): number | null {
  const candidates = page
    .filter(
      (item) =>
        item !== label &&
        item.x > label.x &&
        Math.abs(item.y - label.y) <= 4 &&
        (integer
          ? /^\d+$/.test(item.s)
          : parseMoney(item.s) !== null),
    )
    .sort((a, b) => b.x - a.x);

  const item = candidates[0];
  if (!item) return null;

  return integer ? Number(item.s) : parseMoney(item.s);
}

function requireSingleMoney(
  values: string[],
  statementNo: string,
  invoiceNo: string,
  column: string,
): number {
  const amounts = values
    .map(parseMoney)
    .filter((value): value is number => value !== null);

  if (amounts.length !== 1) {
    throw new Error(
      `OnTrack ${statementNo}, invoice ${invoiceNo}: ` +
        `expected one ${column} amount; found ${amounts.length}. ` +
        "Nothing was saved.",
    );
  }

  return amounts[0];
}

/**
 * Assign wrapped text to the nearest row anchor.
 *
 * Monetary cells and invoice IDs define the row's baseline.
 * Midpoints allow status text to wrap above or below that baseline.
 */
function statementRowCells(
  tableItems: PdfItem[],
  anchors: PdfItem[],
  index: number,
  headerY: number,
  footerY: number,
): PdfItem[] {
  const anchor = anchors[index];

  const top =
    index === 0
      ? headerY
      : (anchors[index - 1].y + anchor.y) / 2;

  const bottom =
    index + 1 < anchors.length
      ? (anchor.y + anchors[index + 1].y) / 2
      : footerY;

  return tableItems
    .filter((item) => item.y < top && item.y >= bottom)
    .sort((a, b) => b.y - a.y || a.x - b.x);
}

export function parseOnTrackMerchantStatementPages(
  rawPages: PdfItem[][],
): OnTrackVoucher {
  const pages = cleanPages(rawPages);
  const text = documentText(pages);

  if (
    !/on\s*track/i.test(text) ||
    !/merchant\s+statement/i.test(text)
  ) {
    throw new Error("Not an OnTrack merchant statement.");
  }

  const statementMatch = /\bMS\s*-\s*(\d+)\b/i.exec(text);

  if (!statementMatch) {
    throw new Error(
      "OnTrack merchant statement: statement number not found.",
    );
  }

  const statementNo = `MS-${statementMatch[1]}`;

  const dateMatch =
    /Generated\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(
      text,
    );

  const date = dateMatch
    ? validIsoDate(
        Number(dateMatch[3]),
        Number(dateMatch[2]),
        Number(dateMatch[1]),
      )
    : null;

  const out: OnTrackVoucher = {
    cpNo: statementNo,
    statementNo,
    format: "merchant-statement",
    date,
    cod: [],
    charges: [],
    totalAmount: null,
    totalCount: null,
    totalCollected: null,
    totalCharges: null,
  };

  let bands: StatementBand[] | null = null;

  let rowCount = 0;
  let collectedSum = 0;
  let chargesSum = 0;
  let netSum = 0;

  const seenInvoices = new Set<string>();

  for (const page of pages) {
    const header = statementHeader(page);
    bands = header?.bands ?? bands;

    if (!bands) {
      throw new Error(
        `OnTrack ${statementNo}: no usable table header found. ` +
          "Nothing was saved.",
      );
    }

    const currentBands = bands;

    const band = (x: number): StatementCol | null =>
      currentBands.find((b) => x >= b.from && x < b.to)?.col ??
      null;

    const headerY = header?.y ?? Infinity;

    const ordersLabel = page.find((item) =>
      /^orders$/i.test(item.s),
    );

    const footerY = ordersLabel
      ? ordersLabel.y + 4
      : -Infinity;

    const tableItems = page.filter(
      (item) => item.y < headerY && item.y > footerY,
    );

    // Internal invoices include numeric IDs and international OM IDs.
    // This column exists even when the Merchant invoice is missing.
    const anchors = tableItems
      .filter(
        (item) =>
          band(item.x) === "invoice" &&
          /^(?:\d+|OM\d+)$/i.test(item.s),
      )
      .sort((a, b) => b.y - a.y);

    anchors.forEach((anchor, index) => {
      const invoiceNo = anchor.s.toUpperCase();

      if (seenInvoices.has(invoiceNo)) {
        throw new Error(
          `OnTrack ${statementNo}: duplicate internal invoice ` +
            `${invoiceNo}. Nothing was saved.`,
        );
      }

      seenInvoices.add(invoiceNo);

      const cells = statementRowCells(
        tableItems,
        anchors,
        index,
        headerY,
        footerY,
      );

      const pick = (col: StatementCol): string[] =>
        cells
          .filter((item) => band(item.x) === col)
          .map((item) => item.s)
          .filter(Boolean);

      const collected = requireSingleMoney(
        pick("collected"),
        statementNo,
        invoiceNo,
        "Collected",
      );

      const charge = requireSingleMoney(
        pick("charges"),
        statementNo,
        invoiceNo,
        "Charges",
      );

      const net = requireSingleMoney(
        pick("net"),
        statementNo,
        invoiceNo,
        "Net",
      );

      if (
        Math.abs(
          cents(collected) - cents(charge) - cents(net),
        ) > 1
      ) {
        throw new Error(
          `OnTrack ${statementNo}, invoice ${invoiceNo}: ` +
            "Collected - Charges does not equal Net. " +
            "Nothing was saved.",
        );
      }

      const status = pick("status").join(" ");

      if (!status) {
        throw new Error(
          `OnTrack ${statementNo}, invoice ${invoiceNo}: ` +
            "missing status. Nothing was saved.",
        );
      }

      const isReturn = /\breturn\b|\brtn\b/i.test(status);
      const isExchange = /\bexchange\b/i.test(status);
      const isCancelled =
        /\bcancelled\b|\bcanceled\b/i.test(status);

      // Fail closed for an unfamiliar positive-collection status.
      // It must not silently close a sale invoice.
      const isDelivered = /\bdelivered\b/i.test(status);

      if (
        collected > 0 &&
        !isReturn &&
        !isExchange &&
        !isCancelled &&
        !isDelivered
      ) {
        throw new Error(
          `OnTrack ${statementNo}, invoice ${invoiceNo}: ` +
            `unsupported collected-row status "${status}". ` +
            "Nothing was saved.",
        );
      }

      const merchantRef = normalizeRef(pick("merchant"));

      const isCodSale =
        collected > 0 &&
        isDelivered &&
        !isReturn &&
        !isExchange &&
        !isCancelled;

      if (isCodSale && !merchantRef) {
        throw new Error(
          `OnTrack ${statementNo}, invoice ${invoiceNo}: ` +
            "COD sale has no Merchant invoice reference. " +
            "Nothing was saved.",
        );
      }

      if (isCodSale) {
        out.cod.push({
          ref: merchantRef,
          proPrice: collected,
          clientMoney: net,
          delPrice: null,
          voucherNo: invoiceNo,
          status,
          invoiceNo,
        });
      } else {
        // Keep cancelled zero-value rows for Orders reconciliation.
        // Internal invoice fallback is only for non-sale bookkeeping.
        out.charges.push({
          ref: merchantRef || invoiceNo,
          merchantRef: merchantRef || undefined,
          invoiceNo,
          amount: r2(charge - collected),
          grossAmount: charge,
          collectedOffset: collected,
          exVat: null,
          vat: null,
          isReturn,
          isExchange,
          isCancelled,
          voucherNo: invoiceNo,
          status,
        });
      }

      rowCount++;
      collectedSum += collected;
      chargesSum += charge;
      netSum += net;
    });

    if (ordersLabel) {
      out.totalCount = statementFooterValue(
        page,
        ordersLabel,
        true,
      );

      const footerItems = page.filter(
        (item) => item.y <= ordersLabel.y + 4,
      );

      const collectedLabel = footerItems.find((item) =>
        /^collected$/i.test(item.s),
      );

      const chargesLabel = footerItems.find((item) =>
        /^charges$/i.test(item.s),
      );

      const netLabel = footerItems.find((item) =>
        /^net\s*\(AED\)$/i.test(item.s),
      );

      if (collectedLabel) {
        out.totalCollected = statementFooterValue(
          page,
          collectedLabel,
        );
      }

      if (chargesLabel) {
        const value = statementFooterValue(
          page,
          chargesLabel,
        );

        // The footer presents Charges as a negative deduction.
        out.totalCharges =
          value == null ? null : Math.abs(value);
      }

      if (netLabel) {
        out.totalAmount = statementFooterValue(page, netLabel);
      }
    }
  }

  if (rowCount === 0) {
    throw new Error(
      `OnTrack ${statementNo}: no rows found. Nothing was saved.`,
    );
  }

  // This layout provides all four totals. Require them.
  if (
    out.totalCount == null ||
    out.totalCollected == null ||
    out.totalCharges == null ||
    out.totalAmount == null
  ) {
    throw new Error(
      `OnTrack ${statementNo}: incomplete statement totals. ` +
        "Nothing was saved.",
    );
  }

  if (out.totalCount !== rowCount) {
    throw new Error(
      `OnTrack ${statementNo}: read ${rowCount} rows, ` +
        `but Orders says ${out.totalCount}. Nothing was saved.`,
    );
  }

  assertMoneyMatches(
    statementNo,
    "Collected",
    r2(collectedSum),
    out.totalCollected,
  );

  assertMoneyMatches(
    statementNo,
    "Charges",
    r2(chargesSum),
    out.totalCharges,
  );

  assertMoneyMatches(
    statementNo,
    "Net",
    r2(netSum),
    out.totalAmount,
  );

  return out;
}

// ── Format detection ────────────────────────────────────────────────────────

export function parseOnTrackVoucherPages(
  rawPages: PdfItem[][],
): OnTrackVoucher {
  const pages = cleanPages(rawPages);
  const text = documentText(pages);

  if (!/on\s*track/i.test(text)) {
    throw new Error("Not an OnTrack payout PDF.");
  }

  if (/merchant\s+statement/i.test(text)) {
    return parseOnTrackMerchantStatementPages(pages);
  }

  if (/client\s*money/i.test(text)) {
    return parseLegacyOnTrackVoucherPages(pages);
  }

  throw new Error(
    "Unsupported OnTrack PDF format. Expected a Client Payment " +
      "Voucher or Merchant statement.",
  );
}

// ── Convert to the reconciler's payout model ─────────────────────────────────

export function onTrackVoucherToPayout(
  v: OnTrackVoucher,
  filename: string,
): OnTrackParsedPayout {
  const rows = v.cod.length + v.charges.length;

  const statementNo =
    v.statementNo ||
    (v.cpNo
      ? v.format === "merchant-statement"
        ? v.cpNo
        : `CP${v.cpNo}`
      : undefined);

  const label = statementNo ?? "UNKNOWN";

  if (rows === 0) {
    throw new Error(`OnTrack ${label}: no rows found.`);
  }

  const codNet = r2(
    v.cod.reduce((sum, row) => sum + row.clientMoney, 0),
  );

  const otherDeductions = r2(
    v.charges.reduce((sum, charge) => sum + charge.amount, 0),
  );

  const net = r2(codNet - otherDeductions);

  if (v.totalCount != null && v.totalCount !== rows) {
    throw new Error(
      `OnTrack ${label}: read ${rows} rows but the document ` +
        `says ${v.totalCount}. Nothing was saved.`,
    );
  }

  assertMoneyMatches(label, "Net", net, v.totalAmount);

  const missingRefs = [...v.cod, ...v.charges].filter(
    (row) => !row.ref,
  );

  if (missingRefs.length) {
    throw new Error(
      `OnTrack ${label}: ${missingRefs.length} row(s) ` +
        "have no order/bookkeeping reference. Nothing was saved.",
    );
  }

  // Multiple COD delivery rows can belong to the same sale order.
  const byRef = new Map<string, PayoutTransactionShare>();

  for (const row of v.cod) {
    const previous = byRef.get(row.ref);
    const fee = r2(row.proPrice - row.clientMoney);

    byRef.set(row.ref, {
      ref: row.ref,
      grossShare: r2(
        (previous?.grossShare ?? 0) + row.proPrice,
      ),
      feeShare: r2((previous?.feeShare ?? 0) + fee),
      netShare: r2(
        (previous?.netShare ?? 0) + row.clientMoney,
      ),
      isRefund: false,
      quality: "clean",
    });
  }

  const transactions = [...byRef.values()];

  // Sale COD gross only. Exchange/return collections are not sales.
  const gross = r2(
    transactions.reduce(
      (sum, transaction) => sum + transaction.grossShare,
      0,
    ),
  );

  const returnCount = v.charges.filter(
    (charge) => charge.isReturn,
  ).length;

  const exchangeCount = v.charges.filter(
    (charge) => charge.isExchange,
  ).length;

  const cancelledCount = v.charges.filter(
    (charge) => charge.isCancelled,
  ).length;

  const notes: string[] = [
    `OnTrack ${label}${v.date ? ` · ${v.date}` : ""}`,
    `${rows} document row(s)`,
    `${v.cod.length} COD sale row(s), ` +
      `${transactions.length} order(s), ` +
      `AED ${gross.toFixed(2)} collected`,
    `other net deductions AED ${otherDeductions.toFixed(2)}`,
  ];

  if (v.totalCollected != null) {
    notes.push(
      `statement collections AED ${v.totalCollected.toFixed(2)}`,
    );
  }

  if (v.totalCharges != null) {
    notes.push(
      `statement charges AED ${v.totalCharges.toFixed(2)}`,
    );
  }

  if (exchangeCount) {
    notes.push(`${exchangeCount} exchange row(s)`);
  }

  if (returnCount) {
    notes.push(`${returnCount} return row(s)`);
  }

  if (cancelledCount) {
    notes.push(`${cancelledCount} cancelled row(s)`);
  }

  notes.push(`net settlement AED ${net.toFixed(2)}`);

  notes.push(
    v.totalAmount == null
      ? "document total not found, not cross-checked"
      : "matches document total",
  );

  // Keep existing legacy IDs, e.g. COD-12345, unchanged.
  // New merchant statements use COD-MS-000029.
  const idPart =
    v.cpNo ||
    /(\d{3,})/.exec(filename)?.[1] ||
    "UNKNOWN";

  return {
    id: `COD-${idPart}`,
    provider: "COD",
    net,
    gross,

    /**
     * Preserve the existing payout contract: gross - net.
     *
     * This is an aggregate net deduction, not necessarily the
     * merchant statement's full Charges total, because exchange
     * collections can offset those charges.
     */
    fees: r2(gross - net),

    orderRefs: transactions.map((transaction) => transaction.ref),
    transactions,
    deliveryCharges: v.charges,
    source: filename,
    statementNo,
    notes: notes.join(" · "),
  };
}

// ── PDF extraction and public async entry point ──────────────────────────────

/**
 * Positioned text from each page using the existing unpdf dependency.
 * Keep fractional coordinates for row/column assignment.
 */
export async function extractPdfItems(
  buf: Buffer | Uint8Array,
): Promise<PdfItem[][]> {
  const { getDocumentProxy } = await import("unpdf");

  // Copy the input: PDF processing may transfer the underlying buffer.
  const pdf = await getDocumentProxy(new Uint8Array(buf));

  const pages: PdfItem[][] = [];

  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();

      const items = content.items as {
        str?: string;
        transform?: number[];
      }[];

      pages.push(
        items.flatMap((item): PdfItem[] => {
          if (
            !item.str ||
            !item.str.trim() ||
            !item.transform ||
            item.transform.length < 6
          ) {
            return [];
          }

          const x = item.transform[4];
          const y = item.transform[5];

          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return [];
          }

          return [{
            s: item.str,
            x,
            y,
          }];
        }),
      );
    }
  } finally {
    await pdf.destroy();
  }

  return pages;
}

export async function parseOnTrackVoucherPdf(
  buf: Buffer | Uint8Array,
  filename: string,
): Promise<OnTrackParsedPayout> {
  const pages = await extractPdfItems(buf);
  const voucher = parseOnTrackVoucherPages(pages);

  return onTrackVoucherToPayout(voucher, filename);
}