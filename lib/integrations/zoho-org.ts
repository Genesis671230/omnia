/* Zoho Books organisations — the registry, per-connection OAuth tokens, and
 * the switch that runs a block of work inside one organisation.
 *
 *   await withZohoOrg("house-of-omnia", () => publishSettlement(id))
 *
 * Inside the callback every existing Zoho helper (getAccessToken, zohoOrgId,
 * the throttle's daily quota) resolves to that organisation, so the 60-odd
 * call sites that already exist did not need a new parameter each.
 *
 * Connections:
 *   "env"   the organisation in ZOHO_* env vars — the implicit default,
 *           unchanged behaviour when no organisation is chosen
 *   others  rows in zoho_connections, added from Settings; client secret and
 *           refresh token AES-GCM encrypted (lib/crypto/secret-box.ts)
 */

import { currentTenant } from "@/lib/tenant";
import { supabase } from "@/lib/supabase";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import { zohoThrottledFetch } from "./zoho-throttle";
import { ENV_CONNECTION_ID, currentZohoScope, runInZohoScope, type ZohoOrgScope } from "./zoho-context";

const TENANT = currentTenant();
const DEFAULT_ACCOUNTS_URL = "https://accounts.zoho.com";
const DEFAULT_API_DOMAIN = "https://www.zohoapis.com";
const ENV_BUDGET = Number(process.env.ZOHO_DAILY_BUDGET ?? 7000);

export type ZohoConnection = {
  id: string;
  label: string;
  orgId: string;
  orgName: string;
  accountsUrl: string;
  apiDomain: string;
  clientId: string;
  loginEmail: string;
  dailyBudget: number;
  status: "active" | "error" | "disabled";
  lastError: string;
  lastCheckedAt: string | null;
  /** OAuth scopes granted to the refresh token ('' = unknown). */
  scopes: string;
  /** Payout providers whose uploads settle into this org by default ("COD"). */
  defaultForProviders: string[];
  source: "env" | "db";
};

type Secrets = { clientId: string; clientSecret: string; refreshToken: string; accountsUrl: string };

type Row = {
  id: string; label: string; org_id: string; org_name: string; accounts_url: string; api_domain: string;
  client_id: string; client_secret_enc: string; refresh_token_enc: string; login_email: string;
  daily_budget: number; status: string; last_error: string; last_checked_at: string | null;
  default_for_providers: string[] | null;
  scopes: string | null;
};

/* ── registry ──────────────────────────────────────────────────────────── */

export function envConnection(): ZohoConnection | null {
  const orgId = process.env.ZOHO_ORGANIZATION_ID;
  if (!orgId || !process.env.ZOHO_REFRESH_TOKEN) return null;
  return {
    id: ENV_CONNECTION_ID,
    label: process.env.ZOHO_ORGANIZATION_LABEL || "Main organisation",
    orgId,
    orgName: process.env.ZOHO_ORGANIZATION_LABEL || "",
    accountsUrl: process.env.ZOHO_ACCOUNTS_URL || DEFAULT_ACCOUNTS_URL,
    apiDomain: DEFAULT_API_DOMAIN,
    clientId: process.env.ZOHO_CLIENT_ID || "",
    loginEmail: "",
    dailyBudget: ENV_BUDGET,
    status: "active",
    lastError: "",
    lastCheckedAt: null,
    scopes: envScopes,
    defaultForProviders: [],
    source: "env",
  };
}

const fromRow = (r: Row): ZohoConnection => ({
  id: r.id, label: r.label, orgId: r.org_id, orgName: r.org_name, accountsUrl: r.accounts_url, apiDomain: r.api_domain,
  clientId: r.client_id, loginEmail: r.login_email, dailyBudget: r.daily_budget,
  status: (r.status as ZohoConnection["status"]) || "active", lastError: r.last_error, lastCheckedAt: r.last_checked_at,
  defaultForProviders: r.default_for_providers ?? [], scopes: r.scopes ?? "", source: "db",
});

