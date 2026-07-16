// Payout file parsers — TypeScript port of scripts/parse_payouts.py, plus
// format-specific parsers for every provider export Omnia actually receives:
//   Telr    payout .xls / .csv   ("Payout ID <n>" banner, CartID + Net columns)
//   Tamara  merchant statement .xlsx  (Statement ID + Total Payable to Merchant)
//   Tabby   settlement report .xlsx   (Statement # Tabby… + Transferred amount)
//   Stripe  payout reconciliation csv (automatic_payout_id) or transfers csv (ch_…)
// ONE file = ONE payout = ONE bank deposit. Output: payout id, NET total,
// order refs — everything the reconciler needs to walk bank → payout → orders.

import * as XLSX from "xlsx";
import { parseCsv, toRecords } from "@/lib/parsers/csv";
import { toAed } from "@/lib/fx";
import type { Gateway } from "@/lib/gateways";

// One order ref, sharing a multi-ref payout transaction's net/gross/fee
// evenly across every ref it names — the same even-split the founder's prior
// n8n reconciliation workflow used, now built into the app instead of run by
// hand alongside it.
export type PayoutTransactionShare = {
  ref: string;
  netShare: number;
  grossShare: number;
  feeShare: number;
  isRefund: boolean;
  quality: StripeQuality;
};

export type ParsedPayout = {
  id: string;
  provider: Gateway;
  net: number;
  gross?: number;
  fees?: number;
  orderRefs: string[];
  source: string;
  notes: string;
  transactions?: PayoutTransactionShare[];
  // Pre-AED-conversion total, kept only when the whole file was quoted in one
  // non-AED currency (Tabby/Tamara SAR & KWD statements). The reconciliation
  // engine uses this alongside the bank's own quoted wire rate — visible in
  // the credit's narration — instead of trusting our static toAed() estimate,
  // which can't track the bank's actual daily conversion spread.
  originalCurrency?: string;
  netOriginal?: number;
};

// ── Stripe: payout RECONCILIATION report (has automatic_payout_id) ───────────
// SA is the KSA store's order-ref prefix (alongside WA/UAE/KSA/WOO).
const ORDER_TOKEN_RE = /\b((?:WA|UAE|KSA|WOO|SA)?\d{3,6})\b/gi;
const REFUND_RE = /REFUND\s+FOR\s+CHARGE\s*\(([^)]+)\)/i;

export function stripeOrderRefs(description: string): { refs: string[]; isRefund: boolean } {
  if (!description) return { refs: [], isRefund: false };
  const isRefund = REFUND_RE.test(description);
  const refs: string[] = [];
  for (const part of description.split(/[/,;&]+/)) {
    for (const m of part.matchAll(ORDER_TOKEN_RE)) {
      const tok = m[1].toUpperCase();
      if (!refs.includes(tok)) refs.push(tok);
    }
  }
  return { refs, isRefund };
}

// Description "quality" so messy Stripe descriptions surface as reviewable
// exceptions instead of silently mis-resolving: blank (no description),
// unparseable (description present, no ref found), refund, multi (>1 ref —
// net gets split across them), note (a ref plus extra free text), clean (ref
// only).
export type StripeQuality = "blank" | "unparseable" | "multi" | "note" | "clean" | "refund";

export function classifyStripeQuality(description: string, refs: string[], isRefund: boolean): StripeQuality {
  const d = String(description || "").replace(/\n/g, " ").trim();
  if (!d) return "blank";
  if (refs.length === 0) return "unparseable";
  if (isRefund) return "refund";
  if (refs.length > 1) return "multi";
  if (/[a-zA-Z]{4,}/.test(d)) return "note";
  if (d.length > refs[0].length + 3) return "note";
  return "clean";
}

