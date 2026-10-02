// Suppliers in Zoho Books: vendors, their open bills, and vendor payments —
// what a bank debit to a supplier books as. Written to Zoho's own specs
// (vendor-payments.yml, bills.yml):
//
//   POST /vendorpayments { vendor_id, amount, date, paid_through_account_id,
//                          reference_number, description,
//                          bills: [{ bill_id, amount_applied }] }
//
// A payment with no bills (or with some left unapplied) stays on the vendor as
// an advance, applied to a bill later in Zoho.
//
// Needs the token's ZohoBooks.contacts / bills / vendorpayments scopes; without
// them Zoho answers code 57 and this throws ZohoScopeError naming what to grant.

import { getAccessToken } from "./zoho";
import { zohoBooksBase, zohoOrgId } from "./zoho-context";
import { zohoThrottledFetch } from "./zoho-throttle";

export class ZohoScopeError extends Error {
  constructor(readonly scope: string) {
    super(`This Zoho organisation's token isn't allowed to use ${scope}. Regenerate its refresh token with ZohoBooks.fullaccess.all (or add ${scope}) — Settings → Zoho organisations.`);
    this.name = "ZohoScopeError";
  }
}

/** A clean refusal: nothing was written. */
export class ZohoVendorRejection extends Error {}

type Json = { code?: number; message?: string; [k: string]: unknown };

async function books(method: "GET" | "POST" | "PUT", path: string, scope: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<Json> {
  const token = await getAccessToken();
  const url = new URL(`${zohoBooksBase()}${path}`);
  url.searchParams.set("organization_id", zohoOrgId());
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v) url.searchParams.set(k, v);
  const res = await zohoThrottledFetch(url.toString(), {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  if (json.code === 57 || res.status === 401) throw new ZohoScopeError(scope);
  if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    throw new ZohoVendorRejection(`Zoho ${method} ${path} (HTTP ${res.status}, code ${json.code}): ${json.message ?? "error"}`);
  }
  return json;
}

export type Vendor = { vendor_id: string; name: string; company: string; currency: string; outstanding: number; unused_credits: number };

// Zoho ignores search_text on /contacts (verified 2026-10-01: every search
// returned the same first 200), so all vendor pages are read once per org and
// searched here. Cached briefly — a supplier search is one keystroke away.
const vendorCache = new Map<string, { at: number; vendors: Vendor[] }>();
const VENDOR_TTL_MS = 10 * 60_000;

async function allVendors(): Promise<Vendor[]> {
  const org = zohoOrgId();
  const hit = vendorCache.get(org);
  if (hit && Date.now() - hit.at < VENDOR_TTL_MS) return hit.vendors;
  const out: Vendor[] = [];
  for (let page = 1; page <= 20; page++) {
    const json = await books("GET", "/contacts", "ZohoBooks.contacts.READ", {
      query: { contact_type: "vendor", status: "active", per_page: "200", page: String(page), sort_column: "contact_name" },
    });
    for (const c of (json.contacts ?? []) as Record<string, unknown>[]) {
      out.push({
        vendor_id: String(c.contact_id),
        name: String(c.contact_name ?? ""),
        company: String(c.company_name ?? ""),
        currency: String(c.currency_code ?? ""),
        outstanding: Number(c.outstanding_payable_amount ?? 0),
        unused_credits: Number(c.unused_credits_payable_amount ?? 0),
      });
    }
    if (!(json.page_context as { has_more_page?: boolean } | undefined)?.has_more_page) break;
  }
  vendorCache.set(org, { at: Date.now(), vendors: out });
  return out;
}

/** Active vendors, optionally narrowed by a search on name / company.
 *  Suppliers still owed money come first. */
export async function listVendors(search = ""): Promise<Vendor[]> {
  const q = search.trim().toLowerCase();
  const all = await allVendors();
  const hits = q ? all.filter((v) => `${v.name} ${v.company}`.toLowerCase().includes(q)) : all;
  return [...hits].sort((a, b) => Number(b.outstanding > 0) - Number(a.outstanding > 0) || a.name.localeCompare(b.name)).slice(0, 200);
}

const STOP = new Set(["LLC", "LTD", "CO", "COMPANY", "TRADING", "THE", "AND", "FZE", "FZCO", "LIMITED", "INTERNATIONAL", "GROUP", "BANK", "TRANS", "DEBIT", "OTHER", "INFO", "CHANNEL", "IBMB", "USD", "AED", "BEN", "TO", "OUTWARD", "T/T", "JEWELLERY", "JEWELRY", "SUPPLIER"]);
const tokens = (s: string) => s.toUpperCase().split(/[^A-Z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));

function nearPrefix(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short) && short.length / long.length >= 0.8;
}

