// The dispatch sheets, read: every row of the "SMSA Orders" and " Local
// orders" tabs as typed rows.
//
// WHERE: ops keeps ONE SPREADSHEET PER MONTH (payment_sheet_months — Jul, Aug,
// Sep 2026…), the full working copy with vouchers, sale type, refunds,
// comments. The env sheet (GOOGLE_SHEETS_SPREADSHEET_ID) is only the intake
// the app appends new orders to; its old rows get cleared once a month's
// sheet exists. So each month is read from its own sheet, and the intake
// sheet only for months that have none yet (e.g. the current month). A month
// sheet starts as a copy of the previous one — only rows dated in its own
// month are kept.
//
// HOW the team writes it (Sep 2026 sheet):
//   - after a refund the amount column is what's LEFT; the refunded part is in
//     "Cancelled / Refunded Amount" (AED) → original = left + refunded
//   - "Canceled Before Dispatch - 796.50 AED": total 0, cancelled amount 796.50
//   - Type of Sale "Exchange/COD" | "Exchange/Paid" | "Exchange" | "Repair":
//     a shipment for an earlier order (often a 30 AED delivery), not a sale
//   - dates "02.Sep.2026", "21 Sep.2026", "2026-09-01 6:57", ISO
// Cached a minute.

import { readAllValues, resolveTabName, googleSheetsConfigured } from "./google-sheets";
import { findHeaderRowIndex, LOCAL_TAB, SMSA_TAB } from "./dispatch-sheet";
import { supabase } from "@/lib/supabase";

export type SheetTab = "SMSA" | "Local";
export type SheetKind = "sale" | "refunded" | "partial_refund" | "cancelled" | "exchange" | "repair" | "pending";

export type SheetRow = {
  tab: SheetTab;
  /** Which spreadsheet: "September 2026" or "Intake". */
  source: string;
  /** 1-based row number in that tab. */
  row: number;
  order: string;
  day: string | null;
  time: string | null;
  kind: SheetKind;
  /** The amount column as written (what's left after any refund), AED. */
  amountAed: number | null;
  /** The original sale in AED: left + cancelled/refunded. */
  grossAed: number | null;
  cancelledRefundedAed: number | null;
  amountOriginal: number | null;
  currency: string;
  exchangeRate: number | null;
  party: string;
  gateway: string;
  saleType: string;
  voucher: string;
  comments: string;
  paymentAuthorised: string;
  paymentStatus: string;
  receivedOn: string;
  feeDeducted: number | null;
  balanceReceived: number | null;
  feePct: string;
  refundDate: string;
  deliveryBy: string;
  shipmentStatus: string;
  salesPerson: string;
  otInvoice: string;
  flaggedDuplicate: boolean;
};

