// Zoho Books Expense create — separate from the Bank Transaction API used elsewhere
// because Bank Transactions don't accept tax fields.

import { zohoThrottledFetch } from "@/lib/integrations/zoho-throttle";
import type { ZohoPosting } from "@/lib/integrations/zoho-banking";

export type ZohoBooksExpense = {
    account_id: string;              // expense category id (e.g. Bank Fees and Charges)
    paid_through_account_id: string; // the bank account id
    amount: number;
    date: string;                    // YYYY-MM-DD
    description?: string;
    reference_number?: string;
    is_inclusive_tax?: boolean;
    tax_id?: string;
    tax_treatment?: string;          // "vat_registered"
    place_of_supply?: string;   
    is_reverse_charge_applied?: boolean;  // NEW — matches the "Reverse Charge" checkbox
    // "DU" for Dubai in UAE Books
  };
  
  const BOOKS_BASE = process.env.ZOHO_BOOKS_BASE ?? "https://www.zohoapis.com/books/v3";
  
  export async function createBooksExpense(
    expense: ZohoBooksExpense,
    accessToken: string,
    organizationId: string = process.env.ZOHO_ORGANIZATION_ID ?? "",
  ): Promise<{ expense_id: string }> {
    if (!organizationId) throw new Error("ZOHO_ORGANIZATION_ID not configured");
  
    const url = new URL(`${BOOKS_BASE}/expenses`);
    url.searchParams.set("organization_id", organizationId);
  
    const res = await zohoThrottledFetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
      body: JSON.stringify(expense),
    });
  
    const json = await res.json().catch((e) => ({
      error:console.log(e,"error of expense")
    }));
    console.log(json,"result of expense")
    if (!res.ok || json.code !== 0) {
      throw new Error(json.message || `Zoho Books expense create failed (HTTP ${res.status})`);
    }
    return { expense_id: json.expense.expense_id };
  }

/**
 * Zoho's /banktransactions rejects transaction_type "expense" ("Invalid value
 * passed for Transaction Type") — expenses have their own API. So an expense
 * draft becomes a Books Expense: category = to-account, paid through = the
 * bank (from-account). Paid from the bank, it still shows in the bank's
 * transaction list, so the posting routes' reference lookup and Refresh both see it.
 *
 * No VAT is charged on a plain statement debit (salary, transfers to people).
 * UAE orgs sometimes insist on a tax treatment even then — retry once as
 * "not VAT registered, Dubai", which carries no tax.
 */
export async function postPlainBankExpense(posting: ZohoPosting, accessToken: string): Promise<string> {
  const base = {
    account_id: posting.to_account_id,
    paid_through_account_id: posting.from_account_id,
    amount: posting.amount,
    date: posting.date,
    description: posting.description.slice(0, 500),
    reference_number: posting.referenceNumber.slice(0, 100),
  };
  try {
    return (await createBooksExpense(base, accessToken)).expense_id;
  } catch (e) {
    if (!/tax|place of supply/i.test((e as Error).message)) throw e;
    return (await createBooksExpense({ ...base, tax_treatment: "vat_not_registered", place_of_supply: "DU" }, accessToken)).expense_id;
  }
}
