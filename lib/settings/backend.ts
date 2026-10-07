import { supabase } from "@/lib/supabase";

/** Where workspace settings are stored. Swappable so tests stay offline. */
export interface SettingsBackend {
  all(tenantId: string): Promise<Record<string, unknown>>;
  set(tenantId: string, key: string, value: unknown, by: string): Promise<void>;
}

export const supabaseSettingsBackend: SettingsBackend = {
  async all(tenantId) {
    const { data, error } = await supabase.from("workspace_settings").select("key, value").eq("tenant_id", tenantId);
    if (error) throw new Error(`workspace_settings read failed: ${error.message}`);
    return Object.fromEntries((data ?? []).map((r) => [r.key as string, r.value]));
  },
  async set(tenantId, key, value, by) {
    const { error } = await supabase.from("workspace_settings").upsert(
      { tenant_id: tenantId, key, value, updated_by: by, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,key" },
    );
    if (error) throw new Error(`workspace_settings write failed: ${error.message}`);
  },
};

export function memorySettingsBackend(): SettingsBackend {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    async all(t) { return { ...(rows.get(t) ?? {}) }; },
    async set(t, k, v) { rows.set(t, { ...(rows.get(t) ?? {}), [k]: v }); },
  };
}
