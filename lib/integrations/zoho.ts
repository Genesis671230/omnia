// Zoho Inventory API client — read-only. Zoho Inventory and Zoho Books share
// the same organization's items/sales orders/invoices when both apps are
// linked to one org (confirmed live: org 721369942 "Omniastores LLC" has
// AppList ["books","inventory"]), so the Inventory API surfaces both without
// needing a separately-scoped Books OAuth grant.
//
// Deliberately GET-only — there is no create/update/delete function in this
// file. Reference: https://www.zoho.com/inventory/api/v1/

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

const INVENTORY_BASE = API_BASE; // https://www.zohoapis.com/inventory/v1 — same base, customerpayments lives here too

export function zohoPaymentModeFor(gateway: string): string {
  const map: Record<string, string> = {
    COD: "Cash on Delivery",
  };
  return map[gateway] ?? "Bank Transfer";
}

export type ZohoCustomerPaymentInput = {
  invoiceReferenceNumber: string; // matches Omnia's order_number
  amount: number;
  gateway: string;
  bankReference: string;
};

// Finds the Zoho invoice whose reference_number matches our order_number,
// then records a Customer Payment against it via the Inventory API (the
// Books API 401s under this token's ZohoInventory.fullaccess.all scope,
// but /inventory/v1/customerpayments works — verified live against the org).
export async function createZohoCustomerPayment(input: ZohoCustomerPaymentInput): Promise<{ payment_id: string }> {
  const accessToken = await getAccessToken();
  const orgId = process.env.ZOHO_ORGANIZATION_ID!;

  const invoiceQs = new URLSearchParams({ organization_id: orgId, reference_number: input.invoiceReferenceNumber });
  const invoiceRes = await fetch(`${INVENTORY_BASE}/invoices?${invoiceQs}`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    cache: "no-store",
  });
  if (!invoiceRes.ok) throw new Error(`Zoho invoice lookup HTTP ${invoiceRes.status}`);
  const invoiceJson = await invoiceRes.json();
  const matches = invoiceJson.invoices ?? [];
  if (matches.length === 0) throw new Error(`No Zoho invoice found for reference_number ${input.invoiceReferenceNumber}`);
  if (matches.length > 1) throw new Error(`Ambiguous Zoho invoice match for reference_number ${input.invoiceReferenceNumber} (${matches.length} results)`);
  const invoice = matches[0];

  const paymentRes = await fetch(`${INVENTORY_BASE}/customerpayments?organization_id=${orgId}`, {
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