export function parseStripeCsv(text: string, filename: string): ParsedPayout[] {
  const records = toRecords(parseCsv(text));
  if (records.length === 0) throw new Error("Empty Stripe CSV");

  const cols = Object.keys(records[0]);
  const col = (...names: string[]) => names.find((n) => cols.includes(n));
  const cPayout = col("automatic_payout_id", "payout_id");
  if (!cPayout) {
    // dashboard "transfers" export: Type,ID,Created,Description,Amount,…,Net
    if (col("type") && col("id") && col("net")) return parseStripeTransfersCsv(records, filename);
    throw new Error(
      "Stripe CSV missing automatic_payout_id — export the payout reconciliation report or the dashboard transfers export.",
    );
  }
  const cNet = col("net", "amount");
  const cGross = col("gross");
  const cFee = col("fee", "fees");
  const cDesc = col("description", "memo");

  const byPayout = new Map<string, {
    net: number; gross: number; fees: number; refs: string[]; charges: number; refunds: number;
    transactions: PayoutTransactionShare[];
  }>();
  for (const row of records) {
    const pid = row[cPayout];
    if (!pid) continue;
    const p = byPayout.get(pid) ?? { net: 0, gross: 0, fees: 0, refs: [], charges: 0, refunds: 0, transactions: [] };
    const rowNet = parseFloat(row[cNet!] || "0") || 0;
    const rowGross = cGross ? (parseFloat(row[cGross] || "0") || 0) : 0;
    const rowFee = cFee ? (parseFloat(row[cFee] || "0") || 0) : 0;
    p.net += rowNet;
    if (cGross) p.gross += rowGross;
    if (cFee) p.fees += rowFee;
    const desc = cDesc ? row[cDesc] : "";
    const { refs, isRefund } = stripeOrderRefs(desc);
    const quality = classifyStripeQuality(desc, refs, isRefund);
    if (isRefund) p.refunds += 1; else p.charges += 1;
    for (const r of refs) if (!p.refs.includes(r)) p.refs.push(r);
    const n = refs.length || 1; // blank/unparseable rows still contribute to the payout net, just with no ref to attach a share to
    for (const ref of refs) {
      p.transactions.push({
        ref, isRefund, quality,
        netShare: +(rowNet / n).toFixed(2),
        grossShare: +(rowGross / n).toFixed(2),
        feeShare: +(rowFee / n).toFixed(2),
      });
    }
    byPayout.set(pid, p);
  }

  return [...byPayout.entries()].map(([pid, p]) => ({
    id: pid,
    provider: "Stripe" as Gateway,
    net: +p.net.toFixed(2),
    gross: +p.gross.toFixed(2),
    fees: +p.fees.toFixed(2),
    orderRefs: p.refs,
    source: filename,
    notes: `${p.charges} charges, ${p.refunds} refunds`,
    transactions: p.transactions,
  }));
}

// ── Telr: .xls with "Payout ID <n>" banner, CartID + Net columns ─────────────
const PAYOUT_ID_RE = /PAYOUT\s*ID\s*(\d+)/i;
const FNAME_ID_RE = /(\d{6,})/;

