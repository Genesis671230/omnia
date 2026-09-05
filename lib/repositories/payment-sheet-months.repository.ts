import { supabase } from "@/lib/supabase";

export type PaymentSheetMonth = {
  monthKey: string;
  spreadsheetId: string;
  label: string;
  createdAt: string;
};

// Factory so the shape (list/upsert/remove against payment_sheet_months) is
// testable against a fake client without a live database — same pattern as
// makeDeletePayout in payouts.repository.ts.
export function makePaymentSheetMonthsRepository(client: typeof supabase) {
  return {
    async list(): Promise<PaymentSheetMonth[]> {
      const { data, error } = await client
        .from("payment_sheet_months")
        .select("month_key, spreadsheet_id, label, created_at")
        .order("month_key", { ascending: true });
      if (error) throw new Error(`payment_sheet_months select failed: ${error.message}`);
      return (data ?? []).map((r: any) => ({
        monthKey: r.month_key, spreadsheetId: r.spreadsheet_id, label: r.label, createdAt: r.created_at,
      }));
    },

    async upsert(monthKey: string, spreadsheetId: string, label: string): Promise<void> {
      const { error } = await client
        .from("payment_sheet_months")
        .upsert({ month_key: monthKey, spreadsheet_id: spreadsheetId, label }, { onConflict: "month_key" });
      if (error) throw new Error(`payment_sheet_months upsert failed: ${error.message}`);
    },

    async remove(monthKey: string): Promise<void> {
      const { error } = await client.from("payment_sheet_months").delete().eq("month_key", monthKey);
      if (error) throw new Error(`payment_sheet_months delete failed: ${error.message}`);
    },
  };
}

export const PaymentSheetMonthsRepository = makePaymentSheetMonthsRepository(supabase);
