import { supabase } from "@/lib/supabase";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type ZohoSourceResult = { source: string; fetched: number; saved: number; error?: string };

export type ZohoSyncRun = {
  id: string;
  trigger: "scheduler" | "manual";
  started_at: string;
  finished_at: string | null;
  source_results: ZohoSourceResult[];
  error: string | null;
};

export const ZohoSyncRunsRepository = {
  async record(args: {
    trigger: "scheduler" | "manual";
    sourceResults: ZohoSourceResult[];
    error?: string;
  }): Promise<void> {
    const { error } = await supabase.from("zoho_sync_runs").insert({
      tenant_id: TENANT,
      trigger: args.trigger,
      finished_at: new Date().toISOString(),
      source_results: args.sourceResults,
      error: args.error ?? null,
    });
    if (error) throw new Error(`zoho_sync_runs insert failed: ${error.message}`);
  },

  async getLatest(): Promise<ZohoSyncRun | null> {
    const { data, error } = await supabase
      .from("zoho_sync_runs")
      .select("id, trigger, started_at, finished_at, source_results, error")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`zoho_sync_runs select failed: ${error.message}`);
    return data as ZohoSyncRun | null;
  },
};
