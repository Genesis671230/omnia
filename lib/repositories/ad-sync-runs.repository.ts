import { supabase } from "@/lib/supabase";
import type { AdPlatformSyncResult } from "@/lib/ad-sync";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type AdSyncRun = {
  id: string;
  trigger: "scheduler" | "manual";
  started_at: string;
  finished_at: string | null;
  platform_results: AdPlatformSyncResult[];
  error: string | null;
};

export const AdSyncRunsRepository = {
  async record(args: {
    trigger: "scheduler" | "manual";
    platformResults: AdPlatformSyncResult[];
    error?: string;
  }): Promise<void> {
    const { error } = await supabase.from("ad_sync_runs").insert({
      tenant_id: TENANT,
      trigger: args.trigger,
      finished_at: new Date().toISOString(),
      platform_results: args.platformResults,
      error: args.error ?? null,
    });
    if (error) throw new Error(`ad_sync_runs insert failed: ${error.message}`);
  },

  async getLatest(): Promise<AdSyncRun | null> {
    const { data, error } = await supabase
      .from("ad_sync_runs")
      .select("id, trigger, started_at, finished_at, platform_results, error")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`ad_sync_runs select failed: ${error.message}`);
    return data as AdSyncRun | null;
  },
};
