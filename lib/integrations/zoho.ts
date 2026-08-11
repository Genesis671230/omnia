// Zoho Inventory API client. Zoho Inventory and Zoho Books share the same
// organization's items/sales orders/invoices when both apps are linked to
// one org (confirmed live: org 721369942 "Omniastores LLC" has AppList
// ["books","inventory"]), so the Inventory API surfaces both without needing
// a separately-scoped Books OAuth grant.
//
// Every function here is read-only EXCEPT createZohoCustomerPayment, which
// writes a real Customer Payment against a real invoice — callers must go
// through the idempotency-safe claim flow in
// app/api/settlements/publish/route.ts, never call it directly from a
// retry loop. Reference: https://www.zoho.com/inventory/api/v1/

import { normalizeRef } from "@/lib/inventory-compare";

const ACCOUNTS_BASE = "https://accounts.zoho.com";
const API_BASE = "https://www.zohoapis.com/inventory/v1";

export function zohoConfigured(): boolean {
  return Boolean(
    process.env.ZOHO_REFRESH_TOKEN &&
    process.env.ZOHO_CLIENT_ID &&
    process.env.ZOHO_CLIENT_SECRET &&
    process.env.ZOHO_ORGANIZATION_ID,
  );
}

export async function getAccessToken(): Promise<string> {
  const res = await fetch(`${ACCOUNTS_BASE}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.ZOHO_CLIENT_ID!,
      client_secret: process.env.ZOHO_CLIENT_SECRET!,
      refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zoho OAuth token refresh HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error(`Zoho OAuth token refresh: no access_token in response — ${JSON.stringify(json).slice(0, 300)}`);
  return json.access_token as string;
}

async function zohoGetPaginated<T>(path: string, listKey: string, accessToken: string): Promise<T[]> {
  const orgId = process.env.ZOHO_ORGANIZATION_ID!;
  const out: T[] = [];
  let page = 1;
  for (;;) {
    const qs = new URLSearchParams({ organization_id: orgId, per_page: "200", page: String(page) });
    const res = await fetch(`${API_BASE}${path}?${qs.toString()}`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Zoho API HTTP ${res.status} (${path}): ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    if (json.code !== 0) throw new Error(`Zoho API error ${json.code} (${path}): ${json.message}`);
    const batch: T[] = json[listKey] ?? [];
    out.push(...batch);
    if (!json.page_context?.has_more_page) break;
    page += 1;
  }
  return out;
}

export type ZohoItem = {
  item_id: string;
  sku: string;
  name: string;
  stock_on_hand: number;
  available_stock: number;
  rate: number;
  purchase_rate: number;
  status: string;
};

export async function fetchZohoItems(): Promise<ZohoItem[]> {
  const accessToken = await getAccessToken();
  return zohoGetPaginated<ZohoItem>("/items", "items", accessToken);
}

export type ZohoSalesOrder = {
  salesorder_id: string;
  salesorder_number: string;
  reference_number: string;
  status: string;
  order_status: string;
  total: number;
  date: string;
};

export async function fetchZohoSalesOrders(): Promise<ZohoSalesOrder[]> {
  const accessToken = await getAccessToken();
  return zohoGetPaginated<ZohoSalesOrder>("/salesorders", "salesorders", accessToken);
}

export type ZohoInvoice = {
  invoice_id: string;
  invoice_number: string;
  reference_number: string;
  status: string;
  total: number;
  date: string;
};

export async function fetchZohoInvoices(): Promise<ZohoInvoice[]> {
  const accessToken = await getAccessToken();
  return zohoGetPaginated<ZohoInvoice>("/invoices", "invoices", accessToken);
}

export function zohoPaymentModeFor(gateway: string): string {
  const map: Record<string, string> = {
    COD: "Cash on Delivery",
    Stripe: "Stripe",
    Tabby: "Tabby",
    Tamara: "Tamara",
    "Checkout.com": "Checkout.com",
  };
  return map[gateway] ?? "Bank Transfer";
}

export type ZohoCustomerPaymentInput = {
  invoiceReferenceNumber: string; // matches Omnia's order_number
  amount: number;
  gateway: string;
  bankReference: string;
};

const AMOUNT_TOLERANCE_AED = 0.01; // absorbs FX-conversion rounding drift only

type ZohoInvoiceListRow = {
  invoice_id: string;
  reference_number: string;
  customer_id: string;
  balance: number;
};

// Finds the Zoho invoice matching our order_number, tolerating Zoho's
// reference-number formatting drift the same way lib/inventory-compare.ts's
// findOrdersMissingFromZoho does: try Zoho's own server-side filter first
// (fast path — works whenever formats already agree), and only fall back to
// pulling the full invoice list and comparing normalizeRef()'d values when
// the fast path finds nothing.
async function findZohoInvoice(orderNumber: string, accessToken: string, orgId: string): Promise<ZohoInvoiceListRow> {
  const normalized = normalizeRef(orderNumber);
  const invoiceQs = new URLSearchParams({ organization_id: orgId, reference_number: orderNumber });
  const invoiceRes = await fetch(`${API_BASE}/invoices?${invoiceQs}`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    cache: "no-store",
  });
  if (!invoiceRes.ok) throw new Error(`Zoho invoice lookup HTTP ${invoiceRes.status}`);
  const invoiceJson = await invoiceRes.json();
  let matches: ZohoInvoiceListRow[] = (invoiceJson.invoices ?? []).filter(
    (inv: ZohoInvoiceListRow) => normalizeRef(inv.reference_number || "") === normalized,
  );
  if (matches.length === 0) {
    const all = await zohoGetPaginated<ZohoInvoiceListRow>("/invoices", "invoices", accessToken);
    matches = all.filter((inv) => normalizeRef(inv.reference_number || "") === normalized);
  }
  if (matches.length === 0) throw new Error(`No Zoho invoice found for reference_number ${orderNumber}`);
  if (matches.length > 1) throw new Error(`Ambiguous Zoho invoice match for reference_number ${orderNumber} (${matches.length} results)`);
  return matches[0];
}

// Records a Customer Payment against the matched invoice via the Inventory
// API (the Books API 401s under this token's ZohoInventory.fullaccess.all
// scope, but /inventory/v1/customerpayments works — verified live against
// the org). `accessToken` is threaded in by the caller (fetched once per
// publish batch, not once per settlement) rather than fetched here.
//
// Defense-in-depth dedup: checks the matched invoice's own payment history
// for one already carrying this bank_reference before creating a new
// payment — covers the case where a prior attempt's Zoho write actually
// succeeded but the caller's own DB write failed (timeout/5xx), which the
// route's claim mechanism alone can't distinguish from "never attempted".
export async function createZohoCustomerPayment(input: ZohoCustomerPaymentInput, accessToken: string): Promise<{ payment_id: string }> {
  const orgId = process.env.ZOHO_ORGANIZATION_ID!;
  const invoice = await findZohoInvoice(input.invoiceReferenceNumber, accessToken, orgId);

  const detailRes = await fetch(`${API_BASE}/invoices/${invoice.invoice_id}?organization_id=${orgId}`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    cache: "no-store",
  });
  if (!detailRes.ok) throw new Error(`Zoho invoice detail HTTP ${detailRes.status}`);
  const detailJson = await detailRes.json();
  const invoiceDetail = detailJson.invoice ?? invoice;
  const existingPayment = (invoiceDetail.payments ?? []).find(
    (p: { reference_number?: string; payment_id: string }) => normalizeRef(p.reference_number || "") === normalizeRef(input.bankReference),
  );
  if (existingPayment) return { payment_id: existingPayment.payment_id };

  const balance = typeof invoiceDetail.balance === "number" ? invoiceDetail.balance : invoice.balance;
  if (typeof balance !== "number") {
    throw new Error(`Zoho invoice ${invoice.invoice_id} response has no balance field — cannot safely validate amount`);
  }
  if (input.amount > balance + AMOUNT_TOLERANCE_AED) {
    throw new Error(`Amount ${input.amount} exceeds Zoho invoice ${invoice.invoice_id} balance ${balance} — refusing to over-apply`);
  }

  const paymentRes = await fetch(`${API_BASE}/customerpayments?organization_id=${orgId}`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      customer_id: invoice.customer_id,
      payment_mode: zohoPaymentModeFor(input.gateway),
      amount: input.amount,
      date: new Date().toISOString().slice(0, 10),
      reference_number: input.bankReference,
      invoices: [{ invoice_id: invoice.invoice_id, amount_applied: input.amount }],
    }),
    cache: "no-store",
  });
  if (!paymentRes.ok) {
    const body = await paymentRes.text();
    throw new Error(`Zoho customer payment HTTP ${paymentRes.status}: ${body.slice(0, 300)}`);
  }
  const paymentJson = await paymentRes.json();
  if (paymentJson.code !== 0) throw new Error(`Zoho customer payment error ${paymentJson.code}: ${paymentJson.message}`);
  return { payment_id: paymentJson.payment.payment_id };
}
