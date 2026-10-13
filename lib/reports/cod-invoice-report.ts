// COD invoice status — every cash-on-delivery order of a month next to its
// Zoho invoice (COD is booked in House of Omnia) and the courier's
// remittance, so nobody has to open Zoho to know where a COD order stands.
// Pure: hand it the rows, no I/O.
//
// One state per order, the first that applies:
//   cancelled            store or app cancelled it
//   returned             returned / refunded from the app, or a valued credit note
//   no_invoice           no invoice in any Zoho organisation
//   paid                 invoice paid in Zoho
//   remitted_not_booked  the courier's voucher carries it (OnTrack CP…), Zoho still open → book it
//   partly_paid          Zoho has part of it
//   with_courier         open, no voucher yet → chase the courier (aged)
// Flags on the side: invoiced outside House of Omnia, invoice ≠ order amount,
// void invoice, several live invoices.

import { dubaiDayKey } from "@/lib/dubai-day";

export type CodOrderIn = {
  uid: string; order_number: string; store_id: string; order_date: string | null; customer_name: string | null;
  gross_aed: number | null; financial_status: string | null; ops_status?: string | null; city?: string | null; country?: string | null;
};
export type CodDocIn = {
  kind: "invoice" | "creditnote"; org: string; id: string; number: string; order: string;
  date: string; status: string; total: number; balance: number;
};
/** The sales ledger's view of the order: courier voucher (payout) and bank. */
export type CodLedgerIn = { status: string; payoutId: string | null; payoutSource: string | null; bankDate: string | null; receivedAed: number };
export type CodAdjustmentIn = { kind: string; creditAed: number; creditNote: string; receivedAed?: number; receivedVia?: string; date: string };

export type CodState = "cancelled" | "returned" | "no_invoice" | "paid" | "remitted_not_booked" | "partly_paid" | "with_courier";
export const COD_STATE_LABEL: Record<CodState, string> = {
  with_courier: "With the courier — not remitted",
  remitted_not_booked: "Courier remitted — not booked in Zoho",
  partly_paid: "Partly paid in Zoho",
  no_invoice: "No Zoho invoice",
  paid: "Paid in Zoho",
  returned: "Returned / refunded",
  cancelled: "Cancelled",
};
export const COD_STATE_ACTION: Record<CodState, string> = {
  with_courier: "Chase the courier for the cash / voucher",
  remitted_not_booked: "Book the courier voucher in Reconciliation (closes the invoice)",
  partly_paid: "Check the remaining balance",
  no_invoice: "Create the invoice in House of Omnia",
  paid: "",
  returned: "",
  cancelled: "",
};
export const COD_STATE_ORDER: CodState[] = ["with_courier", "remitted_not_booked", "partly_paid", "no_invoice", "paid", "returned", "cancelled"];

export type CodRow = {
  uid: string; order: string; day: string; store: string; customer: string; city: string; grossAed: number; storeStatus: string;
  invoice: { org: string; number: string; date: string; status: string; total: number; balance: number } | null;
  otherInvoices: number;
  creditNotes: { number: string; total: number; status: string }[];
  courier: { status: string; voucher: string | null; bankDate: string | null; receivedAed: number } | null;
  adjustment: CodAdjustmentIn | null;
  state: CodState;
  openAed: number;
  ageDays: number;
  action: string;
  flags: string[];
};

export type CodReport = {
  month: string; asOf: string; homeOrg: string;
  totals: { orders: number; grossAed: number; invoicedAed: number; paidAed: number; openAed: number };
  byState: { state: CodState; label: string; orders: number; grossAed: number; openAed: number }[];
  openByAge: { band: string; orders: number; aed: number }[];
  flags: { flag: string; orders: string[] }[];
  rows: CodRow[];
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const norm = (s: string) => s.trim().replace(/^#/, "").toUpperCase();
const days = (a: string, b: string) => Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000));
const REMITTED = new Set(["received", "awaiting_bank", "in_review"]);

