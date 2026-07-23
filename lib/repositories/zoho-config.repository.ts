import { supabase } from "@/lib/supabase";
import type { ZohoAccountMap } from "@/lib/integrations/zoho-banking";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type ZohoPostingRow = {
  bank_line_id: string;
  gateway: string;
  payout_id: string | null;
  reference_number: string;
  net_aed: number;
  gross_aed: number;
  fee_aed: number;
  status: string;
  zoho_result: unknown;
  error: string;
  posted_by: string;
  posted_at: string;
};

/** The chart-of-accounts mapping, and the local record of what has been
 *  written to Zoho Books. Kept in one module because the posting endpoint
 *  needs both on every call. */
export const ZohoConfigRepository = {
  /** DB mapping, or null when nothing has been saved yet. */
  async getAccountMap(): Promise<ZohoAccountMap | null> {
    const { data, error } = await supabase
      .from("zoho_account_config")
      .select("bank_account_id, fee_account_id, clearing_by_gateway, default_income_account_id, expense_account_by_kind")
      .eq("id", TENANT)
      .maybeSingle();
    if (error || !data) return null;
    return {
      bankAccountId: data.bank_account_id ?? "",
      feeAccountId: data.fee_account_id ?? "",
      clearingByGateway: (data.clearing_by_gateway ?? {}) as Record<string, string>,
      defaultIncomeAccountId: data.default_income_account_id ?? "",
      expenseAccountByKind: (data.expense_account_by_kind ?? {}) as Record<string, string>,
    };
  },

  async saveAccountMap(map: ZohoAccountMap, updatedBy: string) {
    const { error } = await supabase.from("zoho_account_config").upsert(
      {
        id: TENANT,
        tenant_id: TENANT,
        bank_account_id: map.bankAccountId,
        fee_account_id: map.feeAccountId,
        clearing_by_gateway: map.clearingByGateway,
        default_income_account_id: map.defaultIncomeAccountId ?? "",
        expense_account_by_kind: map.expenseAccountByKind ?? {},
        updated_at: new Date().toISOString(),
        updated_by: updatedBy,
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(`zoho_account_config save failed: ${error.message}`);
  },

  async getPosting(bankLineId: string): Promise<ZohoPostingRow | null> {
    const { data, error } = await supabase
      .from("zoho_postings")
      .select("*")
      .eq("bank_line_id", bankLineId)
      .maybeSingle();
    if (error || !data) return null;
    return data as ZohoPostingRow;
  },

  /** Every credit already recorded in Zoho, so the reconciliation view can
   *  render "Posted ✓" for all rows from one query instead of one call per
   *  row (or a Zoho round trip per row). */
  async listPostings(): Promise<ZohoPostingRow[]> {
    const { data, error } = await supabase
      .from("zoho_postings")
      .select("*")
      .order("posted_at", { ascending: false });
    if (error) return [];
    return (data ?? []) as ZohoPostingRow[];
  },

  async recordPosting(row: Omit<ZohoPostingRow, "posted_at">) {
    const { error } = await supabase.from("zoho_postings").upsert(
      { ...row, tenant_id: TENANT, posted_at: new Date().toISOString() },
      { onConflict: "bank_line_id" },
    );
    if (error) throw new Error(`zoho_postings write failed: ${error.message}`);
  },
};
