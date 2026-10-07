import { getConnector } from "./registry";
import { consumeState, createState, redirectUri, savePendingGrant, takePendingGrant } from "./oauth";
import {
  getAccessToken, getConnection, grantFingerprint, isLiveStore, markSynced, resolveApp, saveConnection, setConnectionError,
  testConnection, toPublic, type SaveInput,
} from "./runtime";
import {
  OAuthFlowError, type AuthMode, type BaseSecrets, type Connection, type ConnectorDef, type DiscoveredAccount, type Grant,
  type GrantType, type OAuthApp, type PublicConnection,
} from "./types";

/* The connect flow, provider-agnostic:
 *   startConnect     → redirect URL (OAuth) or a saved connection (pasted
 *                      token, pasted refresh token, client credentials)
 *   completeCallback → validates state (+ provider check such as Shopify's
 *                      HMAC), exchanges the code, saves one account or parks
 *                      several for the picker
 *   completePending  → the picker's choice becomes connections
 * Nothing is written to `connections` until every check has passed. */

export type StartInput = {
  provider: string; authMode: AuthMode; grantType?: GrantType;
  ownApp?: { clientId: string; clientSecret: string };
  token?: string; refreshToken?: string; webhookSecret?: string;
  params?: Record<string, string>;
};

/** Save, then run onConnect and a live test. A failing onConnect keeps the
 *  grant but leaves the row in "error" with the reason. */
export async function finishConnection(input: SaveInput): Promise<Connection> {
  const conn = await saveConnection(input);
  const def = getConnector(conn.provider);
  if (def.onConnect) {
    try {
      await def.onConnect(conn, await getAccessToken(conn));
    } catch (e) {
      await setConnectionError(conn.id, `Setup step failed: ${(e as Error).message}`);
      return (await getConnection(conn.id))!;
    }
  }
  await testConnection(conn.id);
  if (isLiveStore()) {
    const { writeAudit } = await import("@/lib/audit");
    await writeAudit({ entity: "connection", entityId: conn.id, event: "connected", actor: input.connectedBy, payload: { provider: conn.provider, authMode: conn.authMode, accountRef: conn.accountRef } });
  }
  return (await getConnection(conn.id))!;
}

function cleanParams(def: ConnectorDef, params: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of def.startParams ?? []) {
    const v = String(params[p.key] ?? "").trim();
    if (!v) throw new OAuthFlowError("bad_request", `${p.label} is required`);
    if (p.pattern && !new RegExp(p.pattern).test(v)) throw new OAuthFlowError("bad_request", `${p.label} looks wrong`);
    if (p.options && !p.options.includes(v)) throw new OAuthFlowError("bad_request", `${p.label} must be one of ${p.options.join(", ")}`);
    out[p.key] = v;
  }
  return out;
}

function accountSecrets(grant: Grant, app: OAuthApp | null, authMode: AuthMode): BaseSecrets {
  return {
    ...(authMode === "own_app" && app ? { client_id: app.clientId, client_secret: app.clientSecret } : {}),
    access_token: grant.accessToken,
    access_token_expires_at: grant.expiresAt,
    ...(grant.refreshToken ? { refresh_token: grant.refreshToken, grant_id: grantFingerprint(grant.refreshToken) } : {}),
  };
}

async function saveAccounts(
  provider: string, authMode: AuthMode, grantType: GrantType, grant: Grant, app: OAuthApp | null,
  accounts: DiscoveredAccount[], actor: string, extraSecrets: Record<string, string> = {},
): Promise<string[]> {
  const ids: string[] = [];
  for (const a of accounts) {
    const conn = await finishConnection({
      provider, authMode, grantType, accountRef: a.accountRef, label: a.label, config: a.config,
      secrets: { ...accountSecrets(grant, app, authMode), ...extraSecrets },
      scopes: a.scopes ?? grant.scopes ?? "", connectedBy: actor,
    });
    ids.push(conn.id);
  }
  return ids;
}

