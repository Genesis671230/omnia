

import { normalizeRef } from "@/lib/inventory-compare";
import { NextResponse } from "next/server";
import "dotenv/config";
const ACCOUNTS_BASE = "https://accounts.zoho.com";
const API_BASE = "https://www.zohoapis.com/books/v3";

export function zohoConfigured(): boolean {
  return Boolean(
    process.env.ZOHO_REFRESH_TOKEN &&
    process.env.ZOHO_CLIENT_ID &&
    process.env.ZOHO_CLIENT_SECRET &&
    process.env.ZOHO_ORGANIZATION_ID,
  );
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


export type ZohoCustomerField = {
  customfield_id?: string;  // preferred — send this after you fetch IDs once
  label?: string;           // fallback — case/whitespace-sensitive
  value: string | number;
};

export type ZohoPaymentCustomFieldMeta = {
  customfield_id: string;
  label: string;
  data_type: string;
  index: number;
  observed_count: number;    // how many sampled payments had this field populated
  sample_values: (string | number)[];  // first 3 non-empty values seen
};


export type ZohoInvoice = {
  invoice_id: string;
  invoice_number: string;
  reference_number: string;
  status: string;
  total: number;
  date: string;
};

export type ZohoCustomerPaymentInput = {
  customerName: string;
  invoiceReferenceNumber: string;
  amount: number;
  gateway: string;
  bankReference: string;
  date?: string;
  accountId?: string;
  referenceNumberOverride?: string;
  description?: string;
  bankCharges?: number;
  customFields?: ZohoCustomerField[];
  useInvoiceBalanceAsAmount?: boolean;
  payment_id: string;
  customer_id?: string;
  customer_name?: string;
  amount_refunded?: number;
  reference_number?: string;
  status?: string;
  invoices?: Array<{
    invoice_id: string;
    invoice_number?: string;
    invoice_amount?: number;
    amount_applied?: number;
    balance_amount?: number;
  }>;
  invoice:any;

};

const AMOUNT_TOLERANCE_AED = 0.01; // absorbs FX-conversion rounding drift only

type ZohoInvoiceListRow = {
  reference_number?: string;
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  date: string;              // ISO date, e.g. "2026-08-14"
  due_date: string;
  status: ZohoInvoiceStatus;
  total: number;
  balance: number;
  currency_code: string;
  order_number:string;
  
};

export type CustomerPaymentBody = {
  customer_id: string;
  payment_mode: string;
  amount: number;
  date: string;
  customer_name: string;
  reference_number: string;
  account_id?: string;
  description?: string;
  bank_charges?: number;
  custom_fields?: ZohoCustomerField[];
  invoices: Array<{ invoice_id: string; amount_applied: number }>;
};



export type ZohoInvoiceStatus =
  | "unpaid" | "overdue" | "partially_paid" | "paid"
  | "sent" | "draft" | "viewed" | "void";

export type ZohoInvoiceListParams = {
  status?: ZohoInvoiceStatus | "all";
  dateStart?: string;         // "YYYY-MM-DD"
  dateEnd?: string;
  page?: number;              // 1-indexed
  perPage?: number;           // Zoho max = 200
};

export type ZohoInvoiceListResult = {
  invoices: ZohoInvoiceListRow[];
  page: number;
  perPage: number;
  hasMorePage: boolean;
};
  
  export type ZohoSalesOrder = {
    salesorder_id: string;
    salesorder_number: string;
    reference_number: string;
    status: string;
    order_status: string;
    total: number;
    date: string;
  };
export type CreatePaymentResult = {
  payment_id: string;
  outcome: "posted" | "already_paid_full" | "skipped_prior_payment" | "updated";
};


let cachedAccessToken: {
  token: string;
  expiresAt: number;
} | null = null;

let refreshPromise: Promise<string> | null = null;
async function zohoFetch(
  url: string,
  accessToken: string,
  orgId: string,
  init: RequestInit = {},
) {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "X-com-zoho-books-organizationid": orgId,
    },
    cache: "no-store",
  });

  return res;
}
export async function getAccessToken(): Promise<string> {
  const now = Date.now();

  // Reuse token until ~5 minutes before expiry.
  if (
    cachedAccessToken &&
    cachedAccessToken.expiresAt > now + 5 * 60 * 1000
  ) {
    return cachedAccessToken.token;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = refreshZohoAccessToken();

  try {
    const token = await refreshZohoAccessToken();
    return token;
  } finally {
    refreshPromise = null;
  }
}

async function refreshZohoAccessToken(): Promise<string> {
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN!;
  const clientId = process.env.ZOHO_CLIENT_ID!;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET!;
console.log("refreshToken",refreshToken)
console.log("clientId",clientId)
console.log("clientSecret",clientSecret)
  const accountsUrl =
    process.env.ZOHO_ACCOUNTS_URL ?? "https://accounts.zoho.com";



  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  const res = await fetch(`${accountsUrl}/oauth/v2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  const json = await res.json();

  if (!res.ok || json.error) {
    throw new Error(
      `Zoho OAuth refresh failed HTTP ${res.status}: ${
        json.error_description ?? json.error ?? JSON.stringify(json)
      }`,
    );
  }

  const expiresIn = Number(json.expires_in ?? 3600);

  cachedAccessToken = {
    token: json.access_token,
    // Keep a safety margin so we don't use an expired token.
    expiresAt: Date.now() + (expiresIn - 5 * 60) * 1000,
  };

  return json.access_token;
}

export async function zohoGetPaginated<T>(path: string, listKey: string, accessToken: string): Promise<T[]> {
  const orgId = process.env.ZOHO_ORGANIZATION_ID!;
  const out: T[] = [];
  let page = 1;
  for (;;) {
    const qs = new URLSearchParams({ organization_id: orgId, per_page: "200", page: String(page) });
    const res = await fetch(`${API_BASE}${path}?${qs.toString()}`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, "X-com-zoho-books-organizationid": orgId },
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

  
export async function fetchZohoItems(): Promise<ZohoItem[]> {
  const accessToken = await getAccessToken();
  return zohoGetPaginated<ZohoItem>("/items", "items", accessToken);
}
export async function fetchZohoSalesOrders(): Promise<ZohoSalesOrder[]> {
  const accessToken = await getAccessToken();
  return zohoGetPaginated<ZohoSalesOrder>("/salesorders", "salesorders", accessToken);
}


export async function fetchZohoInvoices(): Promise<ZohoInvoice[]> {
  const accessToken = await getAccessToken();
  return zohoGetPaginated<ZohoInvoice>("/invoices", "invoices", accessToken);
}

export function zohoPaymentModeFor(gateway: string): string {
  const g = (gateway ?? "").toUpperCase().replace(/[\s_-]+/g, "");
  const isCod = g === "COD" || g === "ONTRACK" || g === "CASHONDELIVERY";
  return isCod ? "Cash on Delivery" : "Credit Card";
}


async function findExistingCustomerPayment(
  invoiceId: string,
  customerId: string,
  accessToken: string,
  orgId: string,
): Promise<ZohoCustomerPaymentInput | null> {
  const qs = new URLSearchParams({
    organization_id: orgId,
    per_page: "200",
    customer_id: customerId,
  });

  const res = await fetch(
    `${API_BASE}/customerpayments?${qs.toString()}`,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "X-com-zoho-books-organizationid": orgId,
      },
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const text = await res.text();

    throw new Error(
      `Zoho customer payment lookup HTTP ${res.status}: ${text.slice(0, 500)}`,
    );
  }

  const json = await res.json();

  if (json.code !== 0) {
    throw new Error(
      `Zoho customer payment lookup error ${json.code}: ${json.message}`,
    );
  }

  const payments: ZohoCustomerPaymentInput[] =
    json.customerpayments ?? [];

  console.log("[Zoho] customer payments found", {
    customerId,
    count: payments.length,
  });

  /*
   * IMPORTANT:
   *
   * The customerpayments LIST response may not contain the full
   * invoice association. Therefore we fetch each payment detail
   * and inspect its invoices.
   */
  for (const payment of payments) {
    if (!payment.payment_id) continue;

    const detailRes = await fetch(
      `${API_BASE}/customerpayments/${payment.payment_id}?organization_id=${orgId}`,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          "X-com-zoho-books-organizationid": orgId,
        },
        cache: "no-store",
      },
    );

    if (!detailRes.ok) {
      console.warn(
        "[Zoho] Could not fetch payment detail",
        payment.payment_id,
      );
      continue;
    }

    const detailJson = await detailRes.json();

    if (detailJson.code !== 0) {
      console.warn(
        "[Zoho] Payment detail error",
        payment.payment_id,
        detailJson.message,
      );
      continue;
    }

    const detail = detailJson.payment as ZohoCustomerPaymentInput | undefined;

    if (!detail) continue;

    const belongsToInvoice = (detail.invoices ?? []).some(
      (inv) => String(inv.invoice_id) === String(invoiceId),
    );

    if (belongsToInvoice) {
      console.log("[Zoho] Existing customer payment found", {
        paymentId: detail.payment_id,
        customerId,
        invoiceId,
        amount: detail.amount,
        referenceNumber: detail.reference_number,
      });

      return detail;
    }
  }

  console.log("[Zoho] No existing customer payment found", {
    customerId,
    invoiceId,
  });

  return null;
}

export async function listCustomerPaymentCustomFields(
  accessToken: string,
  opts?: { sampleSize?: number },
): Promise<ZohoPaymentCustomFieldMeta[]> {
  const orgId = process.env.ZOHO_ORGANIZATION_ID!;
  const sampleSize = opts?.sampleSize ?? 10;

  const listRes = await fetch(
    `https://www.zohoapis.com/books/v3/customerpayments?organization_id=${orgId}&per_page=${sampleSize}`,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "X-com-zoho-books-organizationid": orgId,
      },
      cache: "no-store",
    },
  );
  if (!listRes.ok) {
    const body = await listRes.text();
    throw new Error(`Zoho customerpayments list HTTP ${listRes.status}: ${body.slice(0, 300)}`);
  }
  const listJson = await listRes.json();
  console.log("listRes",listJson,sampleSize)
  if (listJson.code !== 0) {
    throw new Error(`Zoho customerpayments list error ${listJson.code}: ${listJson.message}`);
  }

  const paymentIds: string[] = (listJson.customerpayments ?? [])
    .map((p: { payment_id: string }) => p.payment_id)
    .filter(Boolean);

  const schema = new Map<string, ZohoPaymentCustomFieldMeta>();

  for (const paymentId of paymentIds) {
    const detailRes = await fetch(
      `https://www.zohoapis.com/inventory/v1/customerpayments/${paymentId}?organization_id=${orgId}`,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          "X-com-zoho-books-organizationid": orgId,
        },
        cache: "no-store",
      },
    );
    if (!detailRes.ok) continue;
    const detailJson = await detailRes.json();
    if (detailJson.code !== 0) continue;

    const customFields = detailJson.payment?.custom_fields ?? [];
    for (const cf of customFields) {
      if (!cf.customfield_id || !cf.label) continue;
      const key: string = cf.customfield_id;
      const hasValue = cf.value != null && cf.value !== "";
      const existing = schema.get(key);
      if (existing) {
        existing.observed_count += 1;
        if (hasValue && existing.sample_values.length < 3) {
          existing.sample_values.push(cf.value);
        }
      } else {
        schema.set(key, {
          customfield_id: cf.customfield_id,
          label: cf.label,
          data_type: cf.data_type ?? "text",
          index: cf.index ?? 0,
          observed_count: 1,
          sample_values: hasValue ? [cf.value] : [],
        });
      }
    }
  }

  return Array.from(schema.values()).sort((a, b) => a.index - b.index);
}
// Maps user-supplied custom fields (which may reference `label` OR
// `customfield_id`) to a validated array with `customfield_id` populated
// from the cached schema. Throws on unknown labels — Zoho silently drops
// unrecognized fields, so a typo would post the payment with the field
// missing and no error signal. Loud failure is safer than silent data
// loss for accounting.
export function resolveCustomFields(
  requested: ZohoCustomerField[],
  schema: ZohoPaymentCustomFieldMeta[],
): ZohoCustomerField[] {
  const byId = new Map(schema.map((s) => [s.customfield_id, s]));
  const byLabel = new Map(schema.map((s) => [s.label.trim().toLowerCase(), s]));

  return requested.map((field) => {
    if (field.customfield_id && byId.has(field.customfield_id)) {
      return { customfield_id: field.customfield_id, value: field.value };
    }
    if (field.label) {
      const meta = byLabel.get(field.label.trim().toLowerCase());
      if (meta) {
        return { customfield_id: meta.customfield_id, value: field.value };
      }
    }
    throw new Error(
      `Zoho custom field not found in schema: ${JSON.stringify(field)}. ` +
        `Known fields: ${schema.map((s) => `"${s.label}" (${s.customfield_id})`).join(", ") || "(none — did you sample from an empty org?)"}. ` +
        `If this field was just added in Zoho, refresh the cached schema.`,
    );
  });
}
export function buildCustomerPaymentBody(
  input: ZohoCustomerPaymentInput & { customerId: string; invoiceId: string; amountApplied: number; balance: number },
): CustomerPaymentBody {
  return {
    customer_id: input.customerId,
    payment_mode: zohoPaymentModeFor(input.gateway),
    amount: input.amount,
    date: input.date ?? new Date().toISOString().slice(0, 10),
    customer_name: input.customerName,
    reference_number: input.referenceNumberOverride || input.bankReference,
    account_id: input.accountId,
    ...(input.description ? { description: input.description } : {}),
    ...(input.bankCharges ? { bank_charges: input.bankCharges } : {}),
    ...(input.customFields ? { custom_fields: input.customFields } : {}),
    invoices: [{ invoice_id: input.invoiceId, amount_applied:input.amountApplied }],
  };
}

