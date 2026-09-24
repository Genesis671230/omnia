import { supabase } from "@/lib/supabase";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type ZohoBankTxnPostingRow = {
  bank_line_id: string;
  direction: "credit" | "debit";
  transaction_type: string;
  category_account_id: string;
  reference_number: string;
  amount: number;
  zoho_transaction_id: string | null;
  zoho_status: string; // Zoho's own status: categorized | uncategorized | matched | excluded
  status: "posted" | "verified" | "missing_in_zoho" | "failed";
  error: string;
  posted_by: string;
  posted_at: string;
  verified_at: string;
};

export const ZohoBankTxnRepository = {
  async getPosting(bankLineId: string): Promise<ZohoBankTxnPostingRow | null> {
    const { data, error } = await supabase
      .from("zoho_bank_txn_postings")
      .select("*")
      .eq("bank_line_id", bankLineId)
      .maybeSingle();
    if (error || !data) return null;
    return data as ZohoBankTxnPostingRow;
  },

  async listPostings(range?: { from?: string; to?: string }): Promise<ZohoBankTxnPostingRow[]> {
    let lineIds: string[] | null = null;
  
    if (range?.from || range?.to) {
      let lineQuery = supabase.from("bank_lines").select("id");
      if (range.from) lineQuery = lineQuery.gte("date", range.from);
      if (range.to) lineQuery = lineQuery.lte("date", range.to);
      const { data: lineRows, error: lineErr } = await lineQuery;
      if (lineErr) throw new Error(`listPostings (bank_lines lookup) failed: ${lineErr.message}`);
      lineIds = (lineRows ?? []).map((r) => r.id);
      if (lineIds.length === 0) return []; // nothing in range, skip the second query
    }
  
    let query = supabase.from("zoho_bank_txn_postings").select("*");
    if (lineIds) query = query.in("bank_line_id", lineIds);
  
    const { data, error } = await query;
    if (error) throw new Error(`listPostings failed: ${error.message}`);
    return (data as ZohoBankTxnPostingRow[]) ?? [];
  },
  
  async listPostingsFor(bankLineIds: string[]): Promise<ZohoBankTxnPostingRow[]> {
    const out: ZohoBankTxnPostingRow[] = [];
    for (let i = 0; i < bankLineIds.length; i += 200) {
      const { data, error } = await supabase
        .from("zoho_bank_txn_postings")
        .select("*")
        .in("bank_line_id", bankLineIds.slice(i, i + 200));
      if (error) throw new Error(`listPostingsFor failed: ${error.message}`);
      out.push(...((data as ZohoBankTxnPostingRow[]) ?? []));
    }
    return out;
  },

  async recordPosting(row: Omit<ZohoBankTxnPostingRow, "posted_at"> & { posted_at?: string }) {
    const { error } = await supabase.from("zoho_bank_txn_postings").upsert(
      { ...row, tenant_id: TENANT, posted_at: row.posted_at ?? new Date().toISOString() },
      { onConflict: "bank_line_id" },
    );
    if (error) throw new Error(`zoho_bank_txn_postings write failed: ${error.message}`);
  },

  async markVerified(bankLineId: string, patch: { zoho_transaction_id: string; zoho_status: string }) {
    const { error } = await supabase.from("zoho_bank_txn_postings").update({
      status: "verified",
      zoho_transaction_id: patch.zoho_transaction_id,
      zoho_status: patch.zoho_status,
      verified_at: new Date().toISOString(),
    }).eq("bank_line_id", bankLineId);
    if (error) throw new Error(`zoho_bank_txn_postings verify failed: ${error.message}`);
  },

  async markMissingInZoho(bankLineId: string) {
    const { error } = await supabase.from("zoho_bank_txn_postings").update({
      status: "missing_in_zoho",
      verified_at: new Date().toISOString(),
    }).eq("bank_line_id", bankLineId);
    if (error) throw new Error(`zoho_bank_txn_postings mark-missing failed: ${error.message}`);
  },
};

export type BankLineZohoStatusRow = {
  bank_line_id: string;
  state: "in_zoho" | "uncategorized" | "amount_differs" | "not_found";
  match_kind: string | null;
  zoho_transaction_ids: string[];
  zoho_reference: string | null;
  zoho_amount: number | null;
  zoho_type: string | null;
  zoho_account: string | null;
  zoho_status: string | null;
  zoho_date: string | null;
  checked_at: string;
};

/** The ledger status written by the Refresh button — a DB read, never Zoho. */
export const BankLineZohoStatusRepository = {
  async list(bankLineIds: string[]): Promise<BankLineZohoStatusRow[]> {
    const out: BankLineZohoStatusRow[] = [];
    for (let i = 0; i < bankLineIds.length; i += 200) {
      const { data, error } = await supabase
        .from("bank_line_zoho_status")
        .select("*")
        .in("bank_line_id", bankLineIds.slice(i, i + 200));
      if (error) throw new Error(`bank_line_zoho_status read failed: ${error.message}`);
      out.push(...((data as BankLineZohoStatusRow[]) ?? []));
    }
    return out;
  },

  /** The subset of ids the last Refresh found booked in Zoho — the
   *  double-entry guard every posting route runs before writing. */
  async inZohoIds(bankLineIds: string[]): Promise<Set<string>> {
    const rows = await this.list(bankLineIds.filter(Boolean));
    return new Set(rows.filter((r) => r.state === "in_zoho").map((r) => r.bank_line_id));
  },

  async upsert(rows: Omit<BankLineZohoStatusRow, "checked_at">[], checkedAt: string) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase
        .from("bank_line_zoho_status")
        .upsert(rows.slice(i, i + 500).map((r) => ({ ...r, tenant_id: TENANT, checked_at: checkedAt })), { onConflict: "bank_line_id" });
      if (error) throw new Error(`bank_line_zoho_status write failed: ${error.message}`);
    }
  },
};
