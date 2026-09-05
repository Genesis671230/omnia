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
  // This order's own amounts exactly as the source file quoted them, before
  // AED conversion (e.g. a Tabby SAR row's Order Amount/Total Deduction/
  // Transferred amount). Only meaningful when the payout's originalCurrency
  // is set and non-AED (Tabby/Tamara SAR & KWD statements) — otherwise these
  // equal the AED share and the UI should not show a redundant column.
  netOriginal?: number;
  grossOriginal?: number;
  feeOriginal?: number;
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

export function parseTelrXls(buf: Buffer | ArrayBuffer, filename: string, provider: Gateway = "Telr"): ParsedPayout[] {
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
  const jType = header.indexOf("type");
  const jNet  = header.lastIndexOf("net");
  const jMdr  = header.indexOf("mdr");
  const jXFee = header.indexOf("fees"); // "Fees" is the extra-fee column, not the total
  const jTax  = header.indexOf("tax");

  // Settlement pair sits immediately before MDR; Authorisation is the first pair.
  // Fall back gracefully if a future export flattens to a single Amount column.
  const currencyIdxs: number[] = [];
  const amountIdxs:   number[] = [];
  header.forEach((c, i) => {
    if (c === "currency") currencyIdxs.push(i);
    if (c === "amount")   amountIdxs.push(i);
  });
  const jAuthCcy   = currencyIdxs[0] ?? -1;
  const jAuthAmt   = amountIdxs[0]   ?? -1;
  const jSettleAmt = amountIdxs.length > 1
    ? [...amountIdxs].reverse().find((i) => jMdr < 0 || i < jMdr) ?? amountIdxs[amountIdxs.length - 1]
    : jAuthAmt;

  if (jSettleAmt < 0 || jNet < 0) {
    throw new Error("Telr header row missing Settlement Amount or Net column.");
  }

  const parseNum = (v: unknown) => {
    const n = parseFloat(String(v ?? "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  let net = 0, gross = 0, fees = 0, sales = 0, refunds = 0;
  const orderRefs: string[] = [];
  const shareByRef = new Map<string, PayoutTransactionShare>();

  for (const r of rows.slice(headerIdx + 1)) {
    const cart = String(r[jCart] ?? "").trim();
    if (!cart) continue;
    const rowNet = parseNum(r[jNet]);
    // Sub-header / total / disclaimer rows have a CartID cell but no numeric Net.
    if (!/\d/.test(String(r[jNet] ?? ""))) continue;

    const ref = cart.split("_")[0]; // CartID = "802831_6a78ea1f11a68" → "802831"
    if (!ref) continue;

    const type = jType >= 0 ? String(r[jType] ?? "").trim().toLowerCase() : "";
    const isRefund = /refund/.test(type) || rowNet < 0;

    // Settlement Amount is the AED gross the bank moved for this transaction.
    // MDR / Fees / Tax are stored negative in the file — absolute-value them
    // and sum for the row's fee total. Net in the file already equals
    // Settlement − |MDR| − |Fees| − |Tax|, so we trust the Net column directly
    // rather than re-deriving it (avoids ±0.01 rounding drift vs the bank).
    const rowGross = parseNum(r[jSettleAmt]);
    const rowFee = Math.abs(parseNum(r[jMdr])) + Math.abs(parseNum(r[jXFee])) + Math.abs(parseNum(r[jTax]));

    net   += rowNet;
    gross += rowGross;
    fees  += rowFee;
    if (isRefund) refunds += 1; else sales += 1;
    if (!orderRefs.includes(ref)) orderRefs.push(ref);

    // Retries / partial captures on one order → merge (same pattern as Tabby/Tamara)
    // rather than emit duplicate rows in the proof table.
    const prior = shareByRef.get(ref);
    shareByRef.set(ref, prior
      ? {
          ref,
          netShare:   +(prior.netShare   + rowNet).toFixed(2),
          grossShare: +(prior.grossShare + rowGross).toFixed(2),
          feeShare:   +(prior.feeShare   + rowFee).toFixed(2),
          isRefund:   prior.isRefund || isRefund,
          quality:    "multi",
        }
      : {
          ref,
          netShare:   +rowNet.toFixed(2),
          grossShare: +rowGross.toFixed(2),
          feeShare:   +rowFee.toFixed(2),
          isRefund,
          quality:    isRefund ? "refund" : "clean",
        });
  }

  // Sniff the currency mix for the notes line — useful diagnostic when a Telr
  // payout foots off by a rounding cent (usually a mixed SAR+AED batch).
  const ccyMix = new Set<string>();
  if (jAuthCcy >= 0) {
    for (const r of rows.slice(headerIdx + 1)) {
      const c = String(r[jAuthCcy] ?? "").trim().toUpperCase();
      if (c && /^[A-Z]{3}$/.test(c)) ccyMix.add(c);
    }
  }

  // This exact file shape (banner + CartID + Auth/Settlement pairs + MDR/
  // Fees/Tax/Net) is also what the store's Network-rail card settlements use
  // for Stripe-classified bank credits (see BANK_DESCRIPTOR_RULES' "NETWORK"
  // → "Stripe" rule in lib/gateways.ts) — same computation, different
  // provider tag. NETWORK- (not STRIPE-) keeps this out of recon-row.tsx's
  // `isStripe` live-API-proof path, which only real STRIPE-po_… ids should
  // trigger; this file's own transactions[] should render directly instead.
  const idPrefix = provider === "Stripe" ? "NETWORK" : "TELR";
  return [{
    id: `${idPrefix}-${payoutId}`,
    provider,
    net:   +net.toFixed(2),
    gross: +gross.toFixed(2),
    fees:  +fees.toFixed(2),
    orderRefs,
    source: filename,
    notes: `${sales} sales${refunds ? `, ${refunds} refunds` : ""} · settled AED${ccyMix.size ? ` · authorised in ${[...ccyMix].sort().join("/")}` : ""}`,
    transactions: [...shareByRef.values()],
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

// ── COD (On Track Delivery courier remittance): CSV or XLSX ──────────────
// Column names vary by courier — kept generous on purpose, same spirit as
// parseGenericPayoutCsv, but tuned to COD-specific vocabulary and able to
// recover the invoice number from a banner row (couriers print "INVOICE
// #16964" above the table, not in a clean column) or from the filename —
// matching the bank narration's own "invoice 16964" reference so the two
// sides can be matched by a founder at a glance.
const COD_INVOICE_COL_RE = /^invoice\s*(no\.?|number|#)?$/i;
const COD_INVOICE_BANNER_RE = /INVOICE\s*#?\s*(\d{3,})/i;
const COD_REF_COL_RE = /^(order|order\s*no\.?|order\s*number|order\s*id|awb|awb\s*no\.?|tracking|tracking\s*no\.?|reference)$/i;
const COD_AMOUNT_COL_RE = /^(cod\s*amount|amount\s*collected|collection\s*amount|net\s*amount|net|amount)$/i;

function codInvoiceNumber(rawText: string, filename: string): string {
  const banner = COD_INVOICE_BANNER_RE.exec(rawText)?.[1];
  if (banner) return banner;
  const fname = /(\d{3,})/.exec(filename)?.[1];
  return fname ?? "UNKNOWN";
}

function parseCodRecords(records: Record<string, string>[], rawText: string, filename: string): ParsedPayout[] {
  if (records.length === 0) throw new Error("Empty COD file");
  const cols = Object.keys(records[0]);
  const cInvoice = cols.find((c) => COD_INVOICE_COL_RE.test(c.trim()));
  const cRef = cols.find((c) => COD_REF_COL_RE.test(c.trim()));
  const cAmount = cols.find((c) => COD_AMOUNT_COL_RE.test(c.trim()));
  if (!cAmount) throw new Error(`COD file: no amount column found in [${cols.join(", ")}]`);

  let net = 0;
  const orderRefs: string[] = [];
  let invoiceFromColumn = "";
  for (const row of records) {
    const n = parseFloat((row[cAmount] || "0").replace(/,/g, ""));
    if (!Number.isNaN(n)) net += n;
    if (cRef && row[cRef]) {
      const ref = row[cRef].replace(/^#/, "").trim();
      if (ref && !orderRefs.includes(ref)) orderRefs.push(ref);
    }
    if (!invoiceFromColumn && cInvoice && row[cInvoice]) invoiceFromColumn = row[cInvoice].trim();
  }

  const invoiceNo = invoiceFromColumn || codInvoiceNumber(rawText.toUpperCase(), filename);
  return [{
    id: `COD-${invoiceNo}`,
    provider: "COD",
    net: +net.toFixed(2),
    orderRefs,
    source: filename,
    notes: `${records.length} rows; amount column: ${cAmount}${cRef ? `, refs: ${cRef}` : ", no ref column found"}`,
  }];
}

export function parseCodCsv(text: string, filename: string): ParsedPayout[] {
  const rows = parseCsv(text);
  // Real courier CSVs sometimes carry a banner line ("...INVOICE #16964")
  // above the real header row — find the row that actually looks like the
  // header (has an amount-like column) instead of assuming row 0, mirroring
  // parseCodXlsx's header-row scan. Falls back to row 0 so the "no amount
  // column found" error still names whatever columns row 0 actually has.
  const headerIdx = rows.findIndex((r) => r.some((c) => COD_AMOUNT_COL_RE.test(c.trim())));
  const startIdx = headerIdx === -1 ? 0 : headerIdx;
  const header = (rows[startIdx] ?? []).map((c) => c.trim().toLowerCase());
  const records = rows.slice(startIdx + 1).map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = (r[i] ?? "").trim(); });
    return rec;
  });
  return parseCodRecords(records, text, filename);
}

export function parseCodXlsx(buf: Buffer | ArrayBuffer, filename: string): ParsedPayout[] {
  const buffer = buf instanceof ArrayBuffer ? Buffer.from(buf) : buf;
  for (const rows of sheetRows(buffer)) {
    const rawText = rows.slice(0, 40).map((r) => r.join(" ")).join("\n");
    const headerIdx = rows.findIndex((r) => r.some((c) => COD_AMOUNT_COL_RE.test(c.trim())));
    if (headerIdx === -1) continue;
    const header = rows[headerIdx].map((c) => c.trim());
    const records = rows.slice(headerIdx + 1)
      .filter((r) => r.some((c) => c.trim() !== ""))
      .map((r) => {
        const rec: Record<string, string> = {};
        header.forEach((h, i) => { rec[h] = r[i] ?? ""; });
        return rec;
      });
    if (records.length === 0) continue;
    try {
      return parseCodRecords(records, rawText, filename);
    } catch {
      continue;
    }
  }
  throw new Error("COD statement: no header row with a recognizable amount column found.");
}

// ── Checkout.com: Interchange++ settlement export ─────────────────────────
// Every row is a breakdown line (a charge, a fee, a tax) for one Payment ID,
// already in "Holding Currency" — which the founder confirmed is the exact
// figure Checkout wires to the bank. Fee/tax rows carry a negative amount,
// so summing every row in a group already nets fees out — no FX derivation,
// no batch_fx, unlike Tabby/Tamara. Real exports have an empty "Payout ID"
// column per-row (confirmed against the founder's sample) — group by
// (Currency Account ID, Processed On date) in that case, but prefer a
// populated Payout ID when a future export has one.
export function parseCheckoutCsv(text: string, filename: string): ParsedPayout[] {
  const records = toRecords(parseCsv(text));
  if (records.length === 0) throw new Error("Empty Checkout CSV");
  const cols = Object.keys(records[0]);
  const required = ["holding currency amount", "holding currency", "processed on", "currency account id", "payment id", "action type"];
  const missing = required.filter((c) => !cols.includes(c));
  if (missing.length > 0) {
    throw new Error(`Checkout CSV missing column(s) [${missing.join(", ")}] — expected the Interchange++ settlement export.`);
  }

  type Row = { key: string; paymentId: string; ref: string; amount: number; isRefund: boolean; holdingCcy: string };
  const rows: Row[] = [];
  for (const r of records) {
    const amount = parseFloat((r["holding currency amount"] || "0").replace(/,/g, ""));
    if (Number.isNaN(amount)) continue;
    const payoutIdRaw = (r["payout id"] || "").trim();
    const account = (r["currency account id"] || "").trim();
    const date = (r["processed on"] || r["requested on"] || "").slice(0, 10);
    const key = payoutIdRaw || `${account}_${date}`;
    rows.push({
      key,
      paymentId: (r["payment id"] || "").trim(),
      ref: (r["reference"] || "").trim().replace(/^#/, ""),
      amount,
      isRefund: /refund/i.test(r["action type"] || ""),
      holdingCcy: (r["holding currency"] || "AED").trim().toUpperCase(),
    });
  }
  if (rows.length === 0) throw new Error("Checkout CSV: no rows with a numeric Holding Currency Amount found.");

  const byGroup = new Map<string, Row[]>();
  for (const r of rows) {
    const g = byGroup.get(r.key) ?? [];
    g.push(r);
    byGroup.set(r.key, g);
  }

  const payouts: ParsedPayout[] = [];
  for (const [key, groupRows] of byGroup) {
    const holdingCcys = new Set(groupRows.map((r) => r.holdingCcy));
    if (holdingCcys.size > 1) {
      throw new Error(`Checkout CSV: payout group "${key}" mixes holding currencies (${[...holdingCcys].join(", ")}) — expected exactly one settlement currency per batch.`);
    }
    const net = groupRows.reduce((s, r) => s + r.amount, 0);
    const grossTotal = groupRows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    const feeTotal = Math.abs(groupRows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0));

    const byPayment = new Map<string, Row[]>();
    for (const r of groupRows) {
      const g = byPayment.get(r.paymentId) ?? [];
      g.push(r);
      byPayment.set(r.paymentId, g);
    }

    const orderRefs: string[] = [];
    const transactions: PayoutTransactionShare[] = [];
    for (const paymentRows of byPayment.values()) {
      const refs = [...new Set(paymentRows.map((r) => r.ref).filter(Boolean))];
      if (refs.length === 0) continue; // fee-only maintenance rows (e.g. Network Token Update) carry no reference by design — they still count toward net above, just unattributed to an order.
      const groupNet = paymentRows.reduce((s, r) => s + r.amount, 0);
      const groupGross = paymentRows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
      const groupFee = Math.abs(paymentRows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0));
      const isRefund = paymentRows.some((r) => r.isRefund) || groupNet < 0;
      const quality: StripeQuality = refs.length > 1 ? "multi" : isRefund ? "refund" : "clean";
      const n = refs.length;
      for (const ref of refs) {
        if (!orderRefs.includes(ref)) orderRefs.push(ref);
        transactions.push({
          ref,
          netShare: +(groupNet / n).toFixed(2),
          grossShare: +(groupGross / n).toFixed(2),
          feeShare: +(groupFee / n).toFixed(2),
          isRefund,
          quality,
        });
      }
    }

    payouts.push({
      id: `CKO-${key}`,
      provider: "Checkout",
      net: +net.toFixed(2),
      gross: +grossTotal.toFixed(2),
      fees: +feeTotal.toFixed(2),
      orderRefs,
      source: filename,
      notes: `${groupRows.length} breakdown rows across ${byPayment.size} payments`,
      transactions,
    });
  }
  return payouts;
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
    // Refund signals, checked in combination because Tamara's real merchant
    // statement has no "Merchant Refund ID" column at all — it carries
    // "Refund Reason" plus an "Event" column ("Captured" / "Refunded").
    // Detecting only the former meant refunds were silently counted as
    // positive revenue on every real export.
    const jRefundId = header.findIndex((c) => c === "merchant refund id");
    const jRefundReason = header.findIndex((c) => c === "refund reason");
    const jEvent = header.findIndex((c) => c === "event");

    let net = 0, gross = 0, fees = 0, tx = 0, netOriginal = 0;
    const orderRefs: string[] = [];
    const currencies = new Set<string>();
    const shareByRef = new Map<string, PayoutTransactionShare>();
    for (const r of rows.slice(h + 1)) {
      const ref = String(r[jRef] ?? "").trim();
      const tamaraId = jTamaraId >= 0 ? String(r[jTamaraId] ?? "").trim() : "";
      if (!ref || !tamaraId) continue; // skips blank + "Total" footer rows
      const isRefund =
        (jRefundId >= 0 && String(r[jRefundId] ?? "").trim() !== "") ||
        (jRefundReason >= 0 && String(r[jRefundReason] ?? "").trim() !== "") ||
        (jEvent >= 0 && /refund/i.test(String(r[jEvent] ?? "")));
      const sign = isRefund ? -1 : 1;
      const ccy = ((jCcy >= 0 && r[jCcy]?.trim()) || "AED").toUpperCase();
      currencies.add(ccy);
      const rowNetAed = sign * Math.abs(toAed(num(r[jNet]), ccy));
      const rowGrossAed = jGross >= 0 ? sign * Math.abs(toAed(num(r[jGross]), ccy)) : 0;
      const rowFeeAed = jFees >= 0 ? Math.abs(toAed(num(r[jFees]), ccy)) : 0;
      const rowNetOriginal = sign * Math.abs(num(r[jNet]));
      const rowGrossOriginal = jGross >= 0 ? sign * Math.abs(num(r[jGross])) : 0;
      const rowFeeOriginal = jFees >= 0 ? Math.abs(num(r[jFees])) : 0;
      netOriginal += rowNetOriginal;
      net += rowNetAed;
      if (jGross >= 0) gross += rowGrossAed;
      if (jFees >= 0) fees += rowFeeAed;
      tx += 1;
      const clean = ref.replace(/^#/, "");
      if (clean && !orderRefs.includes(clean)) orderRefs.push(clean);

      if (clean) {
        const prior = shareByRef.get(clean);
        shareByRef.set(clean, prior
          ? {
              ref: clean,
              netShare: +(prior.netShare + rowNetAed).toFixed(2),
              grossShare: +(prior.grossShare + rowGrossAed).toFixed(2),
              feeShare: +(prior.feeShare + rowFeeAed).toFixed(2),
              isRefund: prior.isRefund || isRefund,
              quality: "multi",
              netOriginal: +((prior.netOriginal ?? 0) + rowNetOriginal).toFixed(2),
              grossOriginal: +((prior.grossOriginal ?? 0) + rowGrossOriginal).toFixed(2),
              feeOriginal: +((prior.feeOriginal ?? 0) + rowFeeOriginal).toFixed(2),
            }
          : {
              ref: clean,
              netShare: +rowNetAed.toFixed(2),
              grossShare: +rowGrossAed.toFixed(2),
              feeShare: +rowFeeAed.toFixed(2),
              isRefund,
              quality: isRefund ? "refund" : "clean",
              netOriginal: +rowNetOriginal.toFixed(2),
              grossOriginal: +rowGrossOriginal.toFixed(2),
              feeOriginal: +rowFeeOriginal.toFixed(2),
            });
      }
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
      transactions: [...shareByRef.values()],
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
    const shareByRef = new Map<string, PayoutTransactionShare>();
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
      const rowNetAed = sign * Math.abs(toAed(num(r[jNet]), ccy));
      const rowGrossAed = jGross >= 0 ? sign * Math.abs(toAed(num(r[jGross]), ccy)) : 0;
      const rowFeeAed = jFees >= 0 ? Math.abs(toAed(num(r[jFees]), ccy)) : 0;
      const rowNetOriginal = sign * Math.abs(num(r[jNet]));
      const rowGrossOriginal = jGross >= 0 ? sign * Math.abs(num(r[jGross])) : 0;
      const rowFeeOriginal = jFees >= 0 ? Math.abs(num(r[jFees])) : 0;
      netOriginal += rowNetOriginal;
      net += rowNetAed;
      if (jGross >= 0) gross += rowGrossAed;
      if (jFees >= 0) fees += rowFeeAed;
      if (isRefund) refunds += 1; else sales += 1;
      const clean = ref.replace(/^#/, "");
      if (clean && !orderRefs.includes(clean)) orderRefs.push(clean);

      if (clean) {
        const prior = shareByRef.get(clean);
        shareByRef.set(clean, prior
          ? {
              ref: clean,
              netShare: +(prior.netShare + rowNetAed).toFixed(2),
              grossShare: +(prior.grossShare + rowGrossAed).toFixed(2),
              feeShare: +(prior.feeShare + rowFeeAed).toFixed(2),
              isRefund: prior.isRefund || isRefund,
              quality: "multi",
              netOriginal: +((prior.netOriginal ?? 0) + rowNetOriginal).toFixed(2),
              grossOriginal: +((prior.grossOriginal ?? 0) + rowGrossOriginal).toFixed(2),
              feeOriginal: +((prior.feeOriginal ?? 0) + rowFeeOriginal).toFixed(2),
            }
          : {
              ref: clean,
              netShare: +rowNetAed.toFixed(2),
              grossShare: +rowGrossAed.toFixed(2),
              feeShare: +rowFeeAed.toFixed(2),
              isRefund,
              quality: isRefund ? "refund" : "clean",
              netOriginal: +rowNetOriginal.toFixed(2),
              grossOriginal: +rowGrossOriginal.toFixed(2),
              feeOriginal: +rowFeeOriginal.toFixed(2),
            });
      }
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
      transactions: [...shareByRef.values()],
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
    // This file shape is shared by Telr and the Network-rail Stripe
    // settlement export — only the hint disambiguates which one it is.
    // Any other hint (Tabby/Tamara/Checkout/COD/undefined) keeps today's
    // default of tagging it Telr, since that's the shape's primary source.
    return parseTelrXls(buffer, filename, hint === "Stripe" ? "Stripe" : "Telr");
  }
  if (sniff.includes("TAMARA")) return parseTamaraXlsx(buffer, filename);
  if (sniff.includes("TABBY") || sniff.includes("TRANSFERRED AMOUNT")) return parseTabbyXlsx(buffer, filename);
  if (sniff.includes("ON TRACK DELIVERY") || hint === "COD") {
    return isSheet ? parseCodXlsx(buffer, filename) : parseCodCsv(buffer.toString("utf8"), filename);
  }
  if ((sniff.includes("CLIENT ENTITY NAME") && sniff.includes("BREAKDOWN TYPE")) || hint === "Checkout") {
    if (isSheet) {
      throw new Error("Checkout settlement export must be a CSV — re-export it as CSV from the Checkout.com dashboard (spreadsheet parsing isn't supported for Checkout yet).");
    }
    return parseCheckoutCsv(buffer.toString("utf8"), filename);
  }

  if (!isSheet) {
    const text = buffer.toString("utf8");
    const head = text.slice(0, 2000);
    if (/automatic_payout_id|payout_id/i.test(head) || /\bch_[0-9A-Za-z]{8,}/.test(text) || hint === "Stripe") {
      return parseStripeCsv(text, filename);
    }
    if (hint && hint !== "Unclassified") return parseGenericPayoutCsv(text, filename, hint);
    throw new Error("Could not detect the payout format — pass a provider or use a Telr/Tamara/Tabby/Stripe/Checkout/COD export.");
  }

  if (hint === "Telr") return parseTelrXls(buffer, filename);
  if (hint === "Tamara") return parseTamaraXlsx(buffer, filename);
  if (hint === "Tabby") return parseTabbyXlsx(buffer, filename);
  throw new Error("Unrecognised spreadsheet — expected a Telr payout, Tamara statement, Tabby settlement report, or COD statement.");
}
