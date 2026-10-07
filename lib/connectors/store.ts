import { supabase } from "@/lib/supabase";

/* Raw access to the `connections` table. Secrets stay encrypted here; the
 * runtime decrypts and validates. Swappable so tests run offline. */

export type ConnectionRow = {
  id: string; tenant_id: string; provider: string; auth_mode: string; grant_type: string;
  account_ref: string; label: string; config: Record<string, unknown>; secrets_enc: string; scopes: string;
  status: string; last_checked_at: string | null; last_synced_at: string | null; last_error: string;
  connected_by: string; created_at: string; updated_at: string;
};

export interface ConnectionStore {
  list(tenantId: string, provider?: string): Promise<ConnectionRow[]>;
  get(tenantId: string, id: string): Promise<ConnectionRow | null>;
  findByAccount(tenantId: string, provider: string, accountRef: string): Promise<ConnectionRow | null>;
  insert(row: ConnectionRow): Promise<void>;
  update(tenantId: string, id: string, patch: Partial<ConnectionRow>): Promise<void>;
  remove(tenantId: string, id: string): Promise<void>;
}

export const supabaseConnectionStore: ConnectionStore = {
  async list(tenantId, provider) {
    let q = supabase.from("connections").select("*").eq("tenant_id", tenantId).order("created_at");
    if (provider) q = q.eq("provider", provider);
    const { data, error } = await q;
    if (error) throw new Error(`connections read failed: ${error.message}`);
    return (data ?? []) as ConnectionRow[];
  },
  async get(tenantId, id) {
    const { data, error } = await supabase.from("connections").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
    if (error) throw new Error(`connections read failed: ${error.message}`);
    return (data as ConnectionRow) ?? null;
  },
  async findByAccount(tenantId, provider, accountRef) {
    const { data, error } = await supabase.from("connections").select("*")
      .eq("tenant_id", tenantId).eq("provider", provider).eq("account_ref", accountRef).maybeSingle();
    if (error) throw new Error(`connections read failed: ${error.message}`);
    return (data as ConnectionRow) ?? null;
  },
  async insert(row) {
    const { error } = await supabase.from("connections").insert(row);
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) throw new Error(`${row.provider} account ${row.account_ref} is already connected`);
      throw new Error(`connections insert failed: ${error.message}`);
    }
  },
  async update(tenantId, id, patch) {
    const { error } = await supabase.from("connections").update({ ...patch, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", id);
    if (error) throw new Error(`connections update failed: ${error.message}`);
  },
  async remove(tenantId, id) {
    const { error } = await supabase.from("connections").delete().eq("tenant_id", tenantId).eq("id", id);
    if (error) throw new Error(`connections delete failed: ${error.message}`);
  },
};

export function memoryConnectionStore(): ConnectionStore {
  const rows = new Map<string, ConnectionRow>();
  const k = (t: string, id: string) => `${t}/${id}`;
  const copy = (r: ConnectionRow): ConnectionRow => ({ ...r, config: { ...r.config } });
  return {
    async list(t, p) { return [...rows.values()].filter((r) => r.tenant_id === t && (!p || r.provider === p)).map(copy); },
    async get(t, id) { const r = rows.get(k(t, id)); return r ? copy(r) : null; },
    async findByAccount(t, p, a) {
      const r = [...rows.values()].find((x) => x.tenant_id === t && x.provider === p && x.account_ref === a);
      return r ? copy(r) : null;
    },
    async insert(row) {
      const dup = rows.has(k(row.tenant_id, row.id)) ||
        [...rows.values()].some((x) => x.tenant_id === row.tenant_id && x.provider === row.provider && x.account_ref === row.account_ref);
      if (dup) throw new Error(`${row.provider} account ${row.account_ref} is already connected`);
      rows.set(k(row.tenant_id, row.id), copy(row));
    },
    async update(t, id, patch) {
      const r = rows.get(k(t, id));
      if (r) rows.set(k(t, id), { ...r, ...patch, updated_at: new Date().toISOString() });
    },
    async remove(t, id) { rows.delete(k(t, id)); },
  };
}
