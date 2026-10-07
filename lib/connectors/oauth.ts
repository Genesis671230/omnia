import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { supabase } from "@/lib/supabase";
import { decryptJson, encryptJson } from "@/lib/crypto/secret-box";
import { currentTenant } from "@/lib/tenant";
import { getSetting } from "@/lib/settings";
import { OAuthFlowError, type AuthMode, type DiscoveredAccount, type Grant, type OAuthApp } from "./types";

/* Everything that makes the connect flow safe to expose:
 *  - state: 32 random bytes, single use, 10-minute TTL, bound to the tenant,
 *    provider and the admin who started it. Consuming marks it used FIRST, so
 *    a rejected attempt can't be retried.
 *  - PKCE (S256) for providers that support it (Google).
 *  - own-app client secrets and pending grants are encrypted at rest.
 *  - Shopify callback HMAC and strict host allowlists (Shopify shop, Zoho DC). */

const STATE_TTL_MS = 10 * 60_000;
const PENDING_TTL_MS = 15 * 60_000;

export type StateRecord = {
  state: string; tenantId: string; provider: string; authMode: AuthMode; pkceVerifier: string;
  pendingApp: OAuthApp | null; params: Record<string, string>; createdBy: string;
};

export type StateRow = {
  state: string; tenant_id: string; provider: string; auth_mode: string; pkce_verifier: string; pending_app_enc: string;
  params: Record<string, string>; created_by: string; expires_at: string; used_at: string | null;
};
export type PendingRow = {
  id: string; tenant_id: string; provider: string; auth_mode: string; grant_enc: string;
  accounts: DiscoveredAccount[]; params: Record<string, string>; created_by: string; expires_at: string;
};

export interface OAuthStateStore {
  insert(r: StateRow): Promise<void>;
  /** Atomically mark used. Returns the row only when it was unused and unexpired. */
  consume(state: string): Promise<{ row: StateRow | null; reason?: "missing" | "expired" | "used" }>;
  savePending(p: PendingRow): Promise<void>;
  peekPending(id: string, tenantId: string): Promise<PendingRow | null>;
  takePending(id: string, tenantId: string): Promise<PendingRow | null>;
  /** Delete states and pending grants that expired before `beforeIso`. */
  purge(beforeIso: string): Promise<number>;
}

export const supabaseOAuthStateStore: OAuthStateStore = {
  async insert(r) {
    const { error } = await supabase.from("oauth_states").insert(r);
    if (error) throw new Error(`oauth_states insert failed: ${error.message}`);
  },
  async consume(state) {
    const now = new Date().toISOString();
    const { data, error } = await supabase.from("oauth_states").update({ used_at: now })
      .eq("state", state).is("used_at", null).gt("expires_at", now).select("*").maybeSingle();
    if (error) throw new Error(`oauth_states consume failed: ${error.message}`);
    if (data) return { row: data as StateRow };
    const { data: seen } = await supabase.from("oauth_states").select("used_at").eq("state", state).maybeSingle();
    if (!seen) return { row: null, reason: "missing" };
    return { row: null, reason: seen.used_at ? "used" : "expired" };
  },
  async savePending(p) {
    const { error } = await supabase.from("pending_grants").insert(p);
    if (error) throw new Error(`pending_grants insert failed: ${error.message}`);
  },
  async peekPending(id, tenantId) {
    const { data } = await supabase.from("pending_grants").select("*")
      .eq("id", id).eq("tenant_id", tenantId).gt("expires_at", new Date().toISOString()).maybeSingle();
    return (data as PendingRow) ?? null;
  },
  async takePending(id, tenantId) {
    const { data } = await supabase.from("pending_grants").delete()
      .eq("id", id).eq("tenant_id", tenantId).gt("expires_at", new Date().toISOString()).select("*").maybeSingle();
    return (data as PendingRow) ?? null;
  },
  async purge(beforeIso) {
    const a = await supabase.from("oauth_states").delete().lt("expires_at", beforeIso).select("state");
    const b = await supabase.from("pending_grants").delete().lt("expires_at", beforeIso).select("id");
    if (a.error || b.error) throw new Error(`oauth purge failed: ${(a.error ?? b.error)!.message}`);
    return (a.data?.length ?? 0) + (b.data?.length ?? 0);
  },
};

export function memoryOAuthStateStore(): OAuthStateStore & {
  _expire(state: string): void; _peek(state: string): StateRow | undefined; _peekPending(id: string): PendingRow | undefined;
} {
  const states = new Map<string, StateRow>();
  const pending = new Map<string, PendingRow>();
  const live = (iso: string) => new Date(iso).getTime() > Date.now();
  const peekPending = async (id: string, t: string) => {
    const p = pending.get(id);
    return p && p.tenant_id === t && live(p.expires_at) ? { ...p } : null;
  };
  return {
    async insert(r) { states.set(r.state, { ...r }); },
    async consume(state) {
      const r = states.get(state);
      if (!r) return { row: null, reason: "missing" };
      if (r.used_at) return { row: null, reason: "used" };
      if (!live(r.expires_at)) return { row: null, reason: "expired" };
      r.used_at = new Date().toISOString();
      return { row: { ...r } };
    },
    async savePending(p) { pending.set(p.id, { ...p }); },
    peekPending,
    async takePending(id, t) { const p = await peekPending(id, t); if (p) pending.delete(id); return p; },
    async purge(beforeIso) {
      let n = 0;
      for (const [k, r] of states) if (r.expires_at < beforeIso) { states.delete(k); n++; }
      for (const [k, r] of pending) if (r.expires_at < beforeIso) { pending.delete(k); n++; }
      return n;
    },
    _expire(state) { const r = states.get(state); if (r) r.expires_at = new Date(Date.now() - 1000).toISOString(); },
    _peek(state) { return states.get(state); },
    _peekPending(id) { return pending.get(id); },
  };
}