async function getRow(id: string): Promise<Row | null> {
  const { data, error } = await supabase.from("zoho_connections").select("*").eq("tenant_id", TENANT).eq("id", id).maybeSingle();
  if (error) throw new Error(`zoho_connections read failed: ${error.message}`);
  return (data as Row) ?? null;
}

/** Every organisation this tenant can use — never includes secrets. */
export async function listZohoConnections(): Promise<ZohoConnection[]> {
  const { data, error } = await supabase.from("zoho_connections").select("*").eq("tenant_id", TENANT).order("created_at");
  if (error) throw new Error(`zoho_connections read failed: ${error.message}`);
  const env = envConnection();
  return [...(env ? [env] : []), ...((data ?? []) as Row[]).map(fromRow)];
}

export async function getZohoConnection(id: string): Promise<ZohoConnection | null> {
  if (!id || id === ENV_CONNECTION_ID) return envConnection();
  const row = await getRow(id);
  return row ? fromRow(row) : null;
}

async function secretsFor(id: string): Promise<Secrets> {
  if (id === ENV_CONNECTION_ID) {
    return {
      clientId: process.env.ZOHO_CLIENT_ID!,
      clientSecret: process.env.ZOHO_CLIENT_SECRET!,
      refreshToken: process.env.ZOHO_REFRESH_TOKEN!,
      accountsUrl: process.env.ZOHO_ACCOUNTS_URL || DEFAULT_ACCOUNTS_URL,
    };
  }
  const row = await getRow(id);
  if (!row) throw new Error(`Zoho connection "${id}" not found`);
  return {
    clientId: row.client_id,
    clientSecret: decryptSecret(row.client_secret_enc),
    refreshToken: decryptSecret(row.refresh_token_enc),
    accountsUrl: row.accounts_url,
  };
}

/* ── scope ─────────────────────────────────────────────────────────────── */

/** Run `fn` with every Zoho call inside it pointed at one organisation.
 *  Empty / "env" = the default organisation. Throws for an unknown or
 *  disabled connection rather than silently falling back — posting to the
 *  wrong set of books is the one failure this must never have. */
export async function withZohoOrg<T>(connectionId: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  const conn = await getZohoConnection(connectionId || ENV_CONNECTION_ID);
  if (!conn) throw new Error(connectionId && connectionId !== ENV_CONNECTION_ID ? `Unknown Zoho organisation "${connectionId}"` : "Zoho is not configured");
  if (conn.status === "disabled") throw new Error(`Zoho organisation "${conn.label}" is disabled`);
  const scope: ZohoOrgScope = { connectionId: conn.id, orgId: conn.orgId, label: conn.label, dailyBudget: conn.dailyBudget, apiDomain: conn.apiDomain };
  return runInZohoScope(scope, fn);
}

/** The organisation a request asked for: ?zohoOrg=… or the x-zoho-org header. */
export function zohoOrgFromRequest(req: Request): string {
  const q = new URL(req.url).searchParams.get("zohoOrg");
  return (q || req.headers.get("x-zoho-org") || "").trim();
}

/* ── tokens (one cache per connection) ─────────────────────────────────── */

const tokens = new Map<string, { token: string; expiresAt: number }>();
let envScopes = ""; // the env connection's granted scopes, learned on refresh
const inflight = new Map<string, Promise<string>>();

