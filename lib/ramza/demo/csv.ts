/* CSV in the browser: parse, find the columns that matter, and tell what kind
 * of file it is (gateway payout, bank statement, invoices/orders, chart of
 * accounts, payroll). Pure — nothing is uploaded anywhere. */

export type Table = { headers: string[]; rows: string[][] };

/** RFC 4180-ish: quotes, escaped quotes, commas/semicolons/tabs, CRLF. */
export function parseCsv(text: string): Table {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (q) {
      if (c === '"') {
        if (clean[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) out.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) out.push(row);
  const [headers = [], ...rows] = out;
  return { headers: headers.map((h) => h.trim()), rows: rows.map((r) => r.map((x) => x.trim())) };
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Index of the first header matching any alias (exact, then contains). */
export function col(headers: string[], aliases: string[]): number {
  const hs = headers.map(norm);
  for (const a of aliases.map(norm)) { const i = hs.indexOf(a); if (i >= 0) return i; }
  for (const a of aliases.map(norm)) { const i = hs.findIndex((h) => h.includes(a)); if (i >= 0) return i; }
  return -1;
}

/** "1,234.50", "(12.00)", "AED 99", "-3.2" → number; NaN when not a number. */
export function num(v: string | undefined): number {
  if (v == null) return NaN;
  const s = v.replace(/[A-Za-z\s,]/g, "");
  if (!s) return NaN;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()]/g, ""));
  return neg ? -n : n;
}

/** "2026-10-05", "05/10/2026", "5 Oct 2026", "2026-10-05T10:00:00Z" → YYYY-MM-DD ("" if unknown). Day-first for slashes (UAE). */
export function day(v: string | undefined): string {
  if (!v) return "";
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) return "";
  // Text dates ("5 Oct 2026") parse as local midnight — read the local calendar day.
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export type FileKind = "payout" | "bank" | "invoices" | "coa" | "payroll" | "unknown";

export const ALIASES = {
  date: ["date", "transaction date", "created", "created (utc)", "payout date", "value date", "posting date", "invoice date", "order date", "available on"],
  amount: ["amount", "gross", "total", "charge amount", "order total", "invoice total", "transaction amount", "price"],
  fee: ["fee", "fees", "processing fee", "commission", "merchant fee", "mdr"],
  vat: ["vat", "tax on fee", "fee vat", "vat on fee"],
  net: ["net", "net amount", "payout amount", "settlement amount", "net settlement"],
  currency: ["currency", "ccy", "presentment currency"],
  ref: ["order", "order id", "order number", "order no", "reference", "ref", "invoice", "invoice number", "invoice no", "description", "metadata", "name"],
  description: ["description", "narration", "details", "particulars", "transaction details", "memo", "remarks"],
  debit: ["debit", "withdrawal", "withdrawals", "money out", "dr"],
  credit: ["credit", "deposit", "deposits", "money in", "cr"],
  customer: ["customer", "customer name", "client", "buyer", "bill to", "billing name"],
  code: ["code", "account code", "account number", "gl code"],
  accountName: ["account name", "account", "name"],
  accountType: ["type", "account type", "class"],
  basic: ["basic", "basic salary", "basic pay"],
  allowances: ["allowances", "allowance", "housing", "other allowances"],
  joined: ["joining date", "start date", "date of joining", "joined"],
  employee: ["employee", "employee name", "name", "staff"],
} as const;

export function detectKind(t: Table): FileKind {
  const h = t.headers;
  const has = (k: keyof typeof ALIASES) => col(h, [...ALIASES[k]]) >= 0;
  if (has("basic") && (has("employee") || has("joined"))) return "payroll";
  if (has("code") && has("accountName") && !has("amount") && !has("debit")) return "coa";
  if (has("fee") && (has("net") || has("amount"))) return "payout";
  if ((has("debit") || has("credit")) && has("description")) return "bank";
  if (has("description") && has("amount") && !has("customer")) return "bank";
  if (has("amount") && (has("customer") || col(h, ["invoice", "order"]) >= 0)) return "invoices";
  return "unknown";
}
