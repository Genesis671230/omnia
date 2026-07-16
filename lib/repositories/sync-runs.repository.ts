import { supabase } from "@/lib/supabase";
import type { GatewaySyncResult } from "@/lib/payout-sync";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type ReconSummary = {
  total: number;
  settled: number;
  awaitingPayout: number;
  payoutVariance: number;
  ordersUnresolved: number;
};

export type SyncRun = {
  id: string;
  trigger: "scheduler" | "manual";
  started_at: string;
  finished_at: string | null;
  gateway_results: GatewaySyncResult[];
  recon_summary: ReconSummary | null;
  error: string | null;
};

export const SyncRunsRepository = {
  async record(args: {
    trigger: "scheduler" | "manual";
    gatewayResults: GatewaySyncResult[];
    reconSummary?: ReconSummary;
    error?: string;
  }): Promise<void> {
    const { error } = await supabase.from("sync_runs").insert({
      tenant_id: TENANT,
      trigger: args.trigger,
      finished_at: new Date().toISOString(),
      gateway_results: args.gatewayResults,
      recon_summary: args.reconSummary ?? null,
      error: args.error ?? null,
    });
    if (error) throw new Error(`sync_runs insert failed: ${error.message}`);
  },

  async getLatest(): Promise<SyncRun | null> {
    const { data, error } = await supabase
      .from("sync_runs")
      .select("id, trigger, started_at, finished_at, gateway_results, recon_summary, error")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`sync_runs select failed: ${error.message}`);
    return data as SyncRun | null;
  },
};
