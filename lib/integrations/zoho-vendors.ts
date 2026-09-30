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

async function books(method: "GET" | "POST", path: string, scope: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<Json> {
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

/** Active vendors, optionally narrowed by a search on name / company / email. */
export async function listVendors(search = ""): Promise<Vendor[]> {
  const json = await books("GET", "/contacts", "ZohoBooks.contacts.READ", {
    query: { contact_type: "vendor", status: "active", per_page: "200", sort_column: "contact_name", ...(search ? { search_text: search } : {}) },
  });
  return ((json.contacts ?? []) as Record<string, unknown>[]).map((c) => ({
    vendor_id: String(c.contact_id),
    name: String(c.contact_name ?? ""),
    company: String(c.company_name ?? ""),
    currency: String(c.currency_code ?? ""),
    outstanding: Number(c.outstanding_payable_amount ?? 0),
    unused_credits: Number(c.unused_credits_payable_amount ?? 0),
  }));
}

export type OpenBill = {
  bill_id: string; bill_number: string; reference_number: string; date: string; due_date: string;
  status: string; currency: string; total: number; balance: number;
};

/** A vendor's bills still owing (open, overdue, partially paid), oldest first. */
export async function listOpenBills(vendorId: string): Promise<OpenBill[]> {
  const json = await books("GET", "/bills", "ZohoBooks.bills.READ", {
    query: { vendor_id: vendorId, filter_by: "Status.Unpaid", per_page: "200", sort_column: "date", sort_order: "A" },
  });
  return ((json.bills ?? []) as Record<string, unknown>[])
    .map((b) => ({
      bill_id: String(b.bill_id), bill_number: String(b.bill_number ?? ""), reference_number: String(b.reference_number ?? ""),
      date: String(b.date ?? ""), due_date: String(b.due_date ?? ""), status: String(b.status ?? ""),
      currency: String(b.currency_code ?? ""), total: Number(b.total ?? 0), balance: Number(b.balance ?? 0),
    }))
    .filter((b) => b.balance > 0);
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
