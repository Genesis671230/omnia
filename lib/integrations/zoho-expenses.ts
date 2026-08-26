// Zoho Books Expense create — separate from the Bank Transaction API used elsewhere
// because Bank Transactions don't accept tax fields.

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
  
    const res = await fetch(url.toString(), {
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