export async function findZohoInvoice(
  orderNumber: string,
  accessToken: string,
  orgId: string,
): Promise<ZohoInvoiceListRow> {
  const wanted = orderNumber?.trim();
  if (!wanted) throw new Error("Cannot find Zoho invoice: order number is empty");

  const fetchByCustomerNamePrefix = async (prefix: string): Promise<ZohoInvoiceListRow[]> => {
    const qs = new URLSearchParams({
      organization_id: orgId,
      customer_name_startswith: prefix,
      per_page: "200",
    });
    const res = await fetch(`${API_BASE}/invoices?${qs.toString()}`, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "X-com-zoho-books-organizationid": orgId,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Zoho invoice lookup HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    if (json.code !== 0) throw new Error(`Zoho invoice lookup error ${json.code}: ${json.message}`);
    return (json.invoices ?? []) as ZohoInvoiceListRow[];
  };

  // Word-boundary filter: order_number must be followed by whitespace or
  // end-of-string, so "3311" doesn't match a customer named "33110 Foo".
  const startsAtWordBoundary = (name: string, needle: string) => {
    const n = (name ?? "").trim();
    if (!n.toLowerCase().startsWith(needle.toLowerCase())) return false;
    const next = n.charAt(needle.length);
    return next === "" || /\s/.test(next);
  };

  let matches = (await fetchByCustomerNamePrefix(wanted))
    .filter((r) => startsAtWordBoundary(r.customer_name, wanted));

  const bare = wanted.replace(/^(WA|UAE|KSA|WOO|SA)/i, "").trim();
  if (matches.length === 0 && bare !== wanted) {
    matches = (await fetchByCustomerNamePrefix(bare))
      .filter((r) => startsAtWordBoundary(r.customer_name, bare));
  }

  console.log("[Zoho] Invoice lookup", {
    orderNumber: wanted, bare, matchCount: matches.length,
    matches: matches.map((m) => ({
      invoice_id: m.invoice_id,
      invoice_number: m.invoice_number,
      customer_name: m.customer_name,
      balance: m.balance,
      status: m.status,
    })),
  });

  if (matches.length === 0) throw new Error(`No Zoho invoice found for order ${wanted}`);
  if (matches.length === 1) return matches[0];

  const withBalance = matches.filter((m) => Number(m.balance ?? 0) > AMOUNT_TOLERANCE_AED);
  if (withBalance.length === 1) return withBalance[0];
  if (withBalance.length === 0) return matches[0];

  throw new Error(
    `Ambiguous Zoho invoice match for ${wanted} (${withBalance.length} invoices with balance) — resolve manually in Zoho`,
  );
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
// Note: this check is keyed on bankReference specifically, so a payment
// posted with a referenceNumberOverride won't be found by it on a later
// retry — accepted, since the primary defense (the caller's atomic claim
// before any Zoho call) is unaffected, and truly ambiguous failures are
// routed to manual review rather than blindly retried.
export async function createZohoCustomerPayment(input: ZohoCustomerPaymentInput & { writeOffResidualAsFee?: boolean,invoiceId:string,paymentMode:string,referenceNumber:string }, accessToken: string,opts?: { customFieldSchema?: ZohoPaymentCustomFieldMeta[] },
): Promise<CreatePaymentResult> {
  let invoiceDetail = input.invoice;
  const orgId = process.env.ZOHO_ORGANIZATION_ID!;
  let invoice = input.invoice;

if(!invoiceDetail){

  invoice = await findZohoInvoice(input.invoiceReferenceNumber, accessToken, orgId);
  
  
  const detailRes = await fetch(
    `${API_BASE}/invoices/${invoice.invoice_id}?organization_id=${orgId}`,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "X-com-zoho-books-organizationid": orgId,
      },
      cache: "no-store",
    },
  );
  
  if (!detailRes.ok) {
    const body = await detailRes.text();
    
    throw new Error(
      `Zoho invoice detail HTTP ${detailRes.status}: ${body.slice(0, 300)}`,
    );
  }
  
  const detailJson = await detailRes.json();
  
  if (detailJson.code !== 0) {
    throw new Error(
      `Zoho invoice detail error ${detailJson.code}: ${detailJson.message}`,
    );
  }
  
  invoiceDetail = detailJson.invoice?detailJson.invoice: invoice;
  
  
  if (!invoiceDetail) {
    throw new Error(
      `Zoho invoice ${invoice.invoice_id} response contains no invoice object`,
    );
  }
}
  const balance = input.amount?input.amount: Number(invoiceDetail.balance);
  
  if (invoiceDetail.status === "paid" || balance <= AMOUNT_TOLERANCE_AED) {
    return { payment_id: `EXTERNAL:${invoice.invoice_id}`, outcome: "already_paid_full" as const };
  }
  if (!Number.isFinite(balance)) {
    throw new Error(
      `Zoho invoice ${invoice.invoice_id} has invalid balance: ${invoiceDetail.balance}`,
    );
  }
  const amountToApply = input.useInvoiceBalanceAsAmount ? balance : input.amount;
  if (!input.useInvoiceBalanceAsAmount && input.amount > balance + AMOUNT_TOLERANCE_AED) {
  throw new Error(
    `Amount ${input.amount} exceeds Zoho invoice ${invoice.invoice_id} balance ${balance} — refusing to over-apply`,
  );
}
if (!input.accountId) {
  throw new Error("accountId is required — the Zoho Deposit To account must be selected before publishing.");
}

console.log("[Zoho] invoice state", {
  invoiceId: invoiceDetail.invoice_id,
  invoiceNumber: invoiceDetail.invoice_number,
  status: invoiceDetail.status,
  total: invoiceDetail.total,
  paymentMade: invoiceDetail.payment_made,
  balance: invoiceDetail.balance,
});
 
  if (input.amount > balance + AMOUNT_TOLERANCE_AED) {
    throw new Error(
      `Amount ${input.amount} exceeds Zoho invoice ${invoice.invoice_id} balance ${balance} — refusing to over-apply`,
    );
  }
  if (!input.accountId) {
    throw new Error(
      "accountId is required — the Zoho Deposit To account must be selected before publishing.",
    );
  }
  
  if (invoiceDetail.status === "paid" || balance <= AMOUNT_TOLERANCE_AED) {
    return {
      payment_id: `EXTERNAL:${invoice.invoice_id}`,
      outcome: "already_paid_full",
    };
  }
  const residual = balance - input.amount;
  const FEE_CAP_AED = 60;
const FEE_CAP_PCT = 0.05; // 5% of invoice total
const looksLikeFee =
  input.writeOffResidualAsFee &&
  residual > AMOUNT_TOLERANCE_AED &&
  residual <= FEE_CAP_AED &&
  residual <= invoiceDetail.total * FEE_CAP_PCT;

const bankCharges = looksLikeFee ? Number(residual.toFixed(2)) : 0;
const amountApplied = looksLikeFee ? input.amount + bankCharges : input.amount;


  const resolvedCustomFields =
    input.customFields && opts?.customFieldSchema
      ? resolveCustomFields(input.customFields, opts.customFieldSchema)
      : input.customFields;



  const body = buildCustomerPaymentBody({
    ...input,
    amount: balance,
    amountApplied: balance,
    customFields: resolvedCustomFields,
    customerId: invoice.customer_id,
    invoiceId: invoice.invoice_id,
    balance: balance,
  });


try {
  const existingPayment = await findExistingCustomerPayment(
    invoice.invoice_id,
    invoice.customer_id,
    accessToken,
    orgId,
  );
  if (existingPayment) {
    // -----------------------------------------
    // EXISTING PAYMENT → UPDATE
    // -----------------------------------------
  
    console.log("[Zoho] Updating existing customer payment", {
      paymentId: existingPayment.payment_id,
      invoiceId: invoice.invoice_id,
      customerId: invoice.customer_id,
    });
  
    const updateRes = await fetch(
      `${API_BASE}/customerpayments/${existingPayment.payment_id}?organization_id=${orgId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          "Content-Type": "application/json",
          "X-com-zoho-books-organizationid": orgId,
        },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );
  
    if (!updateRes.ok) {
      const errBody = await updateRes.text();
  
      throw new Error(
        `Zoho customer payment UPDATE HTTP ${updateRes.status}: ${errBody.slice(0, 500)}`,
      );
    }
  
    const updateJson = await updateRes.json();
  
    if (updateJson.code !== 0) {
      throw new Error(
        `Zoho customer payment UPDATE error ${updateJson.code}: ${updateJson.message}`,
      );
    }
  
    console.log("[Zoho] Customer payment updated", {
      paymentId: updateJson.payment?.payment_id ??
        existingPayment.payment_id,
    });
  
    return {
      payment_id:
        updateJson.payment?.payment_id ??
        existingPayment.payment_id,
      outcome: "updated" as const,
    };
  }else{
console.log(body,"amount balance etc niovice")
const createRes = await fetch(
  `${API_BASE}/customerpayments?organization_id=${orgId}`,
  {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
      "X-com-zoho-books-organizationid": orgId,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  },
)

if (!createRes.ok) {
  const errBody = await createRes.text();

  throw new Error(
    `Zoho customer payment CREATE HTTP ${createRes.status}: ${errBody.slice(0, 500)}`,
  );
}

const createJson = await createRes.json();

if (createJson.code !== 0) {
  throw new Error(
    `Zoho customer payment CREATE error ${createJson.code}: ${createJson.message}`,
  );
}

return {
  payment_id: createJson.payment.payment_id,
  outcome: "posted" as const,
};
}
} catch (error) {
 console.error(error,"this is error from createZohoCustomerPayment");
 throw new Error(`Zoho customer payment error: ${error}`);
}


}
export async function getZohoInvoiceDetail(
  invoiceId: string,
  accessToken: string,
  orgId: string,
): Promise<ZohoInvoiceListRow> {

  const res = await zohoFetch(
    `${API_BASE}/invoices/${invoiceId}?organization_id=${orgId}`,
    accessToken,
    orgId
  );
  if (!res.ok) throw new Error(`Zoho invoice detail HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`Zoho invoice detail error ${json.code}: ${json.message}`);
  return json.invoice as ZohoInvoiceListRow;
}

export async function listZohoInvoices(
  params: ZohoInvoiceListParams,

): Promise<ZohoInvoiceListResult> {

  if (!zohoConfigured()) {
    throw new Error("error: Zoho is not configured — set ZOHO_REFRESH_TOKEN, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_ORGANIZATION_ID");
  }
  const orgId = process.env.ZOHO_ORGANIZATION_ID!;
    const accessToken = await getAccessToken();
  const qs = new URLSearchParams({
    organization_id: orgId,
    per_page: String(params.perPage ?? 200),
    page: String(params.page ?? 1),
  });

  if (params.status && params.status !== "all") {
    qs.set("status", params.status);
  }
  if (params.dateStart) qs.set("date_start", params.dateStart);
  if (params.dateEnd) qs.set("date_end", params.dateEnd);


  const res = await zohoFetch(
    `${API_BASE}/invoices?${qs.toString()}`,
    accessToken,
    orgId,
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zoho invoice list HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`Zoho invoice list error ${json.code}: ${json.message}`);
  }

  return {
    invoices: (json.invoices ?? []) as ZohoInvoiceListRow[],
    page: json.page_context?.page ?? 1,
    perPage: json.page_context?.per_page ?? 200,
    hasMorePage: !!json.page_context?.has_more_page,
  };
}

// Paginate across all pages up to a hard cap — protects against runaway
// on a big date range.
export async function listZohoInvoicesAll(
  params: Omit<ZohoInvoiceListParams, "page">,
  orgId: string,
  maxPages = 2,
): Promise<ZohoInvoiceListRow[]> {
  const all: ZohoInvoiceListRow[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await listZohoInvoices({ ...params, page });
    all.push(...r.invoices);
    if (!r.hasMorePage) break;
  }
  return all;
}