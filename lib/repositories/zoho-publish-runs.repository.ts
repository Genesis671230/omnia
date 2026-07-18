import { supabase } from "@/lib/supabase";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type ZohoPublishResult = {
  settlementId: string;
  ok: boolean;
  error?: string;
  paymentId?: string;
  needsManualReview?: boolean;
};

// Audit trail for POST /api/settlements/publish, same shape as
// sync_runs/zoho_sync_runs/ad_sync_runs — one row per batch call, since this
// route writes real money into Zoho Books and every write needs a record
// independent of whatever settlement_records looks like later.
export const ZohoPublishRunsRepository = {
  async start(): Promise<string> {
    const { data, error } = await supabase
      .from("zoho_publish_runs")
      .insert({ tenant_id: TENANT, trigger: "manual" })
      .select("id")
      .single();
    if (error) throw new Error(`zoho_publish_runs insert failed: ${error.message}`);
    return data.id as string;
  },

  async finish(id: string, results: ZohoPublishResult[], batchError?: string): Promise<void> {
    const { error } = await supabase
      .from("zoho_publish_runs")
      .update({ finished_at: new Date().toISOString(), results, error: batchError ?? null })
      .eq("id", id);
    if (error) throw new Error(`zoho_publish_runs update failed: ${error.message}`);
  },
};
