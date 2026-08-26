import { supabase } from "@/lib/supabase";  // your existing client — adjust import if different

export type PayeeRow = {
  normalized_name: string;
  display_name: string;
  equity_account_id: string;
};

export const PayeeRepository = {
  async list(): Promise<PayeeRow[]> {
    const { data, error } = await supabase
      .from("profit_share_payees")
      .select("normalized_name, display_name, equity_account_id")
      .order("display_name");
    if (error) throw new Error(error.message);
    return data ?? [];
  },
  async upsert(row: PayeeRow): Promise<void> {
    const { error } = await supabase
      .from("profit_share_payees")
      .upsert({ ...row, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
  },
  async remove(normalized_name: string): Promise<void> {
    const { error } = await supabase
      .from("profit_share_payees")
      .delete()
      .eq("normalized_name", normalized_name);
    if (error) throw new Error(error.message);
  },
};