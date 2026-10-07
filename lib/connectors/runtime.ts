import { createHash } from "node:crypto";
import { decryptJson, encryptJson } from "@/lib/crypto/secret-box";
import { currentTenant } from "@/lib/tenant";
import { getConnector, hasConnector } from "./registry";
import { supabaseConnectionStore, type ConnectionRow, type ConnectionStore } from "./store";
import {
  GrantRevokedError, ReauthRequiredError,
  type AuthMode, type BaseSecrets, type Connection, type ConnectionStatus, type Grant, type GrantType, type OAuthApp, type PublicConnection,
} from "./types";

/* The one place that reads connection secrets and hands out access tokens.
 *
 *   const token = await getAccessToken("shopify-uae")
 *
 * Tokens are cached per process, refreshed 60 s before expiry, and refreshed
 * at most once at a time per connection (concurrent callers share the same
 * promise). A refresh the provider rejects as revoked flips the connection to
 * `needs_reauth`, sends one alert, and throws ReauthRequiredError — callers
 * show "Reconnect", never empty data. Any other failure (provider down, 5xx)
 * leaves the connection active and is recorded in last_error. */

let store: ConnectionStore = supabaseConnectionStore;
let alertSink: (text: string) => Promise<unknown> = async (text) => {
  const { sendTelegramMessage } = await import("@/lib/integrations/telegram");
  return sendTelegramMessage(text);
};

export function setConnectionStore(s: ConnectionStore) { store = s; }
export function setAlertSink(fn: (text: string) => Promise<unknown>) { alertSink = fn; }
/** False for the in-memory test store — audit writes are skipped so tests stay offline. */
export const isLiveStore = () => store === supabaseConnectionStore;

const REFRESH_MARGIN_MS = 60_000;
const tokenCache = new Map<string, { token: string; expiresAt?: number }>();
const inflight = new Map<string, Promise<string>>();
export function _resetRuntimeCaches() { tokenCache.clear(); inflight.clear(); }

export const grantFingerprint = (refreshToken: string) => createHash("sha256").update(refreshToken).digest("hex").slice(0, 32);

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "conn";

async function audit(entityId: string, event: string, actor: string, payload: Record<string, unknown>) {
  if (!isLiveStore()) return;
  const { writeAudit } = await import("@/lib/audit");
  await writeAudit({ entity: "connection", entityId, event, actor, payload });
}