async function exchangeRefreshToken(s: Secrets): Promise<{ access_token: string; expires_in: number; api_domain?: string; scope?: string }> {
  const body = new URLSearchParams({ refresh_token: s.refreshToken, client_id: s.clientId, client_secret: s.clientSecret, grant_type: "refresh_token" });
  const res = await zohoThrottledFetch(`${s.accountsUrl}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  }, { skipQuota: true, label: "oauth.token" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error || !json.access_token) {
    throw new Error(`Zoho OAuth refresh failed HTTP ${res.status}: ${json.error_description ?? json.error ?? "no access token returned"}`);
  }
  return json;
}

/** Access token for the organisation in scope (default: env). */
export async function getScopedAccessToken(): Promise<string> {
  const id = currentZohoScope()?.connectionId ?? ENV_CONNECTION_ID;
  const hit = tokens.get(id);
  if (hit && hit.expiresAt > Date.now() + 5 * 60_000) return hit.token;
  const pending = inflight.get(id);
  if (pending) return pending;
  const p = (async () => {
    const json = await exchangeRefreshToken(await secretsFor(id));
    const expiresIn = Number(json.expires_in ?? 3600);
    if (json.scope) {
      if (id === ENV_CONNECTION_ID) envScopes = json.scope;
      else await supabase.from("zoho_connections").update({ scopes: json.scope }).eq("tenant_id", TENANT).eq("id", id);
    }
    tokens.set(id, { token: json.access_token, expiresAt: Date.now() + (expiresIn - 5 * 60) * 1000 });
    return json.access_token;
  })();
  inflight.set(id, p);
  try {
    return await p;
  } finally {
    inflight.delete(id);
  }
}

/* ── onboarding: discover, save, test, remove ──────────────────────────── */

export type DiscoveredOrg = { orgId: string; name: string; currency: string; isDefault: boolean };

/** Which organisations a set of credentials can reach — called before saving,
 *  so the user picks the org from Zoho's own list instead of typing an id. */
export async function discoverZohoOrgs(input: { clientId: string; clientSecret: string; refreshToken: string; accountsUrl?: string }): Promise<{ orgs: DiscoveredOrg[]; apiDomain: string; scopes: string }> {
  const s: Secrets = { ...input, accountsUrl: input.accountsUrl || DEFAULT_ACCOUNTS_URL };
  const tok = await exchangeRefreshToken(s);
  const apiDomain = tok.api_domain || DEFAULT_API_DOMAIN;
  const res = await zohoThrottledFetch(`${apiDomain}/books/v3/organizations`, {
    headers: { Authorization: `Zoho-oauthtoken ${tok.access_token}` },
    cache: "no-store",
  }, { skipQuota: true, label: "books.organizations.list" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.code !== 0) throw new Error(`Zoho /organizations failed HTTP ${res.status}: ${json.message ?? "unknown error"}`);
  const orgs = ((json.organizations ?? []) as { organization_id: string; name: string; currency_code: string; is_default_org: boolean }[])
    .map((o) => ({ orgId: String(o.organization_id), name: o.name, currency: o.currency_code, isDefault: Boolean(o.is_default_org) }));
  return { orgs, apiDomain, scopes: tok.scope ?? "" };
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "org";

export type SaveConnectionInput = {
  id?: string;
  label: string;
  orgId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accountsUrl?: string;
  loginEmail?: string;
  dailyBudget?: number;
  createdBy?: string;
};

/** Verify the credentials really reach `orgId`, then store them encrypted. */
export async function saveZohoConnection(input: SaveConnectionInput): Promise<ZohoConnection> {
  const label = input.label.trim();
  if (!label) throw new Error("Give the organisation a name");
  const env = envConnection();
  if (env && env.orgId === input.orgId) throw new Error(`Organisation ${input.orgId} is already the main organisation`);

  const { orgs, apiDomain, scopes } = await discoverZohoOrgs(input);
  const org = orgs.find((o) => o.orgId === input.orgId);
  if (!org) {
    throw new Error(`These credentials can't reach organisation ${input.orgId}. They can reach: ${orgs.map((o) => `${o.name} (${o.orgId})`).join(", ") || "none"}`);
  }

  const id = input.id || slug(label);
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("zoho_connections").upsert({
    id,
    tenant_id: TENANT,
    label,
    org_id: org.orgId,
    org_name: org.name,
    accounts_url: input.accountsUrl || DEFAULT_ACCOUNTS_URL,
    api_domain: apiDomain,
    client_id: input.clientId.trim(),
    client_secret_enc: encryptSecret(input.clientSecret.trim()),
    refresh_token_enc: encryptSecret(input.refreshToken.trim()),
    login_email: input.loginEmail?.trim() ?? "",
    daily_budget: input.dailyBudget ?? 4500,
    scopes,
    status: "active",
    last_error: "",
    last_checked_at: now,
    updated_at: now,
    created_by: input.createdBy ?? "",
  }, { onConflict: "id" }).select("*").single();
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) throw new Error(`Organisation ${org.name} (${org.orgId}) is already connected`);
    throw new Error(`Saving the connection failed: ${error.message}`);
  }
  tokens.delete(id);
  return fromRow(data as Row);
}