const MON: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** "2026-09-01 6:57" | "02.Sep.2026" | "21 Sep.2026" | "01.July.2026" | "01.10.2026" | ISO → Dubai day + time. Pure. */
export function parseSheetDate(raw: string): { day: string | null; time: string | null } {
  const s = (raw || "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (m && /Z$|[+-]\d\d:?\d\d$/.test(s)) {
    const d = new Date(Date.parse(s) + 4 * 3600_000); // stored in UTC → Dubai
    return { day: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (m) return { day: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4].padStart(2, "0")}:${m[5]}` : null };
  m = /^(\d{1,2})[.\-/ ]+([A-Za-z]{3})[A-Za-z]*[.\-/ ]+(\d{4})/.exec(s);
  if (m && MON[m[2].toLowerCase()]) return { day: `${m[3]}-${MON[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`, time: null };
  // October 2026 sheet: "01.10.2026" — day.month.year, numeric (UAE order, never US).
  m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= 1 && Number(m[1]) <= 31) return { day: `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`, time: null };
  return { day: null, time: null };
}

const num = (v: string | undefined) => {
  const t = String(v ?? "").trim();
  const n = Number(t.replace(/[^\d.-]/g, ""));
  return t && /\d/.test(t) && Number.isFinite(n) ? n : null;
};
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** What a row is, from the team's own words. Pure. */
export function kindOf(saleType: string, comments: string, otInvoice: string, left: number | null, cancelled: number | null): SheetKind {
  const t = saleType.toLowerCase();
  const c = comments.toLowerCase();
  if (t.startsWith("exchange")) return "exchange";
  if (t.startsWith("repair")) return "repair";
  if (t.startsWith("pending")) return "pending";
  if (/cancel/.test(c) || /cancel/i.test(otInvoice)) return "cancelled";
  if ((cancelled ?? 0) > 0 || /refund|return/.test(c)) {
    // "1 Item Returned…" or most of the sale still standing = partial. A full
    // refund can leave a few dirhams (WA55598: 84 AED kept of 978).
    const leftShare = (left ?? 0) / Math.max((left ?? 0) + (cancelled ?? 0), 1);
    return /\bitem\b|partial/.test(c) || leftShare > 0.3 ? "partial_refund" : "refunded";
  }
  return "sale";
}

/** Typed rows from one tab's raw values. Pure. */
export function rowsFromValues(tab: SheetTab, values: string[][], source = "Intake"): SheetRow[] {
  const h = findHeaderRowIndex(values);
  if (h < 0) return [];
  const head = values[h].map((x) => x.trim().toLowerCase());
  const col = (...names: string[]) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const c = {
    order: col("order #"), date: col("date"),
    aed: tab === "SMSA" ? col("in aed") : col("total"),
    original: tab === "SMSA" ? col("total amt") : col("total"),
    currency: col("currency"), rate: col("exc rate"),
    party: tab === "SMSA" ? col("party") : col("customer"), gateway: col("party"),
    saleType: col("type of sale"), voucher: col("voucher #"),
    comments: col("status / comments", "comments"), authorised: col("payment authorised - status", "payment status"),
    payment: col("actual payment status"), received: col("payment received date", "payment received on"),
    fee: col("fee deducted"), balance: col("amount after deduction", "balance received"),
    cancelled: col("cancelled / refunded amount"), feePct: col("fee%", "% charged"), refundDate: col("refund date"),
    delivery: col("delivery by"), shipment: col("shipment status"), salesPerson: col("sales person"),
    otInvoice: col("ot invoice#"), dupCheck: col("duplicate check"),
  };
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const out: SheetRow[] = [];
  for (let i = h + 1; i < values.length; i++) {
    const r = values[i];
    const order = get(r, c.order).replace(/^#/, "");
    if (!/\d/.test(order)) continue; // blank, "-", notes typed into the order column
    const { day, time } = parseSheetDate(get(r, c.date));
    const amountAed = num(get(r, c.aed));
    const cancelled = num(get(r, c.cancelled));
    const saleType = get(r, c.saleType);
    const comments = get(r, c.comments);
    const otInvoice = get(r, c.otInvoice);
    const kind = kindOf(saleType, comments, otInvoice, amountAed, cancelled);
    const grossAed = amountAed == null && cancelled == null ? null
      : kind === "refunded" || kind === "partial_refund" || kind === "cancelled" ? r2((amountAed ?? 0) + (cancelled ?? 0)) : amountAed;
    out.push({
      tab, source, row: i + 1, order, day, time, kind,
      amountAed, grossAed, cancelledRefundedAed: cancelled,
      amountOriginal: num(get(r, c.original)), currency: get(r, c.currency) || "AED", exchangeRate: num(get(r, c.rate)),
      party: get(r, c.party), gateway: tab === "SMSA" ? get(r, c.gateway) : get(r, c.gateway),
      saleType, voucher: get(r, c.voucher), comments,
      paymentAuthorised: get(r, c.authorised), paymentStatus: get(r, c.payment), receivedOn: get(r, c.received),
      feeDeducted: num(get(r, c.fee)), balanceReceived: num(get(r, c.balance)), feePct: get(r, c.feePct),
      refundDate: get(r, c.refundDate), deliveryBy: get(r, c.delivery), shipmentStatus: get(r, c.shipment),
      salesPerson: get(r, c.salesPerson), otInvoice, flaggedDuplicate: /dup/i.test(get(r, c.dupCheck)),
    });
  }
  return out;
}

/* ── which spreadsheet holds which month ───────────────────────────────── */

const monthsIn = (from: string, to: string) => {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m += 1; if (m > 12) { m = 1; y += 1; } }
  return out;
};

async function readTabs(spreadsheetId: string | undefined, source: string): Promise<{ rows: SheetRow[]; errors: string[] }> {
  const rows: SheetRow[] = [];
  const errors: string[] = [];
  await Promise.all(([["SMSA", SMSA_TAB], ["Local", LOCAL_TAB]] as const).map(async ([tab, name]) => {
    try {
      rows.push(...rowsFromValues(tab, await readAllValues(await resolveTabName(name, spreadsheetId), spreadsheetId), source));
    } catch (e) {
      errors.push(`${source} · ${name}: ${(e as Error).message}`);
    }
  }));
  return { rows, errors };
}

const cache = new Map<string, { at: number; rows: SheetRow[]; errors: string[]; sources: string[] }>();
const TTL_MS = 60_000;

/** Every dispatch row dated fromDay..toDay, each month from its own sheet. */
export async function readDispatchSheets(fromDay: string, toDay: string, fresh = false): Promise<{ rows: SheetRow[]; errors: string[]; sources: string[]; readAt: string }> {
  const key = `${fromDay}|${toDay}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return { rows: hit.rows, errors: hit.errors, sources: hit.sources, readAt: new Date(hit.at).toISOString() };
  if (!googleSheetsConfigured()) return { rows: [], errors: ["Google Sheets isn't configured"], sources: [], readAt: new Date().toISOString() };

  const months = monthsIn(fromDay, toDay);
  const { data: registry } = await supabase.from("payment_sheet_months").select("month_key, spreadsheet_id, label").in("month_key", months);
  const byMonth = new Map((registry ?? []).map((r) => [r.month_key as string, r as { month_key: string; spreadsheet_id: string; label: string }]));
  const rows: SheetRow[] = [];
  const errors: string[] = [];
  const sources: string[] = [];
  const inRange = (d: string | null) => Boolean(d && d >= fromDay && d <= toDay);

  await Promise.all(months.map(async (m) => {
    const reg = byMonth.get(m);
    if (!reg) return;
    const r = await readTabs(reg.spreadsheet_id, reg.label);
    // A month sheet starts as a copy of the last one — only its own month counts.
    rows.push(...r.rows.filter((x) => x.day?.startsWith(m) && inRange(x.day)));
    errors.push(...r.errors);
    sources.push(reg.label);
  }));
  const uncovered = months.filter((m) => !byMonth.has(m));
  if (uncovered.length) {
    const r = await readTabs(undefined, "Intake");
    rows.push(...r.rows.filter((x) => x.day && uncovered.includes(x.day.slice(0, 7)) && inRange(x.day)));
    errors.push(...r.errors);
    sources.push(`Intake sheet (${uncovered.join(", ")})`);
  }
  rows.sort((a, b) => (a.day ?? "").localeCompare(b.day ?? ""));
  if (!errors.length) cache.set(key, { at: Date.now(), rows, errors, sources });
  return { rows, errors, sources, readAt: new Date().toISOString() };
}