export async function startConnect(input: StartInput, actor: string): Promise<{ redirect: string } | { connection: PublicConnection }> {
  const def = getConnector(input.provider);
  if (!def.authModes.includes(input.authMode)) throw new OAuthFlowError("bad_request", `${def.label} does not support ${input.authMode}`);
  const allowed = def.grantTypes[input.authMode] ?? [];
  const grantType = input.grantType ?? allowed[0];
  if (!grantType || !allowed.includes(grantType)) throw new OAuthFlowError("bad_request", `Unsupported connection method for ${def.label}`);
  const params = cleanParams(def, input.params);
  const ownApp = input.ownApp && input.ownApp.clientId?.trim() && input.ownApp.clientSecret?.trim()
    ? { clientId: input.ownApp.clientId.trim(), clientSecret: input.ownApp.clientSecret.trim() } : null;
  if (input.authMode === "own_app" && !ownApp) throw new OAuthFlowError("bad_request", "Client ID and client secret are required");
  const app = input.authMode === "platform" ? resolveApp({ provider: def.provider, authMode: "platform", secrets: {} }) : ownApp;
  if (input.authMode === "platform" && !app) throw new OAuthFlowError("no_app", `${def.label} platform app is not configured on this deployment`);

  // No redirect: pasted access token, pasted refresh token, or client credentials.
  if (grantType !== "authorization_code") {
    let grant: Grant;
    if (grantType === "static_token") {
      if (!input.token?.trim()) throw new OAuthFlowError("bad_request", "Paste the access token");
      grant = { accessToken: input.token.trim(), raw: {} };
    } else if (grantType === "static_refresh") {
      if (!input.refreshToken?.trim() || !def.oauth || !app) throw new OAuthFlowError("bad_request", "Paste the refresh token");
      const cfg = def.configSchema.parse(params.dc ? { accounts_url: params.dc } : {});
      grant = await def.oauth.refresh({ refresh_token: input.refreshToken.trim() } as any, cfg, app);
      grant.refreshToken = input.refreshToken.trim();
    } else {
      if (!def.oauth?.clientCredentials || !app) throw new OAuthFlowError("bad_request", "Client credentials are not supported here");
      grant = await def.oauth.clientCredentials(app, null as any, params);
    }
    const accounts = await def.accountsFromGrant(grant, app ?? { clientId: "", clientSecret: "" }, params);
    if (!accounts.length) throw new OAuthFlowError("no_accounts", "These credentials reach no account");
    // A webhook secret is only meaningful for pasted legacy tokens (OAuth apps
    // sign webhooks with their client secret), so it never enters a redirect.
    const extra = input.webhookSecret?.trim() ? { webhook_secret: input.webhookSecret.trim() } : {};
    const ids = await saveAccounts(def.provider, input.authMode, grantType, grant, app, accounts, actor, extra);
    return { connection: toPublic((await getConnection(ids[0]))!) };
  }

  if (!def.oauth) throw new OAuthFlowError("bad_request", `${def.label} has no sign-in flow`);
  const { state, pkceChallenge } = await createState(
    { provider: def.provider, authMode: input.authMode, pendingApp: ownApp, params, createdBy: actor },
    { pkce: def.provider === "gmail" },
  );
  return { redirect: def.oauth.authorizeUrl({ state, redirectUri: await redirectUri(def.provider), app: app!, pkceChallenge, params }) };
}

export async function completeCallback(provider: string, query: URLSearchParams, actor: string): Promise<{ connectionIds: string[] } | { pendingId: string }> {
  const def = getConnector(provider);
  const rec = await consumeState(query.get("state") ?? "", provider, actor);
  if (query.get("error")) throw new OAuthFlowError("denied", `${def.label}: ${query.get("error_description") ?? query.get("error")}`);
  const app = rec.authMode === "platform" ? resolveApp({ provider, authMode: "platform", secrets: {} }) : rec.pendingApp;
  if (!app || !def.oauth) throw new OAuthFlowError("no_app", "App credentials are missing — start again");
  def.verifyCallback?.(query, app, rec.params);
  const code = query.get("code");
  if (!code) throw new OAuthFlowError("bad_request", "No authorization code was returned");
  const grant = await def.oauth.exchangeCode({ code, redirectUri: await redirectUri(provider), app, pkceVerifier: rec.pkceVerifier || undefined, query, params: rec.params });
  const accounts = await def.accountsFromGrant(grant, app, rec.params);
  if (!accounts.length) throw new OAuthFlowError("no_accounts", `${def.label} login reaches no account`);
  if (accounts.length > 1) {
    return { pendingId: await savePendingGrant({ provider, authMode: rec.authMode, grant, app, accounts, params: rec.params, createdBy: actor }) };
  }
  return { connectionIds: await saveAccounts(provider, rec.authMode, "authorization_code", grant, app, accounts, actor) };
}

export async function completePending(pendingId: string, accountRefs: string[], actor: string): Promise<string[]> {
  const p = await takePendingGrant(pendingId, actor);
  const chosen = p.accounts.filter((a) => accountRefs.includes(a.accountRef));
  if (!chosen.length) throw new OAuthFlowError("bad_request", "Pick at least one of the accounts offered");
  return saveAccounts(p.provider, p.authMode, "authorization_code", p.grant, p.authMode === "platform" ? null : p.app, chosen, actor);
}

/* ── Sync now ─────────────────────────────────────────────────────────── */

type SyncHandler = (conn: Connection) => Promise<{ summary: string }>;
const syncHandlers = new Map<string, SyncHandler>();

export function registerSyncHandler(provider: string, fn: SyncHandler) {
  syncHandlers.set(provider, fn);
}

export async function runSync(id: string): Promise<{ summary: string }> {
  const conn = await getConnection(id);
  if (!conn) throw new Error(`Connection "${id}" not found`);
  const fn = syncHandlers.get(conn.provider);
  if (!fn) return { summary: "Nothing to sync for this connection" };
  const out = await fn(conn);
  await markSynced(id);
  return out;
}
