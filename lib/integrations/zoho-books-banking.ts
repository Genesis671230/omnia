// Zoho Books banking — read-only sync against the org's own bank transaction
// ledger. Confirms what /api/integrations/zoho/post-bank-lines already wrote
// is actually still there (an accountant may have voided/edited it in Zoho
// directly), and catches drift our own "posted" status can't see on its own.

import { getAccessToken } from "@/lib/integrations/zoho"; // adjust path if getAccessToken/zohoConfigured actually live elsewhere

const BOOKS_API_BASE = "https://www.zohoapis.com/books/v3";

export type ZohoBankTransaction = {
  transaction_id: string;
  date: string;
  amount: number;
  transaction_type: string;
  status: string; // categorized | uncategorized | matched | excluded | manually_added
  account_id: string;
  reference_number: string;
  description: string;
};

export async function listZohoBankTransactions(
  params: { accountId?: string; dateStart?: string; dateEnd?: string },
  accessToken: string,
): Promise<ZohoBankTransaction[]> {
  const orgId = process.env.ZOHO_ORGANIZATION_ID!;
  const out: ZohoBankTransaction[] = [];
  let page = 1;

  for (;;) {
    const qs = new URLSearchParams({ organization_id: orgId, per_page: "200", page: String(page) });
    if (params.accountId) qs.set("account_id", params.accountId);
    if (params.dateStart) qs.set("date_start", params.dateStart);
    if (params.dateEnd) qs.set("date_end", params.dateEnd);

    const res = await fetch(`${BOOKS_API_BASE}/banktransactions?${qs.toString()}`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Zoho Books banktransactions HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    if (json.code !== 0) throw new Error(`Zoho Books banktransactions error ${json.code}: ${json.message}`);

    out.push(...(json.banktransactions ?? []));
    if (!json.page_context?.has_more_page) break;
    page += 1;
  }
  return out;
}