function toConnection(row: ConnectionRow): Connection {
  const base = {
    id: row.id, tenantId: row.tenant_id, provider: row.provider,
    authMode: row.auth_mode as AuthMode, grantType: row.grant_type as GrantType,
    accountRef: row.account_ref, label: row.label, scopes: row.scopes,
    lastCheckedAt: row.last_checked_at, lastSyncedAt: row.last_synced_at,
    connectedBy: row.connected_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
  if (!hasConnector(row.provider)) {
    const parseError = `No connector for provider "${row.provider}" in this build`;
    return { ...base, config: row.config ?? {}, secrets: {}, status: "error", lastError: parseError, parseError };
  }
  const def = getConnector(row.provider);
  let parseError: string | undefined;
  const cfg = def.configSchema.safeParse(row.config ?? {});
  if (!cfg.success) parseError = `config: ${cfg.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(", ")}`;
  let secrets: BaseSecrets = {};
  if (row.secrets_enc) {
    try {
      const s = def.secretsSchema.safeParse(decryptJson(row.secrets_enc));
      if (s.success) secrets = s.data;
      else parseError = `secrets: ${s.error.issues.map((i) => i.path.join(".")).join(", ")}`;
    } catch (e) {
      parseError = `secrets: ${(e as Error).message}`;
    }
  }
  return {
    ...base,
    config: cfg.success ? (cfg.data as Record<string, unknown>) : (row.config ?? {}),
    secrets,
    status: parseError ? "error" : (row.status as ConnectionStatus),
    lastError: parseError ?? row.last_error,
    ...(parseError ? { parseError } : {}),
  };
}

export function toPublic(c: Connection): PublicConnection {
  const { secrets, ...rest } = c;
  const def = hasConnector(c.provider) ? getConnector(c.provider) : null;
  return { ...rest, hasSecrets: Object.keys(secrets).length > 0, category: def?.category ?? "store", providerLabel: def?.label ?? c.provider };
}

export async function listConnections(provider?: string, opts: { includeDisabled?: boolean } = {}): Promise<Connection[]> {
  const rows = await store.list(currentTenant(), provider);
  return rows.map(toConnection).filter((c) => opts.includeDisabled || c.status !== "disabled");
}

export async function listPublicConnections(): Promise<PublicConnection[]> {
  return (await listConnections(undefined, { includeDisabled: true })).map(toPublic);
}

export async function getConnection(id: string): Promise<Connection | null> {
  const row = await store.get(currentTenant(), id);
  return row ? toConnection(row) : null;
}

export type SaveInput = {
  id?: string; provider: string; authMode: AuthMode; grantType: GrantType; accountRef: string; label: string;
  config: Record<string, unknown>; secrets: BaseSecrets & Record<string, unknown>; scopes?: string; connectedBy: string; status?: ConnectionStatus;
};

/** Create, or update the existing connection for the same (provider, account).
 *  An existing row keeps its id, so references to it never break. */
export async function saveConnection(input: SaveInput): Promise<Connection> {
  const def = getConnector(input.provider);
  if (!def.authModes.includes(input.authMode)) throw new Error(`${def.label} does not support ${input.authMode}`);
  const config = def.configSchema.parse(input.config) as Record<string, unknown>;
  const secrets = def.secretsSchema.parse({
    ...input.secrets,
    ...(input.secrets.refresh_token && !input.secrets.grant_id ? { grant_id: grantFingerprint(input.secrets.refresh_token) } : {}),
  });
  const tenant = currentTenant();
  const now = new Date().toISOString();
  const existing = await store.findByAccount(tenant, input.provider, input.accountRef);
  if (existing) {
    await store.update(tenant, existing.id, {
      auth_mode: input.authMode, grant_type: input.grantType, label: input.label, config,
      secrets_enc: encryptJson(secrets), scopes: input.scopes ?? existing.scopes, status: input.status ?? "active", last_error: "",
    });
    tokenCache.delete(existing.id);
    return toConnection((await store.get(tenant, existing.id))!);
  }
  let id = input.id ?? `${input.provider}-${slug(input.accountRef)}`;
  if (!input.id) for (let n = 2; await store.get(tenant, id); n++) id = `${input.provider}-${slug(input.accountRef)}-${n}`;
  await store.insert({
    id, tenant_id: tenant, provider: input.provider, auth_mode: input.authMode, grant_type: input.grantType,
    account_ref: input.accountRef, label: input.label, config, secrets_enc: encryptJson(secrets),
    scopes: input.scopes ?? "", status: input.status ?? "active", last_checked_at: null, last_synced_at: null, last_error: "",
    connected_by: input.connectedBy, created_at: now, updated_at: now,
  });
  return toConnection((await store.get(tenant, id))!);
}

export async function updateConnection(
  id: string,
  patch: { label?: string; config?: Record<string, unknown>; status?: ConnectionStatus; secrets?: Partial<BaseSecrets> & Record<string, unknown> },
  actor: string,
): Promise<void> {
  const conn = await getConnection(id);
  if (!conn) throw new Error(`Connection "${id}" not found`);
  const def = getConnector(conn.provider);
  const upd: Partial<ConnectionRow> = {};
  if (patch.label?.trim()) upd.label = patch.label.trim();
  if (patch.config) upd.config = def.configSchema.parse({ ...conn.config, ...patch.config }) as Record<string, unknown>;
  if (patch.status) upd.status = patch.status;
  if (patch.secrets) upd.secrets_enc = encryptJson(def.secretsSchema.parse({ ...conn.secrets, ...patch.secrets }));
  await store.update(currentTenant(), id, upd);
  tokenCache.delete(id);
  await audit(id, "updated", actor, { ...patch });
}

export async function setConnectionError(id: string, message: string): Promise<void> {
  await store.update(currentTenant(), id, { status: "error", last_error: message });
}

export async function removeConnection(id: string, actor: string): Promise<{ removed: true } | { blocked: string[] }> {
  const conn = await getConnection(id);
  if (!conn) throw new Error(`Connection "${id}" not found`);
  const def = getConnector(conn.provider);
  const refs = def.references ? await def.references(conn) : [];
  if (refs.length) return { blocked: refs };
  if (def.onDisconnect) {
    try { await def.onDisconnect(conn, await getAccessToken(conn)); }
    catch (e) { console.error(`[connections] onDisconnect ${id}: ${(e as Error).message}`); }
  }
  await store.remove(currentTenant(), id);
  tokenCache.delete(id);
  await audit(id, "removed", actor, { provider: conn.provider, accountRef: conn.accountRef });
  return { removed: true };
}

/** App credentials used to talk to the provider for this connection. */
export function resolveApp(conn: { provider: string; authMode: AuthMode; secrets: BaseSecrets }): OAuthApp | null {
  if (conn.authMode === "platform") {
    const p = conn.provider.toUpperCase();
    const clientId = process.env[`PLATFORM_${p}_CLIENT_ID`];
    const clientSecret = process.env[`PLATFORM_${p}_CLIENT_SECRET`];
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }
  if (conn.secrets.client_id && conn.secrets.client_secret) return { clientId: conn.secrets.client_id, clientSecret: conn.secrets.client_secret };
  return null;
}

async function markReauth(conn: Connection, reason: string): Promise<never> {
  if (conn.status !== "needs_reauth") {
    await store.update(currentTenant(), conn.id, { status: "needs_reauth", last_error: reason });
    const label = hasConnector(conn.provider) ? getConnector(conn.provider).label : conn.provider;
    await alertSink(`⚠️ ${label} connection "${conn.label}" needs to be reconnected (${reason}). Settings → Connections.`).catch(() => {});
  }
  tokenCache.delete(conn.id);
  throw new ReauthRequiredError(conn.id, `${conn.label} needs to be reconnected: ${reason}`);
}

async function mintToken(conn: Connection): Promise<string> {
  const def = getConnector(conn.provider);
  const app = resolveApp(conn);
  let grant: Grant;
  try {
    if (conn.grantType === "client_credentials") {
      if (!def.oauth?.clientCredentials || !app) throw new GrantRevokedError("client credentials missing");
      grant = await def.oauth.clientCredentials(app, conn.config, {});
    } else {
      if (!def.oauth || !app || !conn.secrets.refresh_token) throw new GrantRevokedError("no refresh token or app credentials");
      grant = await def.oauth.refresh(conn.secrets, conn.config, app);
    }
  } catch (e) {
    if (e instanceof GrantRevokedError) return markReauth(conn, e.message);
    await store.update(currentTenant(), conn.id, { last_error: (e as Error).message });
    throw e;
  }
  const rotated = grant.refreshToken && grant.refreshToken !== conn.secrets.refresh_token ? grant.refreshToken : undefined;
  const nextSecrets: BaseSecrets = {
    ...conn.secrets,
    access_token: grant.accessToken,
    access_token_expires_at: grant.expiresAt,
    ...(rotated ? { refresh_token: rotated, grant_id: grantFingerprint(rotated) } : {}),
  };
  await store.update(currentTenant(), conn.id, { secrets_enc: encryptJson(nextSecrets), last_error: "", ...(grant.scopes ? { scopes: grant.scopes } : {}) });
  // Siblings on the same grant (several Zoho orgs from one login) get the rotated refresh token too.
  if (rotated && conn.secrets.grant_id) {
    for (const sib of await listConnections(conn.provider, { includeDisabled: true })) {
      if (sib.id !== conn.id && sib.secrets.grant_id === conn.secrets.grant_id) {
        await store.update(currentTenant(), sib.id, { secrets_enc: encryptJson({ ...sib.secrets, refresh_token: rotated, grant_id: grantFingerprint(rotated) }) });
        tokenCache.delete(sib.id);
      }
    }
  }
  tokenCache.set(conn.id, { token: grant.accessToken, expiresAt: grant.expiresAt });
  return grant.accessToken;
}

const fresh = (expiresAt?: number) => expiresAt === undefined || expiresAt > Date.now() + REFRESH_MARGIN_MS;

/** A usable access token for the connection. Throws ReauthRequiredError when
 *  the user must reconnect. */
export async function getAccessToken(connOrId: Connection | string): Promise<string> {
  const id = typeof connOrId === "string" ? connOrId : connOrId.id;
  const hit = tokenCache.get(id);
  if (hit && fresh(hit.expiresAt)) return hit.token;
  const pending = inflight.get(id);
  if (pending) return pending;
  const p = (async () => {
    const conn = await getConnection(id); // always re-read: another process may have refreshed
    if (!conn) throw new Error(`Connection "${id}" not found`);
    if (conn.status === "needs_reauth") throw new ReauthRequiredError(id, `${conn.label} needs to be reconnected`);
    if (conn.status === "disabled") throw new Error(`${conn.label} is disabled`);
    const s = conn.secrets;
    if (conn.grantType === "static_token") {
      if (!s.access_token) return markReauth(conn, "no token stored");
      tokenCache.set(id, { token: s.access_token });
      return s.access_token;
    }
    // A stored token is reusable while fresh. No expiry is only meaningful for
    // authorization-code grants (Shopify offline tokens never expire).
    const reusable = s.access_token && fresh(s.access_token_expires_at) &&
      (s.access_token_expires_at !== undefined || conn.grantType === "authorization_code");
    if (reusable) {
      tokenCache.set(id, { token: s.access_token!, expiresAt: s.access_token_expires_at });
      return s.access_token!;
    }
    return mintToken(conn);
  })();
  inflight.set(id, p);
  try { return await p; } finally { inflight.delete(id); }
}

export async function testConnection(id: string): Promise<{ ok: boolean; accountName?: string; scopes?: string; missingScopes?: string[]; error?: string }> {
  const conn = await getConnection(id);
  if (!conn) return { ok: false, error: "Connection not found" };
  const def = getConnector(conn.provider);
  let result: { ok: boolean; accountName?: string; scopes?: string; missingScopes?: string[]; error?: string };
  try {
    tokenCache.delete(id);
    result = await def.test(conn, await getAccessToken(conn));
  } catch (e) {
    if (e instanceof ReauthRequiredError) return { ok: false, error: e.message }; // keep needs_reauth
    result = { ok: false, error: (e as Error).message };
  }
  await store.update(currentTenant(), id, {
    status: result.ok ? "active" : "error",
    last_error: result.ok ? (result.missingScopes?.length ? `Missing scopes: ${result.missingScopes.join(", ")}` : "") : result.error ?? "test failed",
    last_checked_at: new Date().toISOString(),
    ...(result.scopes ? { scopes: result.scopes } : {}),
  });
  return result;
}

export async function markSynced(id: string): Promise<void> {
  await store.update(currentTenant(), id, { last_synced_at: new Date().toISOString() });
}