/** Refresh the token and read the organisation — records the outcome. */
export async function testZohoConnection(id: string): Promise<{ ok: boolean; orgName?: string; error?: string }> {
  const conn = await getZohoConnection(id);
  if (!conn) return { ok: false, error: "Connection not found" };
  let result: { ok: boolean; orgName?: string; error?: string };
  try {
    tokens.delete(conn.id);
    const token = await withZohoOrg(conn.id, () => getScopedAccessToken());
    const res = await zohoThrottledFetch(`${conn.apiDomain}/books/v3/organizations/${conn.orgId}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      cache: "no-store",
    }, { skipQuota: true, label: "books.organizations.get" });
    const json = await res.json().catch(() => ({}));
    result = res.ok && json.code === 0 ? { ok: true, orgName: json.organization?.name } : { ok: false, error: json.message ?? `HTTP ${res.status}` };
  } catch (e) {
    result = { ok: false, error: (e as Error).message };
  }
  if (conn.source === "db") {
    await supabase.from("zoho_connections").update({
      status: result.ok ? "active" : "error",
      last_error: result.error ?? "",
      last_checked_at: new Date().toISOString(),
      ...(result.orgName ? { org_name: result.orgName } : {}),
    }).eq("tenant_id", TENANT).eq("id", conn.id);
  }
  return result;
}

export async function updateZohoConnection(id: string, patch: { label?: string; status?: "active" | "disabled"; dailyBudget?: number; defaultForProviders?: string[] }) {
  if (id === ENV_CONNECTION_ID) throw new Error("The main organisation is configured by environment variables");
  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.label?.trim()) upd.label = patch.label.trim();
  if (patch.status) upd.status = patch.status;
  if (patch.dailyBudget && patch.dailyBudget > 0) upd.daily_budget = Math.round(patch.dailyBudget);
  if (patch.defaultForProviders) {
    const providers = [...new Set(patch.defaultForProviders.map((p) => p.trim()).filter(Boolean))];
    // A provider routes to one organisation only — take it off any other.
    for (const p of providers) {
      const { data } = await supabase.from("zoho_connections").select("id, default_for_providers").eq("tenant_id", TENANT).contains("default_for_providers", [p]).neq("id", id);
      for (const r of (data ?? []) as { id: string; default_for_providers: string[] }[]) {
        await supabase.from("zoho_connections").update({ default_for_providers: r.default_for_providers.filter((x) => x !== p) }).eq("id", r.id);
      }
    }
    upd.default_for_providers = providers;
  }
  const { error } = await supabase.from("zoho_connections").update(upd).eq("tenant_id", TENANT).eq("id", id);
  if (error) throw new Error(`Updating the connection failed: ${error.message}`);
}

export async function deleteZohoConnection(id: string) {
  if (id === ENV_CONNECTION_ID) throw new Error("The main organisation is configured by environment variables");
  const { count } = await supabase.from("payouts").select("id", { count: "exact", head: true }).eq("zoho_connection_id", id);
  if ((count ?? 0) > 0) throw new Error(`${count} uploaded payouts settle into this organisation — disable it instead of deleting`);
  const { error } = await supabase.from("zoho_connections").delete().eq("tenant_id", TENANT).eq("id", id);
  if (error) throw new Error(`Deleting the connection failed: ${error.message}`);
  tokens.delete(id);
}

/* ── route helpers ─────────────────────────────────────────────────────── */

/** Run a route handler inside the organisation the request names
 *  (?zohoOrg=… / x-zoho-org). An unknown or disabled organisation is a 400,
 *  never a silent fallback to the default books. */
export async function zohoOrgScoped(req: Request, fn: () => Promise<Response>): Promise<Response> {
  return runInZohoOrgOr400(zohoOrgFromRequest(req), fn);
}

/** Same, for an organisation the server already knows (e.g. the payout's). */
export async function runInZohoOrgOr400(connectionId: string | null | undefined, fn: () => Promise<Response>): Promise<Response> {
  let conn: ZohoConnection | null;
  try {
    conn = await getZohoConnection(connectionId || ENV_CONNECTION_ID);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
  if (!conn) return Response.json({ error: connectionId ? `Unknown Zoho organisation "${connectionId}"` : "Zoho is not configured" }, { status: 400 });
  if (conn.status === "disabled") return Response.json({ error: `Zoho organisation "${conn.label}" is disabled` }, { status: 400 });
  return runInZohoScope({ connectionId: conn.id, orgId: conn.orgId, label: conn.label, dailyBudget: conn.dailyBudget, apiDomain: conn.apiDomain }, fn);
}

/* ── which books a record belongs to ───────────────────────────────────── */

/** The organisation uploads from `provider` settle into by default ('' = main). */
export async function zohoOrgForProvider(provider: string): Promise<string> {
  if (!provider) return "";
  const { data } = await supabase.from("zoho_connections").select("id").eq("tenant_id", TENANT).eq("status", "active").contains("default_for_providers", [provider]).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? "";
}

/** The organisation a payout settles into ('' = default). */
export async function zohoOrgForPayout(payoutId: string | null | undefined): Promise<string> {
  if (!payoutId) return "";
  const { data } = await supabase.from("payouts").select("zoho_connection_id").eq("id", payoutId).maybeSingle();
  return (data?.zoho_connection_id as string | undefined) ?? "";
}

/** The organisation for a bank credit: that of the payout it was reconciled
 *  to (recon_lines), or of a payout pinned to it. '' when neither exists. */
export async function zohoOrgForBankLine(bankLineId: string | null | undefined): Promise<string> {
  if (!bankLineId) return "";
  const { data: rl } = await supabase.from("recon_lines").select("payout_id").eq("bank_line_id", bankLineId).not("payout_id", "is", null).limit(1).maybeSingle();
  if (rl?.payout_id) return zohoOrgForPayout(rl.payout_id as string);
  const { data: pinned } = await supabase.from("payouts").select("zoho_connection_id").eq("bank_line_id", bankLineId).limit(1).maybeSingle();
  if (pinned?.zoho_connection_id) return pinned.zoho_connection_id as string;
  // No payout: the books of the statement the line came from (RAK → House of Omnia).
  const { data: line } = await supabase.from("bank_lines").select("statement_account").eq("id", bankLineId).maybeSingle();
  if (!line?.statement_account) return "";
  const { data: acct } = await supabase.from("statement_accounts").select("zoho_connection_id").eq("id", line.statement_account).maybeSingle();
  return (acct?.zoho_connection_id as string | undefined) ?? "";
}

/** The organisation for a settlement record (via its payout, else its bank credit). */
export async function zohoOrgForSettlement(settlementId: string): Promise<string> {
  const { data } = await supabase.from("settlement_records").select("payout_id, bank_line_id").eq("id", settlementId).maybeSingle();
  if (!data) return "";
  return (await zohoOrgForPayout(data.payout_id as string | null)) || zohoOrgForBankLine(data.bank_line_id as string);
}
