import { supabase } from "@/lib/supabase";
import type { StoreSyncResult } from "@/lib/sync/order-sync.service";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type OrderSyncRun = {
  id: string;
  trigger: "scheduler" | "manual";
  started_at: string;
  finished_at: string | null;
  store_results: StoreSyncResult[];
  error: string | null;
};

export const OrderSyncRunsRepository = {
  async record(args: { trigger: "scheduler" | "manual"; storeResults: StoreSyncResult[]; error?: string }): Promise<void> {
    const { error } = await supabase.from("order_sync_runs").insert({
      tenant_id: TENANT,
      trigger: args.trigger,
      finished_at: new Date().toISOString(),
      store_results: args.storeResults,
      error: args.error ?? null,
    });
    if (error) throw new Error(`order_sync_runs insert failed: ${error.message}`);
  },

  async getLatest(): Promise<OrderSyncRun | null> {
    const { data, error } = await supabase
      .from("order_sync_runs")
      .select("id, trigger, started_at, finished_at, store_results, error")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`order_sync_runs select failed: ${error.message}`);
    return data as OrderSyncRun | null;
  },
};
