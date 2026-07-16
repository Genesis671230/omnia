// Bank statement parser — bank-agnostic. Handles:
//   1. CSV exports (ENBD "Transaction history", or any bank with
//      date / description / debit / credit / amount / balance columns)
//   2. PDF-extracted text where the whole statement collapses onto one
//      line (unpdf mergePages) — segmented on date tokens
//   3. Line-oriented statement text (original ENBD layout: a transaction
//      wraps several physical lines and ends in "<amount> <balance>")
// Only CREDIT lines are reconciliation candidates.

import { parseCsv } from "@/lib/parsers/csv";
import { classifyBankCredit, type Confidence, type Gateway } from "@/lib/gateways";

export type ParsedBankLine = {
  lineId: string;
  date: string; // ISO or ""
  narration: string;
  reference: string;
  amount: number; // positive magnitude
  direction: "credit" | "debit";
  provider?: Gateway;
  confidence?: Confidence;
  kind?: "salary" | "supplier" | "fee" | "tax" | "transfer" | "other";
};

export type ParsedStatement = {
  credits: ParsedBankLine[];
  debits: ParsedBankLine[];
  format: "csv" | "merged-text" | "lines";
};

const DEBIT_KINDS: [string, ParsedBankLine["kind"]][] = [
  ["SAL ", "salary"], ["SALARY", "salary"], ["JOYALUKKAS", "salary"],
  ["FEES OR CHARGES", "fee"], ["CHARGES", "fee"], ["FEE", "fee"],
  ["TAX AMOUNT", "tax"], ["VAT", "tax"],
  ["TRANSFER OF FUNDS", "transfer"], ["TOF", "transfer"],
  ["OUTWARD TELEX", "supplier"], ["OUTWARD SWIFT", "supplier"],
];