/** Vendors a bank narration probably paid — by shared name words, or the
 *  bank's short beneficiary code ("/GUWU/" → GUWUX). Best first. */
export async function suggestVendors(narration: string, limit = 5): Promise<(Vendor & { score: number })[]> {
  const words = new Set(tokens(narration));
  if (!words.size) return [];
  const scored = (await allVendors()).map((v) => {
    const vt = tokens(`${v.name} ${v.company}`);
    let score = 0;
    for (const t of new Set(vt)) {
      if (words.has(t)) score += t.length >= 5 ? 3 : 2;
      // A near-whole prefix is the bank's beneficiary short code ("GUWU" →
      // GUWUX); a loose one is just a shared syllable ("GUANG" of Guangxi vs
      // Guang Zhou — different provinces), worth nothing.
      else if ([...words].some((w) => nearPrefix(t, w))) score += 2.5;
    }
    if (v.outstanding > 0) score += 0.5;
    return { ...v, score };
  });
  return scored.filter((v) => v.score >= 1.5).sort((a, b) => b.score - a.score).slice(0, limit);
}

export type OpenBill = {
  bill_id: string; bill_number: string; reference_number: string; date: string; due_date: string;
  status: string; currency: string; total: number; balance: number;
};

/** A vendor's bills still owing (open, overdue, partially paid), oldest first.
 *  Zoho ignores vendor_id on the bills list (verified 2026-10-01: every vendor
 *  got all 14 suppliers' bills), so the vendor is filtered here — paying one
 *  supplier's money onto another's bill must be impossible. */