export function parseTelrXls(buf: Buffer | ArrayBuffer, filename: string): ParsedPayout[] {
  const wb = XLSX.read(buf, { type: buf instanceof ArrayBuffer ? "array" : "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  let payoutId: string | null = null;
  for (const r of rows) {
    const m = PAYOUT_ID_RE.exec(r.map(String).join(" "));
    if (m) { payoutId = m[1]; break; }
  }
  if (!payoutId) payoutId = FNAME_ID_RE.exec(filename)?.[1] ?? "UNKNOWN";

  const headerIdx = rows.findIndex((r) => {
    const cells = r.map((c) => String(c).trim().toLowerCase());
    return cells.includes("cartid") && cells.includes("net");
  });
  if (headerIdx === -1) throw new Error("Telr header row not found (need CartID + Net columns).");

  const header = rows[headerIdx].map((c) => String(c).trim().toLowerCase());
  const jCart = header.indexOf("cartid");
  const jNet = header.indexOf("net");

  let net = 0;
  let tx = 0;
  const orderRefs: string[] = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const cart = String(r[jCart] ?? "").trim();
    if (!cart) continue;
    const n = parseFloat(String(r[jNet]));
    if (Number.isNaN(n)) continue;
    net += n;
    tx += 1;
    const prefix = cart.split("_")[0]; // CartID prefix = order number
    if (prefix && !orderRefs.includes(prefix)) orderRefs.push(prefix);
  }

  return [{
    id: `TELR-${payoutId}`,
    provider: "Telr",
    net: +net.toFixed(2),
    orderRefs,
    source: filename,
    notes: `${tx} transactions; net = sum of Net column`,
  }];
}

// ── Generic CSV fallback: Checkout / Tabby / Tamara settlement exports ───────
// Heuristics: find a net-like amount column, an order-ref-like column, and a
// payout/settlement id column (falling back to the filename).
export function parseGenericPayoutCsv(text: string, filename: string, provider: Gateway): ParsedPayout[] {
  const records = toRecords(parseCsv(text));
  if (records.length === 0) throw new Error(`Empty ${provider} CSV`);
  const cols = Object.keys(records[0]);

  const find = (patterns: RegExp[]) =>
    cols.find((c) => patterns.some((p) => p.test(c)));

  const cNet = find([/^net/, /net.*amount/, /settle.*amount/, /payout.*amount/, /^amount/, /total/]);
  if (!cNet) throw new Error(`${provider} CSV: no net/amount column found in [${cols.join(", ")}]`);
  const cRef = find([/order.*(id|number|ref|reference)/, /merchant.*ref/, /reference/, /cart/]);
  const cPid = find([/payout.*id/, /settlement.*id/, /batch/]);

  let net = 0;
  const orderRefs: string[] = [];
  let pid = "";
  for (const row of records) {
    const n = parseFloat((row[cNet] || "0").replace(/,/g, ""));
    if (!Number.isNaN(n)) net += n;
    if (cRef && row[cRef]) {
      // order refs can carry store prefixes or "#"
      const ref = row[cRef].replace(/^#/, "").trim();
      if (ref && !orderRefs.includes(ref)) orderRefs.push(ref);
    }
    if (!pid && cPid && row[cPid]) pid = row[cPid];
  }
  if (!pid) pid = filename.replace(/\.[a-z]+$/i, "");

  const prefix = provider === "Checkout" ? "CKO" : provider.toUpperCase();
  return [{
    id: `${prefix}-${pid}`,
    provider,
    net: +net.toFixed(2),
    orderRefs,
    source: filename,
    notes: `${records.length} rows; net column: ${cNet}${cRef ? `, refs: ${cRef}` : ", no ref column found"}`,
  }];
}

// ── Stripe: dashboard "transfers" export (ch_… rows, Net in converted ccy) ───
function parseStripeTransfersCsv(records: Record<string, string>[], filename: string): ParsedPayout[] {
  let net = 0, gross = 0, fees = 0, charges = 0, refunds = 0;
  const orderRefs: string[] = [];
  const transactions: PayoutTransactionShare[] = [];
  const dates: string[] = [];
  for (const row of records) {
    const rowNet = parseFloat((row["net"] || "0").replace(/,/g, "")) || 0;
    const isRefund = /refund/i.test(row["type"] || "");
    const sign = isRefund ? -1 : 1;
    const signedNet = sign * Math.abs(rowNet);
    net += signedNet;
    const signedGross = sign * Math.abs(parseFloat((row["converted amount"] || row["amount"] || "0").replace(/,/g, "")) || 0);
    gross += signedGross;
    const rowFee = Math.abs(parseFloat((row["fees"] || "0").replace(/,/g, "")) || 0);
    fees += rowFee;
    if (isRefund) refunds += 1; else charges += 1;
    if (row["created"]) dates.push(row["created"].slice(0, 10));
    const desc = row["description"] || "";
    const { refs } = stripeOrderRefs(desc);
    const quality = classifyStripeQuality(desc, refs, isRefund);
    for (const r of refs) if (!orderRefs.includes(r)) orderRefs.push(r);
    const n = refs.length || 1;
    for (const ref of refs) {
      transactions.push({
        ref, isRefund, quality,
        netShare: +(signedNet / n).toFixed(2),
        grossShare: +(signedGross / n).toFixed(2),
        feeShare: +(rowFee / n).toFixed(2),
      });
    }
  }
  dates.sort();
  const span = dates.length ? dates[dates.length - 1].replace(/-/g, "") : "UNKNOWN";
  return [{
    id: `STRIPE-TRF-${span}`,
    provider: "Stripe",
    net: +net.toFixed(2),
    gross: +gross.toFixed(2),
    fees: +fees.toFixed(2),
    orderRefs,
    source: filename,
    notes: `transfers export · ${charges} charges, ${refunds} refunds${dates.length ? ` · ${dates[0]} → ${dates[dates.length - 1]}` : ""}`,
    transactions,
  }];
}

// ── shared sheet helpers for the Tamara / Tabby statement workbooks ──────────
type SheetRows = string[][];

function sheetRows(buf: Buffer | ArrayBuffer): SheetRows[] {
  const wb = XLSX.read(buf, { type: buf instanceof ArrayBuffer ? "array" : "buffer" });
  return wb.SheetNames.map((n) =>
    XLSX.utils.sheet_to_json<string[]>(wb.Sheets[n], { header: 1, raw: false, defval: "" })
      .map((r) => r.map((c) => String(c ?? ""))),
  );
}

const num = (v: string) => {
  const n = parseFloat(String(v).replace(/[,\s]/g, ""));
  return Number.isNaN(n) ? 0 : n;
};

// find the cell to the right of a label like "Statement ID" / "Statement #"
function labelledValue(rows: SheetRows, label: RegExp): string {
  for (const r of rows) {
    const i = r.findIndex((c) => label.test(c.trim()));
    if (i >= 0) {
      const v = r.slice(i + 1).find((c) => c.trim() !== "");
      if (v) return v.trim();
    }
  }
  return "";
}

// ── Tamara: merchant statement .xlsx ─────────────────────────────────────────
// Transaction block header: "Merchant Order ID" + "Total Payable to Merchant".
// The KSA-store statement layout (sa.omniastores.ae) adds a separate
// "Merchant Order Number" column carrying the real ref ("#SA3507"); its
// "Merchant Order ID" instead holds Tamara's internal numeric id, which Excel
// mangles into unusable scientific notation ("6.61169E+12") for large values.
// The UAE-store layout has no such column, and "Merchant Order ID" there IS
// the plain order number — so prefer "Merchant Order Number" when present,
// falling back to "Merchant Order ID" otherwise.
export function parseTamaraXlsx(buf: Buffer | ArrayBuffer, filename: string): ParsedPayout[] {
  for (const rows of sheetRows(buf)) {
    const h = rows.findIndex((r) => {
      const cells = r.map((c) => c.trim().toLowerCase());
      return cells.some((c) => c === "merchant order id") &&
        cells.some((c) => c.startsWith("total payable"));
    });
    if (h === -1) continue;

    const header = rows[h].map((c) => c.trim().toLowerCase());
    const jRefNumber = header.findIndex((c) => c === "merchant order number");
    const jRefId = header.findIndex((c) => c === "merchant order id");
    const jRef = jRefNumber >= 0 ? jRefNumber : jRefId;
    const jNet = header.findIndex((c) => c.startsWith("total payable"));
    const jGross = header.findIndex((c) => c === "order amount");
    const jFees = header.findIndex((c) => c === "total fees");
    const jCcy = header.findIndex((c) => c === "currency");
    const jTamaraId = header.findIndex((c) => c === "tamara order id");
    const jRefundId = header.findIndex((c) => c === "merchant refund id");

    let net = 0, gross = 0, fees = 0, tx = 0, netOriginal = 0;
    const orderRefs: string[] = [];
    const currencies = new Set<string>();
    for (const r of rows.slice(h + 1)) {
      const ref = String(r[jRef] ?? "").trim();
      const tamaraId = jTamaraId >= 0 ? String(r[jTamaraId] ?? "").trim() : "";
      if (!ref || !tamaraId) continue; // skips blank + "Total" footer rows
      const isRefund = jRefundId >= 0 && String(r[jRefundId] ?? "").trim() !== "";
      const sign = isRefund ? -1 : 1;
      const ccy = ((jCcy >= 0 && r[jCcy]?.trim()) || "AED").toUpperCase();
      currencies.add(ccy);
      netOriginal += sign * Math.abs(num(r[jNet]));
      net += sign * Math.abs(toAed(num(r[jNet]), ccy));
      if (jGross >= 0) gross += sign * Math.abs(toAed(num(r[jGross]), ccy));
      if (jFees >= 0) fees += Math.abs(toAed(num(r[jFees]), ccy));
      tx += 1;
      const clean = ref.replace(/^#/, "");
      if (clean && !orderRefs.includes(clean)) orderRefs.push(clean);
    }
    if (tx === 0) continue;

    const statementId = labelledValue(rows, /^statement id$/i) ||
      filename.match(/([0-9a-f]{8}-[0-9a-f-]{27,})/i)?.[1] ||
      filename.replace(/\.[a-z]+$/i, "");
    const originalCurrency = currencies.size === 1 ? [...currencies][0] : undefined;
    return [{
      id: `TAMARA-${statementId}`,
      provider: "Tamara",
      net: +net.toFixed(2),
      gross: +gross.toFixed(2),
      fees: +fees.toFixed(2),
      orderRefs,
      source: filename,
      notes: `${tx} captured events · statement ${labelledValue(rows, /^statement period$/i) || statementId}`,
      originalCurrency: originalCurrency && originalCurrency !== "AED" ? originalCurrency : undefined,
      netOriginal: originalCurrency && originalCurrency !== "AED" ? +netOriginal.toFixed(2) : undefined,
    }];
  }
  throw new Error("Tamara statement: transaction table (Merchant Order ID / Total Payable to Merchant) not found.");
}

// ── Tabby: settlement report .xlsx ───────────────────────────────────────────
// Header: "Order Number" + "Transferred amount"; Statement # like Tabby20260706SAR.
export function parseTabbyXlsx(buf: Buffer | ArrayBuffer, filename: string): ParsedPayout[] {
  for (const rows of sheetRows(buf)) {
    const h = rows.findIndex((r) => {
      const cells = r.map((c) => c.trim().toLowerCase());
      return cells.some((c) => c === "order number") &&
        cells.some((c) => c.startsWith("transferred amount"));
    });
    if (h === -1) continue;

    const header = rows[h].map((c) => c.trim().toLowerCase());
    const jRef = header.findIndex((c) => c === "order number");
    const jNet = header.findIndex((c) => c.startsWith("transferred amount"));
    const jGross = header.findIndex((c) => c === "order amount");
    const jFees = header.findIndex((c) => c === "total deduction");
    const jCcy = header.findIndex((c) => c === "currency");
    const jType = header.findIndex((c) => c === "type");

    let net = 0, gross = 0, fees = 0, sales = 0, refunds = 0, netOriginal = 0;
    const orderRefs: string[] = [];
    const currencies = new Set<string>();
    for (const r of rows.slice(h + 1)) {
      const ref = String(r[jRef] ?? "").trim();
      // real rows: a short order-number token + a numeric net cell. Trailing
      // totals/disclaimer rows carry sentence text or an empty net — skip them.
      if (!ref || !/^#?[A-Za-z0-9-]{1,20}$/.test(ref)) continue;
      if (!/\d/.test(String(r[jNet] ?? ""))) continue;
      const ccy = ((jCcy >= 0 && r[jCcy]?.trim()) || "AED").toUpperCase();
      currencies.add(ccy);
      const isRefund = jType >= 0 && /refund/i.test(String(r[jType] ?? ""));
      const sign = isRefund ? -1 : 1;
      netOriginal += sign * Math.abs(num(r[jNet]));
      net += sign * Math.abs(toAed(num(r[jNet]), ccy));
      if (jGross >= 0) gross += sign * Math.abs(toAed(num(r[jGross]), ccy));
      if (jFees >= 0) fees += Math.abs(toAed(num(r[jFees]), ccy));
      if (isRefund) refunds += 1; else sales += 1;
      const clean = ref.replace(/^#/, "");
      if (clean && !orderRefs.includes(clean)) orderRefs.push(clean);
    }
    if (sales + refunds === 0) continue;

    const statementId = labelledValue(rows, /^statement\s*#$/i) || filename.replace(/\.[a-z]+$/i, "");
    const originalCurrency = currencies.size === 1 ? [...currencies][0] : undefined;
    return [{
      id: statementId.toUpperCase().startsWith("TABBY") ? statementId : `TABBY-${statementId}`,
      provider: "Tabby",
      net: +net.toFixed(2),
      gross: +gross.toFixed(2),
      fees: +fees.toFixed(2),
      orderRefs,
      source: filename,
      notes: `${sales} sales, ${refunds} refunds · amounts converted to AED`,
      originalCurrency: originalCurrency && originalCurrency !== "AED" ? originalCurrency : undefined,
      netOriginal: originalCurrency && originalCurrency !== "AED" ? +netOriginal.toFixed(2) : undefined,
    }];
  }
  throw new Error("Tabby settlement report: table (Order Number / Transferred amount) not found.");
}

// ── universal entry point: detect the format, then parse ─────────────────────
// Accepts .xls / .xlsx / .csv from any of the five providers; the optional
// hint only matters when detection is ambiguous (generic CSVs).
export function parsePayoutFile(
  buf: Buffer | ArrayBuffer,
  filename: string,
  hint?: Gateway,
): ParsedPayout[] {
  const buffer = buf instanceof ArrayBuffer ? Buffer.from(buf) : buf;
  const name = filename.toLowerCase();
  const isSheet = /\.(xls|xlsx)$/.test(name);

  // sniff the first rows regardless of container format
  let sniff = "";
  try {
    sniff = sheetRows(buffer)
      .flatMap((rows) => rows.slice(0, 40))
      .map((r) => r.join(" "))
      .join("\n")
      .toUpperCase();
  } catch {
    sniff = buffer.toString("utf8", 0, 4000).toUpperCase();
  }

  if (/PAYOUT\s*ID\s*\d/.test(sniff) || (sniff.includes("CARTID") && sniff.includes("NET"))) {
    return parseTelrXls(buffer, filename); // XLSX.read handles the CSV rendering too
  }
  if (sniff.includes("TAMARA")) return parseTamaraXlsx(buffer, filename);
  if (sniff.includes("TABBY") || sniff.includes("TRANSFERRED AMOUNT")) return parseTabbyXlsx(buffer, filename);

  if (!isSheet) {
    const text = buffer.toString("utf8");
    const head = text.slice(0, 2000);
    if (/automatic_payout_id|payout_id/i.test(head) || /\bch_[0-9A-Za-z]{8,}/.test(text) || hint === "Stripe") {
      return parseStripeCsv(text, filename);
    }
    if (hint && hint !== "Unclassified") return parseGenericPayoutCsv(text, filename, hint);
    throw new Error("Could not detect the payout format — pass a provider or use a Telr/Tamara/Tabby/Stripe export.");
  }

  if (hint === "Telr") return parseTelrXls(buffer, filename);
  if (hint === "Tamara") return parseTamaraXlsx(buffer, filename);
  if (hint === "Tabby") return parseTabbyXlsx(buffer, filename);
  throw new Error("Unrecognised spreadsheet — expected a Telr payout, Tamara statement, or Tabby settlement report.");
}