const REF_RE = /\b((?:FT|DSZ|INSTQ)[A-Z0-9]{6,})\b/;
const DATE_TOKEN_RE = /\b(\d{2})[/-](\d{2})[/-](\d{4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/g;
// amount then balance: amount may be signed and short ("-50", "-2.5"),
// balance always carries exactly two decimals. Guard both sides so digits
// inside references / phone numbers can't bleed into a match.
const AMOUNT_PAIR_RE =
  /(?<![\d,.])(-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)[ \t]+(-?\d{1,3}(?:,\d{3})*\.\d{2})(?![\d.])/g;
// line-oriented tail: "<amount> <balance>" at end of a wrapped block
const AMT_BAL_EOL_RE = /(-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s+(-?\d{1,3}(?:,\d{3})*(?:\.\d{2}))\s*$/;

const CREDIT_KEYWORDS = ["INWARD", "CR ACCOUNT", "CTD CR", "DEPOSIT", "REVERSAL", "REFUND CREDIT"];
const DEBIT_KEYWORDS = ["OUTWARD", "DEBIT", "FEES", "TAX AMOUNT", "CHARGES", "WITHDRAWAL"];

function classifyDebit(narration: string): ParsedBankLine["kind"] {
  const up = narration.toUpperCase();
  for (const [kw, kind] of DEBIT_KINDS) if (up.includes(kw)) return kind;
  return "other";
}

function toIsoDate(text: string): string {
  DATE_TOKEN_RE.lastIndex = 0;
  const m = DATE_TOKEN_RE.exec(text);
  if (!m) return "";
  if (m[4]) return `${m[4]}-${m[5]}-${m[6]}`; // already yyyy-mm-dd
  return `${m[3]}-${m[2]}-${m[1]}`; // dd/mm/yyyy → ISO
}

function parseAmount(raw: string): number {
  const n = parseFloat(raw.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/** Decide credit/debit for one transaction of a text-based statement. */
function directionOf(narration: string, signedAmount: number, statementHasSigns: boolean): "credit" | "debit" {
  if (statementHasSigns) return signedAmount < 0 ? "debit" : "credit";
  const up = narration.toUpperCase();
  const credit = CREDIT_KEYWORDS.some((k) => up.includes(k));
  const debit = DEBIT_KEYWORDS.some((k) => up.includes(k));
  if (credit && !debit) return "credit";
  return "debit"; // conservative: never invent a reconciliation candidate
}

function makeLine(
  idx: { c: number; d: number },
  date: string,
  narration: string,
  reference: string,
  amount: number,
  direction: "credit" | "debit",
): ParsedBankLine {
  if (direction === "credit") {
    idx.c += 1;
    const { provider, confidence } = classifyBankCredit(narration);
    return {
      lineId: `C${String(idx.c).padStart(3, "0")}`,
      date, narration, reference,
      amount: Math.abs(amount),
      direction, provider, confidence,
    };
  }
  idx.d += 1;
  return {
    lineId: `D${String(idx.d).padStart(3, "0")}`,
    date, narration, reference,
    amount: Math.abs(amount),
    direction, kind: classifyDebit(narration),
  };
}

/* ── 1. CSV path ────────────────────────────────────────────────────────── */

// Header synonyms across banks (ENBD, ADCB, Mashreq, generic exports).
const COL = {
  date: ["date", "transaction date", "value date", "posting date"],
  description: ["description", "narration", "details", "particulars", "transaction details", "remarks"],
  reference: ["ref", "reference", "chq", "cheque", "transaction ref"],
  debit: ["debit", "withdrawal", "debit amount", "money out", "paid out"],
  credit: ["credit", "deposit", "credit amount", "money in", "paid in"],
  amount: ["amount", "transaction amount", "amount (aed)"],
} as const;

function matchHeader(cells: string[]): Partial<Record<keyof typeof COL, number>> | null {
  const norm = cells.map((c) => c.toLowerCase().replace(/[^a-z ./]/g, " ").replace(/\s+/g, " ").trim());
  const found: Partial<Record<keyof typeof COL, number>> = {};
  for (const key of Object.keys(COL) as (keyof typeof COL)[]) {
    const i = norm.findIndex((cell) => COL[key].some((syn) => cell === syn || cell.includes(syn)));
    if (i >= 0) found[key] = i;
  }
  const ok = found.date != null && found.description != null &&
    (found.debit != null || found.credit != null || found.amount != null);
  return ok ? found : null;
}

function tryParseCsvStatement(text: string): ParsedStatement | null {
  if (!text.slice(0, 4000).includes(",")) return null;
  const rows = parseCsv(text);
  let headerAt = -1;
  let cols: ReturnType<typeof matchHeader> = null;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    cols = matchHeader(rows[i]);
    if (cols) { headerAt = i; break; }
  }
  if (!cols || headerAt < 0) return null;

  const idx = { c: 0, d: 0 };
  const credits: ParsedBankLine[] = [];
  const debits: ParsedBankLine[] = [];

  for (const row of rows.slice(headerAt + 1)) {
    const dateRaw = (row[cols.date!] ?? "").trim();
    const date = toIsoDate(dateRaw);
    if (!date) continue; // footers, totals, blank separators

    const narration = (row[cols.description!] ?? "").replace(/\s+/g, " ").trim();
    const refCell = cols.reference != null ? (row[cols.reference] ?? "") : "";
    const reference =
      refCell.replace(/['"\s]/g, "").replace(/\\HCP$/i, "") ||
      (REF_RE.exec(narration)?.[1] ?? "");

    const debitRaw = cols.debit != null ? (row[cols.debit] ?? "").trim() : "";
    const creditRaw = cols.credit != null ? (row[cols.credit] ?? "").trim() : "";
    const amountRaw = cols.amount != null ? (row[cols.amount] ?? "").trim() : "";

    if (creditRaw && !Number.isNaN(parseAmount(creditRaw))) {
      credits.push(makeLine(idx, date, narration, reference, parseAmount(creditRaw), "credit"));
    } else if (debitRaw && !Number.isNaN(parseAmount(debitRaw))) {
      debits.push(makeLine(idx, date, narration, reference, parseAmount(debitRaw), "debit"));
    } else if (amountRaw && !Number.isNaN(parseAmount(amountRaw))) {
      const amt = parseAmount(amountRaw);
      const dir = directionOf(narration, amt, /-/.test(amountRaw));
      (dir === "credit" ? credits : debits).push(makeLine(idx, date, narration, reference, amt, dir));
    }
  }

  if (credits.length + debits.length === 0) return null;
  return { credits, debits, format: "csv" };
}

/* ── 2. Merged-text path (PDF extraction collapses newlines) ────────────── */

function parseMergedText(raw: string): ParsedStatement | null {
  const text = raw.replace(/\s+/g, " ");
  const starts: number[] = [];
  DATE_TOKEN_RE.lastIndex = 0;
  for (let m = DATE_TOKEN_RE.exec(text); m; m = DATE_TOKEN_RE.exec(text)) starts.push(m.index);
  if (starts.length === 0) return null;

  type Tx = { date: string; narration: string; reference: string; amount: number; raw: string };
  const txs: Tx[] = [];
  let sawSign = false;

  for (let i = 0; i < starts.length; i++) {
    const seg = text.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : undefined);
    // last "<amount> <balance>" pair in the segment closes the transaction;
    // anything after it is page-header noise carried in by the merge.
    AMOUNT_PAIR_RE.lastIndex = 0;
    let last: RegExpExecArray | null = null;
    for (let m = AMOUNT_PAIR_RE.exec(seg); m; m = AMOUNT_PAIR_RE.exec(seg)) last = m;
    if (!last) continue; // header/footer segment, not a transaction

    const amountRaw = last[1];
    const amount = parseAmount(amountRaw);
    if (Number.isNaN(amount)) continue;
    if (amountRaw.startsWith("-")) sawSign = true;

    const date = toIsoDate(seg.slice(0, 10));
    const narration = seg
      .slice(0, last.index)
      .replace(DATE_TOKEN_RE, "")
      .replace(/^[ /|'-]+|[ /|'-]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    const reference = REF_RE.exec(seg.slice(0, last.index))?.[1] ?? "";
    txs.push({ date, narration, reference, amount, raw: amountRaw });
  }

  if (txs.length === 0) return null;

  const idx = { c: 0, d: 0 };
  const credits: ParsedBankLine[] = [];
  const debits: ParsedBankLine[] = [];
  for (const t of txs) {
    const dir = directionOf(t.narration, t.amount, sawSign);
    (dir === "credit" ? credits : debits).push(
      makeLine(idx, t.date, t.narration, t.reference, t.amount, dir),
    );
  }
  return { credits, debits, format: "merged-text" };
}

/* ── 3. Line-oriented path (original ENBD text layout) ──────────────────── */

function parseLineOriented(raw: string): ParsedStatement | null {
  const idx = { c: 0, d: 0 };
  const credits: ParsedBankLine[] = [];
  const debits: ParsedBankLine[] = [];
  let buf: string[] = [];
  let sawSign = false;
  type Pending = { date: string; narration: string; reference: string; amount: number; raw: string };
  const pending: Pending[] = [];

  for (const physical of raw.split(/\r?\n/)) {
    const s = physical.trim();
    if (!s) continue;
    buf.push(s);
    const m = AMT_BAL_EOL_RE.exec(s);
    if (!m) continue;

    const block = buf.join(" ");
    buf = [];
    const amount = parseAmount(m[1]);
    if (Number.isNaN(amount)) continue;
    if (m[1].startsWith("-")) sawSign = true;

    const tailStart = block.lastIndexOf(m[0]);
    const narration = block.slice(0, tailStart)
      .replace(/^[ /|]+|[ /|]+$/g, "")
      .replace(/\s{2,}/g, " ");
    pending.push({
      date: toIsoDate(block),
      narration,
      reference: REF_RE.exec(block)?.[1] ?? "",
      amount,
      raw: m[1],
    });
  }

  for (const p of pending) {
    const dir = directionOf(p.narration, p.amount, sawSign);
    (dir === "credit" ? credits : debits).push(
      makeLine(idx, p.date, p.narration, p.reference, p.amount, dir),
    );
  }

  if (credits.length + debits.length === 0) return null;
  return { credits, debits, format: "lines" };
}

/* ── Entry point ────────────────────────────────────────────────────────── */

export function parseBankStatement(text: string, filename = ""): ParsedStatement {
  if (filename.toLowerCase().endsWith(".csv")) {
    const csv = tryParseCsvStatement(text);
    if (csv) return csv;
  }

  // multi-line text → try the line-oriented layout first
  const lineCount = text.split(/\r?\n/).filter((l) => l.trim()).length;
  if (lineCount > 5) {
    const csv = tryParseCsvStatement(text);
    if (csv) return csv;
    const lines = parseLineOriented(text);
    if (lines) return lines;
  }

  const merged = parseMergedText(text);
  if (merged) return merged;

  return { credits: [], debits: [], format: "merged-text" };
}