export async function listOpenBills(vendorId: string): Promise<OpenBill[]> {
  const raw: Record<string, unknown>[] = [];
  for (let page = 1; page <= 10; page++) {
    const json = await books("GET", "/bills", "ZohoBooks.bills.READ", {
      query: { vendor_id: vendorId, filter_by: "Status.Unpaid", per_page: "200", page: String(page), sort_column: "date", sort_order: "A" },
    });
    raw.push(...((json.bills ?? []) as Record<string, unknown>[]));
    if (!(json.page_context as { has_more_page?: boolean } | undefined)?.has_more_page) break;
  }
  return raw
    .filter((b) => String(b.vendor_id) === vendorId)
    .map((b) => ({
      bill_id: String(b.bill_id), bill_number: String(b.bill_number ?? ""), reference_number: String(b.reference_number ?? ""),
      date: String(b.date ?? ""), due_date: String(b.due_date ?? ""), status: String(b.status ?? ""),
      currency: String(b.currency_code ?? ""), total: Number(b.total ?? 0), balance: Number(b.balance ?? 0),
    }))
    .filter((b) => b.balance > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** An existing vendor payment with this exact reference — so a retry never pays twice. */
export async function findVendorPaymentByReference(reference: string): Promise<string | null> {
  const json = await books("GET", "/vendorpayments", "ZohoBooks.vendorpayments.READ", { query: { reference_number: reference, per_page: "50" } });
  const hit = ((json.vendorpayments ?? []) as { payment_id?: string; reference_number?: string }[])
    .find((p) => String(p.reference_number ?? "").trim() === reference);
  return hit?.payment_id ?? null;
}

export type VendorPaymentInput = {
  vendorId: string;
  amount: number;
  date: string;
  paidThroughAccountId: string;
  reference: string;
  description: string;
  bills: { billId: string; amount: number }[];
};

export function buildVendorPaymentBody(p: VendorPaymentInput) {
  return {
    vendor_id: p.vendorId,
    amount: Math.round(p.amount * 100) / 100,
    date: p.date,
    paid_through_account_id: p.paidThroughAccountId,
    payment_mode: "Bank Transfer",
    reference_number: p.reference.slice(0, 100),
    description: p.description.slice(0, 500),
    ...(p.bills.length ? { bills: p.bills.map((b) => ({ bill_id: b.billId, amount_applied: Math.round(b.amount * 100) / 100 })) } : {}),
  };
}

export async function createVendorPayment(p: VendorPaymentInput): Promise<string> {
  const json = await books("POST", "/vendorpayments", "ZohoBooks.vendorpayments.CREATE", { body: buildVendorPaymentBody(p) });
  const id = (json.vendorpayment as { payment_id?: string } | undefined)?.payment_id;
  if (!id) throw new ZohoVendorRejection("Zoho created the vendor payment but returned no payment_id");
  return id;
}

/* ── advances: vendor payments with money not yet applied to a bill ────── */

export type VendorAdvance = {
  payment_id: string; payment_number: string; date: string; reference_number: string;
  amount: number; balance: number; paid_through_account_name: string; description: string;
};

/** A supplier's payments that still have an unused amount — an advance paid
 *  before the bill existed (a quotation deposit), to apply once it does.
 *  Filtered by vendor here: the list endpoint isn't trusted to. */
export async function listVendorAdvances(vendorId: string): Promise<VendorAdvance[]> {
  const raw: Record<string, unknown>[] = [];
  for (let page = 1; page <= 10; page++) {
    const json = await books("GET", "/vendorpayments", "ZohoBooks.vendorpayments.READ", {
      query: { vendor_id: vendorId, per_page: "200", page: String(page), sort_column: "date", sort_order: "A" },
    });
    raw.push(...((json.vendorpayments ?? []) as Record<string, unknown>[]));
    if (!(json.page_context as { has_more_page?: boolean } | undefined)?.has_more_page) break;
  }
  return raw
    .filter((p) => String(p.vendor_id) === vendorId && Number(p.balance ?? 0) > 0.005)
    .map((p) => ({
      payment_id: String(p.payment_id), payment_number: String(p.payment_number ?? ""), date: String(p.date ?? ""),
      reference_number: String(p.reference_number ?? ""), amount: Number(p.amount ?? 0), balance: Number(p.balance ?? 0),
      paid_through_account_name: String(p.paid_through_account_name ?? ""), description: String(p.description ?? ""),
    }));
}

type PaymentDetail = {
  payment_id: string; vendor_id: string; amount: number; balance: number; date: string; reference_number: string;
  description: string; payment_mode: string; paid_through_account_id: string; exchange_rate: number;
  bills: { bill_id: string; amount_applied: number }[];
};

export async function getVendorPayment(paymentId: string): Promise<PaymentDetail> {
  const json = await books("GET", `/vendorpayments/${encodeURIComponent(paymentId)}`, "ZohoBooks.vendorpayments.READ");
  const v = (json.vendorpayment ?? {}) as Record<string, unknown>;
  return {
    payment_id: String(v.payment_id), vendor_id: String(v.vendor_id), amount: Number(v.amount ?? 0), balance: Number(v.balance ?? 0),
    date: String(v.date ?? ""), reference_number: String(v.reference_number ?? ""), description: String(v.description ?? ""),
    payment_mode: String(v.payment_mode ?? ""), paid_through_account_id: String(v.paid_through_account_id ?? ""),
    exchange_rate: Number(v.exchange_rate ?? 1),
    bills: ((v.bills ?? []) as Record<string, unknown>[]).map((b) => ({ bill_id: String(b.bill_id), amount_applied: Number(b.amount_applied ?? 0) })),
  };
}

/** The PUT body that applies more of an existing payment to bills: Zoho
 *  replaces the payment's bill list, so the bills it already pays are kept
 *  and the new amounts added on top. Pure. */
export function buildApplyAdvanceBody(p: PaymentDetail, add: { billId: string; amount: number }[]) {
  const byBill = new Map(p.bills.map((b) => [b.bill_id, b.amount_applied]));
  for (const a of add) byBill.set(a.billId, Math.round(((byBill.get(a.billId) ?? 0) + a.amount) * 100) / 100);
  return {
    vendor_id: p.vendor_id,
    amount: p.amount,
    date: p.date,
    paid_through_account_id: p.paid_through_account_id,
    payment_mode: p.payment_mode || "Bank Transfer",
    reference_number: p.reference_number,
    description: p.description,
    exchange_rate: p.exchange_rate || 1,
    bills: [...byBill].filter(([, v]) => v > 0).map(([bill_id, amount_applied]) => ({ bill_id, amount_applied })),
  };
}

export async function applyAdvanceToBills(paymentId: string, add: { billId: string; amount: number }[]): Promise<void> {
  const p = await getVendorPayment(paymentId);
  const adding = Math.round(add.reduce((s, a) => s + a.amount, 0) * 100) / 100;
  if (adding > p.balance + 0.005) {
    throw new ZohoVendorRejection(`Only AED ${p.balance.toFixed(2)} of this payment is unused — can't apply AED ${adding.toFixed(2)}.`);
  }
  await books("PUT", `/vendorpayments/${encodeURIComponent(paymentId)}`, "ZohoBooks.vendorpayments.UPDATE", { body: buildApplyAdvanceBody(p, add) });
}

/** A new supplier in Zoho — for a bank payment to someone not set up yet. */
export async function createVendor(name: string): Promise<Vendor> {
  const json = await books("POST", "/contacts", "ZohoBooks.contacts.CREATE", {
    body: { contact_name: name.trim().slice(0, 200), company_name: name.trim().slice(0, 200), contact_type: "vendor" },
  });
  const c = (json.contact ?? {}) as Record<string, unknown>;
  vendorCache.delete(zohoOrgId());
  return {
    vendor_id: String(c.contact_id), name: String(c.contact_name ?? name), company: String(c.company_name ?? ""),
    currency: String(c.currency_code ?? ""), outstanding: 0, unused_credits: 0,
  };
}
