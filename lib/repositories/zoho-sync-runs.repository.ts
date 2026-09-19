import { supabase } from "@/lib/supabase";

const TENANT = process.env.DEFAULT_TENANT_ID || "omnia";

export type ZohoSourceResult = { source: string; fetched: number; saved: number; error?: string };

export type ZohoSyncMode = "incremental" | "full";

export type ZohoSyncRun = {
  id: string;
  trigger: "scheduler" | "manual";
  started_at: string;
  finished_at: string | null;
  source_results: ZohoSourceResult[];
  error: string | null;
  sync_mode?: ZohoSyncMode;
  watermark?: string | null;
};

/** How stale a full pass may get before the next cycle is forced to be one. */
const FULL_SYNC_MAX_AGE_HOURS = Number(process.env.ZOHO_FULL_SYNC_MAX_AGE_HOURS || 20);

/** Rows modified while a run was in flight would otherwise fall in the gap
 *  between that run's watermark and the next one's filter. Rewinding a few
 *  minutes costs a page and closes it. */
const WATERMARK_OVERLAP_MINUTES = Number(process.env.ZOHO_WATERMARK_OVERLAP_MINUTES || 10);

export const ZohoSyncRunsRepository = {
  async record(args: {
    trigger: "scheduler" | "manual";
    sourceResults: ZohoSourceResult[];
    error?: string;
    mode?: ZohoSyncMode;
    watermark?: string | null;
  }): Promise<void> {
    const { error } = await supabase.from("zoho_sync_runs").insert({
      tenant_id: TENANT,
      trigger: args.trigger,
      finished_at: new Date().toISOString(),
      source_results: args.sourceResults,
      error: args.error ?? null,
      sync_mode: args.mode ?? "full",
      watermark: args.watermark ?? null,
    });
    if (error) throw new Error(`zoho_sync_runs insert failed: ${error.message}`);
  },

  /**
   * What the next cycle should ask Zoho for.
   *
   * Incremental whenever a clean run has left a watermark and the last full
   * pass is still fresh. Full when there is no watermark to work from (first
   * run, or every previous run errored) or the last full pass has aged out —
   * a modified-since query cannot report a deleted or voided row, so without
   * the periodic full pass the mirror would silently keep rows Zoho no longer
   * has.
   */
  async nextSyncWindow(): Promise<{ mode: ZohoSyncMode; sinceIso: string | null; reason: string }> {
    const since = async (): Promise<string | null> => {
      const { data } = await supabase
        .from("zoho_sync_runs")
        .select("watermark")
        .is("error", null)
        .not("watermark", "is", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as { watermark?: string } | null)?.watermark ?? null;
    };

    const { data: lastFull } = await supabase
      .from("zoho_sync_runs")
      .select("started_at")
      .eq("sync_mode", "full")
      .is("error", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const fullAt = (lastFull as { started_at?: string } | null)?.started_at;
    if (!fullAt) return { mode: "full", sinceIso: null, reason: "no successful full sync on record" };

    const ageHours = (Date.now() - new Date(fullAt).getTime()) / 3_600_000;
    if (ageHours >= FULL_SYNC_MAX_AGE_HOURS) {
      return { mode: "full", sinceIso: null, reason: `last full sync was ${ageHours.toFixed(1)}h ago` };
    }

    const watermark = await since();
    if (!watermark) return { mode: "full", sinceIso: null, reason: "no watermark to resume from" };

    const rewound = new Date(new Date(watermark).getTime() - WATERMARK_OVERLAP_MINUTES * 60_000);
    return { mode: "incremental", sinceIso: rewound.toISOString(), reason: `changes since ${rewound.toISOString()}` };
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
