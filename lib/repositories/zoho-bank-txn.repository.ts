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
  status: "posted" | "failed";
  error: string;
  posted_by: string;
  posted_at: string;
};

/** Tracks what the bulk bank-transactions feature has posted to Zoho — kept
 *  separate from zoho_postings (the gateway-payout flow's table), which is
 *  shaped for net/gross/fee triples, not a single categorized transaction. */
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

  async listPostings(): Promise<ZohoBankTxnPostingRow[]> {
    const { data, error } = await supabase
      .from("zoho_bank_txn_postings")
      .select("*")
      .order("posted_at", { ascending: false });
    if (error) return [];
    return (data ?? []) as ZohoBankTxnPostingRow[];
  },

  async recordPosting(row: Omit<ZohoBankTxnPostingRow, "posted_at">) {
    const { error } = await supabase.from("zoho_bank_txn_postings").upsert(
      { ...row, tenant_id: TENANT, posted_at: new Date().toISOString() },
      { onConflict: "bank_line_id" },
    );
    if (error) throw new Error(`zoho_bank_txn_postings write failed: ${error.message}`);
  },
};
