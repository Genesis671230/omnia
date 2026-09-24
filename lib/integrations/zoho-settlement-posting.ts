// Zoho Books I/O for booking a settled order: customer payment, fee expense,
// FX journal, and the lookups a retry needs to avoid posting twice.
//
// Errors are split in two on purpose:
//   ZohoRejection — Zoho answered and refused (or we never sent the request,
//     e.g. the daily quota guard). Nothing was written; safe to retry now.
//   anything else — the request may or may not have landed (timeout, network).
//     The caller leaves a PENDING marker so the next attempt checks Zoho first.

import { zohoThrottledFetch, ZohoQuotaExceededError } from "@/lib/integrations/zoho-throttle";
import { fetchZohoBankAccounts, fetchZohoChartOfAccounts } from "@/lib/integrations/zoho-banking";

const BOOKS_BASE = process.env.ZOHO_BOOKS_BASE ?? "https://www.zohoapis.com/books/v3";

export class ZohoRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZohoRejection";
  }
}

type BooksJson = { code?: number; message?: string; [k: string]: unknown };

async function books(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  accessToken: string,
  opts: { query?: Record<string, string>; body?: unknown } = {},
): Promise<BooksJson> {
  const orgId = process.env.ZOHO_ORGANIZATION_ID ?? "";
  const url = new URL(`${BOOKS_BASE}${path}`);
  url.searchParams.set("organization_id", orgId);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await zohoThrottledFetch(url.toString(), {
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "X-com-zoho-books-organizationid": orgId,
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
      cache: "no-store",
    });
  } catch (e) {
    // The quota guard throws before any request leaves — nothing was written.
    if (e instanceof ZohoQuotaExceededError) throw new ZohoRejection(e.message);
    throw e;
  }

  const text = await res.text();
  let json: BooksJson;
  try {
    json = JSON.parse(text);
  } catch {
    if (!res.ok) throw new ZohoRejection(`Zoho ${method} ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
    throw new Error(`Zoho ${method} ${path} returned non-JSON: ${text.slice(0, 300)}`);
  }
  if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    throw new ZohoRejection(`Zoho ${method} ${path} (HTTP ${res.status}, code ${json.code}): ${json.message ?? text.slice(0, 300)}`);
  }
  return json;
}

// ── lookups ──────────────────────────────────────────────────────────────────

type CustomerPaymentRow = {
  payment_id: string;
  reference_number?: string;
  invoice_numbers?: string;
  amount?: number;
};

/** A payment this flow already made against the invoice: same reference, and
 *  (when Zoho lists it) the same invoice. Anything else is someone else's. */
export async function findOurPaymentOnInvoice(opts: {
  customerId: string;
  invoiceNumber: string;
  references: string[];
  accessToken: string;
}): Promise<string | null> {
  const json = await books("GET", "/customerpayments", opts.accessToken, {
    query: { customer_id: opts.customerId, per_page: "200" },
  });
  const refs = new Set(opts.references.filter(Boolean).map((r) => r.trim().toLowerCase()));
  const rows = (json.customerpayments ?? []) as CustomerPaymentRow[];
  const hit = rows.find((p) => {
    const refOk = refs.has(String(p.reference_number ?? "").trim().toLowerCase());
    const invoices = String(p.invoice_numbers ?? "");
    const invoiceOk = !invoices || invoices.split(/\s*,\s*/).includes(opts.invoiceNumber);
    return refOk && invoiceOk;
  });
  return hit?.payment_id ?? null;
}

/** Whether a customer payment still exists in Zoho. A payment id we stored
 *  can be deleted in Zoho afterwards (order 804671: payment deleted, both
 *  invoices overdue again, our record still said "booked"). */
export async function customerPaymentExists(paymentId: string, accessToken: string): Promise<boolean> {
  try {
    await books("GET", `/customerpayments/${encodeURIComponent(paymentId)}`, accessToken);
    return true;
  } catch (e) {
    if (e instanceof ZohoRejection && /HTTP 404|code 1002\b/.test(e.message)) return false;
    throw e;
  }
}

/** Find an expense or journal by the exact reference an earlier attempt used. */
export async function findDocumentByReference(
  kind: "expenses" | "journals",
  reference: string,
  accessToken: string,
): Promise<string | null> {
  const json = await books("GET", `/${kind}`, accessToken, {
    query: { reference_number: reference, per_page: "200" },
  });
  const rows = (json[kind] ?? []) as { expense_id?: string; journal_id?: string; reference_number?: string }[];
  const hit = rows.find((r) => String(r.reference_number ?? "").trim() === reference);
  return (kind === "expenses" ? hit?.expense_id : hit?.journal_id) ?? null;
}

// ── writes ───────────────────────────────────────────────────────────────────

export async function createCustomerPayment(body: unknown, accessToken: string): Promise<string> {
  const json = await books("POST", "/customerpayments", accessToken, { body });
  const id = (json.payment as { payment_id?: string } | undefined)?.payment_id;
  if (!id) throw new Error("Zoho created the customer payment but returned no payment_id");
  return id;
}

export async function createExpense(body: unknown, accessToken: string): Promise<string> {
  const json = await books("POST", "/expenses", accessToken, { body });
  const id = (json.expense as { expense_id?: string } | undefined)?.expense_id;
  if (!id) throw new Error("Zoho created the expense but returned no expense_id");
  return id;
}

export async function createJournal(body: unknown, accessToken: string): Promise<string> {
  const json = await books("POST", "/journals", accessToken, { body });
  const id = (json.journal as { journal_id?: string } | undefined)?.journal_id;
  if (!id) throw new Error("Zoho created the journal but returned no journal_id");
  return id;
}

/** Rewrite an expense in place. Used to correct a figure already booked —
 *  preferred over delete-and-repost, which would break the reference-based
 *  idempotency every other path relies on. */
export async function updateExpense(expenseId: string, body: unknown, accessToken: string): Promise<void> {
  await books("PUT", `/expenses/${encodeURIComponent(expenseId)}`, accessToken, { body });
}

export async function updateJournal(journalId: string, body: unknown, accessToken: string): Promise<void> {
  await books("PUT", `/journals/${encodeURIComponent(journalId)}`, accessToken, { body });
}

/** The whole document as Zoho holds it — so a correction can re-send every
 *  field it already had and change only the figure that was wrong. */
export async function fetchDocument(
  kind: "expenses" | "journals",
  id: string,
  accessToken: string,
): Promise<Record<string, unknown> | null> {
  let json: Record<string, unknown>;
  try {
    json = await books("GET", `/${kind}/${encodeURIComponent(id)}`, accessToken, {});
  } catch (e) {
    // Deleted in Zoho after we stored its id — a real state, not an error.
    if (/HTTP 404/.test((e as Error).message)) return null;
    throw e;
  }
  const doc = (kind === "expenses" ? json.expense : json.journal) as Record<string, unknown> | undefined;
  return doc ?? null;
}

/** What a booked expense/journal currently says in Zoho, for verifying a
 *  correction landed rather than trusting our own write. */
export async function fetchDocumentTotal(
  kind: "expenses" | "journals",
  id: string,
  accessToken: string,
): Promise<number | null> {
  const json = await books("GET", `/${kind}/${encodeURIComponent(id)}`, accessToken, {});
  const doc = (kind === "expenses" ? json.expense : json.journal) as
    | { total?: number; amount?: number }
    | undefined;
  if (!doc) return null;
  const v = doc.total ?? doc.amount;
  return v == null ? null : Number(v);
}

// ── account / tax options for the posting form ───────────────────────────────

export type PostingAccountOption = { account_id: string; account_name: string; account_type: string };
export type PostingTaxOption = { tax_id: string; tax_name: string; tax_percentage: number };
export type PostingOptions = {
  depositAccounts: PostingAccountOption[];
  feeAccounts: PostingAccountOption[];
  differenceAccounts: PostingAccountOption[];
  taxes: PostingTaxOption[];
  /** The "Input VAT" ledger account — reversed when a refund hands a fee back. */
  inputVatAccountId?: string | null;
};

const DEPOSIT_TYPES = new Set(["bank", "cash", "payment_clearing", "credit_card"]);
const FEE_TYPES = new Set(["expense", "other_expense", "cost_of_goods_sold"]);
const DIFFERENCE_TYPES = new Set(["other_expense", "other_income", "expense", "income"]);

export async function fetchPostingOptions(accessToken: string): Promise<PostingOptions> {
  const [bank, coa, taxJson] = await Promise.all([
    fetchZohoBankAccounts(accessToken),
    fetchZohoChartOfAccounts(accessToken),
    books("GET", "/settings/taxes", accessToken),
  ]);
  const active = coa.filter((a) => a.is_active);
  const pick = (types: Set<string>) =>
    active
      .filter((a) => types.has(a.account_type))
      .map(({ account_id, account_name, account_type }) => ({ account_id, account_name, account_type }))
      .sort((a, b) => a.account_name.localeCompare(b.account_name));

  // /bankaccounts is the authoritative list of what Zoho accepts as a
  // "Deposit To"; the chart of accounts fills in any clearing account it omits.
  const deposit = new Map<string, PostingAccountOption>();
  for (const b of bank.filter((b) => b.is_active !== false)) {
    deposit.set(b.account_id, { account_id: b.account_id, account_name: b.account_name, account_type: b.account_type });
  }
  for (const a of pick(DEPOSIT_TYPES)) if (!deposit.has(a.account_id)) deposit.set(a.account_id, a);

  return {
    depositAccounts: [...deposit.values()].sort((a, b) => a.account_name.localeCompare(b.account_name)),
    feeAccounts: pick(FEE_TYPES),
    differenceAccounts: pick(DIFFERENCE_TYPES),
    taxes: ((taxJson.taxes ?? []) as PostingTaxOption[]).map(({ tax_id, tax_name, tax_percentage }) => ({
      tax_id, tax_name, tax_percentage: Number(tax_percentage),
    })),
    inputVatAccountId: active.find((a) => /^input\s*vat$/i.test(a.account_name.trim()))?.account_id ?? null,
  };
}

// ── refunds: credit note + refund from the clearing account ─────────────────

export type InvoiceTaxProfile = {
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  status: string;
  total: number;
  balance: number;
  is_inclusive_tax: boolean;
  tax_treatment?: string;
  place_of_supply?: string;
  line_items: { tax_id?: string; account_id?: string; tax_percentage?: number }[];
};

export async function getInvoiceTaxProfile(invoiceId: string, accessToken: string): Promise<InvoiceTaxProfile> {
  const json = await books("GET", `/invoices/${invoiceId}`, accessToken);
  const inv = json.invoice as InvoiceTaxProfile | undefined;
  if (!inv) throw new ZohoRejection(`Zoho returned no invoice for ${invoiceId}`);
  return inv;
}

export type CreditNoteRow = {
  creditnote_id: string;
  creditnote_number: string;
  reference_number?: string;
  status: string;
  total: number;
  balance: number;
  date?: string;
};

export async function listCustomerCreditNotes(customerId: string, accessToken: string): Promise<CreditNoteRow[]> {
  const json = await books("GET", "/creditnotes", accessToken, { query: { customer_id: customerId, per_page: "200" } });
  return ((json.creditnotes ?? []) as CreditNoteRow[]).map((c) => ({ ...c, total: Number(c.total), balance: Number(c.balance) }));
}

export async function createCreditNote(body: unknown, accessToken: string): Promise<{ id: string; number: string }> {
  const json = await books("POST", "/creditnotes", accessToken, { body });
  const cn = json.creditnote as { creditnote_id?: string; creditnote_number?: string } | undefined;
  if (!cn?.creditnote_id) throw new Error("Zoho created the credit note but returned no creditnote_id");
  return { id: cn.creditnote_id, number: cn.creditnote_number ?? "" };
}

export async function findCreditNoteRefund(creditnoteId: string, reference: string, accessToken: string): Promise<string | null> {
  const json = await books("GET", `/creditnotes/${creditnoteId}/refunds`, accessToken);
  const rows = (json.creditnote_refunds ?? []) as { creditnote_refund_id: string; reference_number?: string }[];
  return rows.find((r) => String(r.reference_number ?? "").trim() === reference)?.creditnote_refund_id ?? null;
}

export type LiveCreditNote = {
  id: string; number: string; date: string; status: string; total: number; balance: number;
  refunds: { id: string; date: string; amount: number; mode: string; reference: string; description: string }[];
};

/** A credit note as Zoho holds it right now, with every refund against it.
 *  Two reads. Our own table can be stale — a refund can be deleted in Zoho
 *  after we recorded its id (803120: stored refund gone, credit note fully open). */
export async function getCreditNoteLive(creditnoteId: string, accessToken: string): Promise<LiveCreditNote> {
  const [cnJson, rfJson] = await Promise.all([
    books("GET", `/creditnotes/${encodeURIComponent(creditnoteId)}`, accessToken),
    books("GET", `/creditnotes/${encodeURIComponent(creditnoteId)}/refunds`, accessToken),
  ]);
  const cn = cnJson.creditnote as { creditnote_id: string; creditnote_number: string; date: string; status: string; total: number; balance: number };
  const refunds = ((rfJson.creditnote_refunds ?? []) as {
    creditnote_refund_id: string; date: string; amount_bcy?: number; amount?: number; refund_mode?: string; reference_number?: string; description?: string;
  }[]).map((r) => ({
    id: r.creditnote_refund_id, date: r.date, amount: Number(r.amount_bcy ?? r.amount ?? 0),
    mode: r.refund_mode ?? "", reference: r.reference_number ?? "", description: r.description ?? "",
  }));
  return {
    id: cn.creditnote_id, number: cn.creditnote_number, date: cn.date, status: String(cn.status ?? ""),
    total: Number(cn.total ?? 0), balance: Number(cn.balance ?? 0), refunds,
  };
}

export type JournalLine = { account_id: string; account_name?: string; debit_or_credit: "debit" | "credit"; amount: number; description?: string };

export async function getJournal(journalId: string, accessToken: string): Promise<{ id: string; date: string; reference: string; notes: string; lines: JournalLine[] }> {
  const json = await books("GET", `/journals/${encodeURIComponent(journalId)}`, accessToken);
  const j = json.journal as { journal_id: string; journal_date: string; reference_number?: string; notes?: string; line_items?: JournalLine[] };
  return {
    id: j.journal_id, date: j.journal_date, reference: j.reference_number ?? "", notes: j.notes ?? "",
    lines: (j.line_items ?? []).map((l) => ({ account_id: l.account_id, account_name: l.account_name, debit_or_credit: l.debit_or_credit, amount: Number(l.amount), description: l.description })),
  };
}

export async function deleteCreditNoteRefund(creditnoteId: string, refundId: string, accessToken: string): Promise<void> {
  await books("DELETE", `/creditnotes/${encodeURIComponent(creditnoteId)}/refunds/${encodeURIComponent(refundId)}`, accessToken);
}

export async function createCreditNoteRefund(creditnoteId: string, body: unknown, accessToken: string): Promise<string> {
  const json = await books("POST", `/creditnotes/${creditnoteId}/refunds`, accessToken, { body });
  const id = (json.creditnote_refund as { creditnote_refund_id?: string } | undefined)?.creditnote_refund_id;
  if (!id) throw new Error("Zoho recorded the refund but returned no creditnote_refund_id");
  return id;
}