let stateStore: OAuthStateStore = supabaseOAuthStateStore;
export function setOAuthStateStore(s: OAuthStateStore) { stateStore = s; }

export async function createState(
  input: { provider: string; authMode: AuthMode; pendingApp: OAuthApp | null; params: Record<string, string>; createdBy: string },
  opts: { pkce?: boolean } = {},
): Promise<{ state: string; pkceChallenge?: string }> {
  const state = randomBytes(32).toString("base64url");
  const pkceVerifier = opts.pkce ? randomBytes(48).toString("base64url") : ""; // 64 chars, within RFC 7636's 43–128
  await stateStore.insert({
    state, tenant_id: currentTenant(), provider: input.provider, auth_mode: input.authMode, pkce_verifier: pkceVerifier,
    pending_app_enc: input.pendingApp ? encryptJson(input.pendingApp) : "", params: input.params, created_by: input.createdBy,
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(), used_at: null,
  });
  return { state, ...(pkceVerifier ? { pkceChallenge: createHash("sha256").update(pkceVerifier).digest("base64url") } : {}) };
}

export async function consumeState(state: string, provider: string, user: string): Promise<StateRecord> {
  if (!state) throw new OAuthFlowError("state_invalid", "Missing state");
  const { row, reason } = await stateStore.consume(state);
  if (!row) {
    if (reason === "used") throw new OAuthFlowError("state_used", "This connect link was already used — start again from Settings");
    if (reason === "expired") throw new OAuthFlowError("state_expired", "The connect link expired — start again from Settings");
    throw new OAuthFlowError("state_invalid", "Unknown connect request");
  }
  if (row.tenant_id !== currentTenant()) throw new OAuthFlowError("state_invalid", "Connect request belongs to another workspace");
  if (row.provider !== provider) throw new OAuthFlowError("provider_mismatch", "Connect request was for a different provider");
  if (row.created_by !== user) throw new OAuthFlowError("state_user_mismatch", "Finish the connection as the same user who started it");
  return {
    state: row.state, tenantId: row.tenant_id, provider: row.provider, authMode: row.auth_mode as AuthMode,
    pkceVerifier: row.pkce_verifier, pendingApp: row.pending_app_enc ? decryptJson<OAuthApp>(row.pending_app_enc) : null,
    params: row.params ?? {}, createdBy: row.created_by,
  };
}

export async function savePendingGrant(p: {
  provider: string; authMode: AuthMode; grant: Grant; app: OAuthApp; accounts: DiscoveredAccount[]; params: Record<string, string>; createdBy: string;
}): Promise<string> {
  const id = randomUUID();
  await stateStore.savePending({
    id, tenant_id: currentTenant(), provider: p.provider, auth_mode: p.authMode,
    grant_enc: encryptJson({ grant: p.grant, app: p.app }), accounts: p.accounts, params: p.params,
    created_by: p.createdBy, expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
  });
  return id;
}

/** Account list for the picker — no secrets. */
export async function peekPendingAccounts(id: string): Promise<{ provider: string; accounts: DiscoveredAccount[] } | null> {
  const p = await stateStore.peekPending(id, currentTenant());
  return p ? { provider: p.provider, accounts: p.accounts } : null;
}

export async function takePendingGrant(id: string, user: string) {
  const peek = await stateStore.peekPending(id, currentTenant());
  if (!peek) throw new OAuthFlowError("state_invalid", "This account picker expired — connect again");
  if (peek.created_by !== user) throw new OAuthFlowError("state_user_mismatch", "Finish the connection as the same user who started it");
  const p = await stateStore.takePending(id, currentTenant());
  if (!p) throw new OAuthFlowError("state_invalid", "This account picker expired — connect again");
  const { grant, app } = decryptJson<{ grant: Grant; app: OAuthApp }>(p.grant_enc);
  return { provider: p.provider, authMode: p.auth_mode as AuthMode, grant, app, accounts: p.accounts, params: p.params };
}

/** Housekeeping: drop connect links and pickers that expired over a day ago. */
export async function purgeExpiredOAuthRows(): Promise<number> {
  return stateStore.purge(new Date(Date.now() - 24 * 3600_000).toISOString());
}

export async function redirectUri(provider: string): Promise<string> {
  const base = String(await getSetting<string>("app.public_url")).replace(/\/+$/, "");
  return `${base}/api/connections/oauth/${provider}/callback`;
}

/** Shopify signs OAuth callbacks: HMAC-SHA256 (hex) of the other query params
 *  sorted by key and joined as k=v&k=v, keyed with the app's client secret. */
export function verifyShopifyHmac(query: URLSearchParams, secret: string): boolean {
  const given = query.get("hmac") ?? "";
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const msg = [...query.entries()].filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("&");
  const digest = createHmac("sha256", secret).update(msg).digest("hex");
  return timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(digest, "utf8"));
}

export const isShopDomain = (shop: string) => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);

/** Zoho data-centre login servers we accept. Exact list, not a pattern: the
 *  callback's accounts-server decides where we POST our client secret. */
const ZOHO_ACCOUNTS_HOSTS = new Set([
  "https://accounts.zoho.com", "https://accounts.zoho.eu", "https://accounts.zoho.in", "https://accounts.zoho.com.au",
  "https://accounts.zoho.jp", "https://accounts.zoho.sa", "https://accounts.zoho.uk", "https://accounts.zohocloud.ca", "https://accounts.zoho.com.cn",
]);
export const isZohoAccountsHost = (url: string) => ZOHO_ACCOUNTS_HOSTS.has(url.replace(/\/+$/, ""));