export function buildCodInvoiceReport(input: {
  month: string; today: string; homeOrg: string;
  orders: CodOrderIn[]; docs: CodDocIn[];
  ledger: Map<string, CodLedgerIn>; adjustments: Map<string, CodAdjustmentIn>;
}): CodReport {
  const invBy = new Map<string, CodDocIn[]>();
  const cnBy = new Map<string, CodDocIn[]>();
  for (const d of input.docs) {
    const k = norm(d.order);
    if (!k) continue;
    const m = d.kind === "invoice" ? invBy : cnBy;
    m.set(k, [...(m.get(k) ?? []), d]);
  }

  const rows: CodRow[] = [];
  for (const o of input.orders) {
    const day = dubaiDayKey(o.order_date);
    if (!day || !day.startsWith(input.month)) continue;
    const k = norm(o.order_number);
    const gross = r2(Number(o.gross_aed) || 0);
    const fs = (o.financial_status || "").toLowerCase();
    const all = invBy.get(k) ?? [];
    // Zero-value invoices are Omniastores' intercompany placeholders (customer
    // "House of Omnia", reference = order number) — not the sale invoice.
    const live = all.filter((i) => i.status.toLowerCase() !== "void" && i.total > 0.005);
    // the home org first, then the one closest to the order amount
    const inv = live.slice().sort((a, b) =>
      (a.org === input.homeOrg ? 0 : 1) - (b.org === input.homeOrg ? 0 : 1) || Math.abs(a.total - gross) - Math.abs(b.total - gross))[0] ?? null;
    const cns = (cnBy.get(k) ?? []).filter((c) => c.status.toLowerCase() !== "void");
    const adj = input.adjustments.get(k) ?? null;
    const l = input.ledger.get(k) ?? null;
    const flags: string[] = [];
    if (inv && inv.org !== input.homeOrg) flags.push(`Invoiced in ${inv.org}, not ${input.homeOrg}`);
    if (inv && gross > 0 && Math.abs(inv.total - gross) > 1) flags.push(`Invoice ${inv.total.toFixed(2)} ≠ order ${gross.toFixed(2)}`);
    if (live.length > 1) flags.push(`${live.length} live invoices`);
    if (!inv && all.some((i) => i.status.toLowerCase() === "void")) flags.push("Only a void invoice");

    const remitted = !!l && REMITTED.has(l.status);
    const valuedCn = cns.some((c) => c.total > 0.005);
    let state: CodState;
    if (fs === "cancelled" || fs === "voided" || adj?.kind === "cancelled" || (o.ops_status || "").toLowerCase() === "cancelled") state = "cancelled";
    else if (adj?.kind === "returned" || adj?.kind === "refunded" || (valuedCn && (!inv || inv.balance <= 0.01) && !remitted)) state = "returned";
    else if (!inv) state = "no_invoice";
    else if (inv.balance <= 0.01) state = "paid";
    else if (remitted || adj?.kind === "received") state = "remitted_not_booked";
    else if (inv.balance < inv.total - 0.01) state = "partly_paid";
    else state = "with_courier";

    const open = state === "with_courier" || state === "remitted_not_booked" || state === "partly_paid" ? r2(inv?.balance ?? 0) : state === "no_invoice" ? gross : 0;
    rows.push({
      uid: o.uid, order: o.order_number, day, store: o.store_id, customer: o.customer_name ?? "", city: o.city ?? "", grossAed: gross, storeStatus: fs,
      invoice: inv ? { org: inv.org, number: inv.number, date: inv.date, status: inv.status, total: r2(inv.total), balance: r2(inv.balance) } : null,
      otherInvoices: Math.max(0, live.length - 1),
      creditNotes: cns.map((c) => ({ number: c.number, total: r2(c.total), status: c.status })),
      courier: l ? { status: l.status, voucher: l.payoutSource || l.payoutId, bankDate: l.bankDate, receivedAed: r2(l.receivedAed) } : null,
      adjustment: adj, state, openAed: open, ageDays: days(day, input.today), action: COD_STATE_ACTION[state], flags,
    });
  }
  rows.sort((a, b) => COD_STATE_ORDER.indexOf(a.state) - COD_STATE_ORDER.indexOf(b.state) || a.day.localeCompare(b.day) || a.order.localeCompare(b.order));

  const counted = rows.filter((r) => r.state !== "cancelled");
  const sum = (f: (r: CodRow) => number, rs = rows) => r2(rs.reduce((s, r) => s + f(r), 0));
  const bands = [["0–7 days", 0, 7], ["8–15 days", 8, 15], ["16–30 days", 16, 30], ["Over 30 days", 31, 1e9]] as const;
  const flagMap = new Map<string, string[]>();
  for (const r of rows) for (const f of r.flags) {
    const key = f.startsWith("Invoice ") && f.includes("≠") ? "Invoice ≠ order amount" : /^\d+ live invoices$/.test(f) ? "Several live invoices" : f;
    flagMap.set(key, [...(flagMap.get(key) ?? []), r.order]);
  }
  return {
    month: input.month, asOf: input.today, homeOrg: input.homeOrg,
    totals: {
      orders: counted.length, grossAed: sum((r) => r.grossAed, counted),
      invoicedAed: sum((r) => r.invoice?.total ?? 0, counted),
      paidAed: sum((r) => (r.invoice ? r.invoice.total - r.invoice.balance : 0), counted),
      openAed: sum((r) => r.openAed),
    },
    byState: COD_STATE_ORDER.map((s) => {
      const rs = rows.filter((r) => r.state === s);
      return { state: s, label: COD_STATE_LABEL[s], orders: rs.length, grossAed: sum((r) => r.grossAed, rs), openAed: sum((r) => r.openAed, rs) };
    }).filter((x) => x.orders > 0),
    openByAge: bands.map(([band, lo, hi]) => {
      const rs = rows.filter((r) => r.openAed > 0 && r.ageDays >= lo && r.ageDays <= hi);
      return { band, orders: rs.length, aed: sum((r) => r.openAed, rs) };
    }),
    flags: [...flagMap].map(([flag, orders]) => ({ flag, orders })).sort((a, b) => b.orders.length - a.orders.length),
    rows,
  };
}
