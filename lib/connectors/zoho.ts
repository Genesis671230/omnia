import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { peekSetting } from "@/lib/settings";
import { getJson, postForm } from "./http";
import { isZohoAccountsHost } from "./oauth";
import { registerConnector } from "./registry";
import { GrantRevokedError, OAuthFlowError, type ConnectorDef, type Grant, type OAuthApp } from "./types";

/* Zoho Books. One connection per organisation; several organisations reached
 * by one login share its refresh token (runtime keeps them in step via
 * grant_id). Zoho runs separate data centres — the login server, token server
 * and API domain all follow the one the user signed in to. Zoho refresh
 * tokens do not expire and are not rotated; access tokens last one hour. */

export const ZOHO_SCOPE = "ZohoBooks.fullaccess.all";
const DEFAULT_ACCOUNTS = "https://accounts.zoho.com";
const DCS = ["https://accounts.zoho.com", "https://accounts.zoho.eu", "https://accounts.zoho.in", "https://accounts.zoho.com.au", "https://accounts.zoho.sa", "https://accounts.zoho.uk"];

const configSchema = z.object({
  accounts_url: z.string().url().default(DEFAULT_ACCOUNTS),
  api_domain: z.string().url().default("https://www.zohoapis.com"),
  org_name: z.string().default(""),
  daily_budget: z.number().int().positive().default(4500),
  default_for_providers: z.array(z.string()).default([]),
  login_email: z.string().default(""),
});
export type ZohoConfig = z.infer<typeof configSchema>;

const secretsSchema = z.object({
  client_id: z.string().optional(), client_secret: z.string().optional(),
  refresh_token: z.string().optional(), access_token: z.string().optional(),
  access_token_expires_at: z.number().optional(), grant_id: z.string().optional(),
});
export type ZohoSecrets = z.infer<typeof secretsSchema>;

/** Token-endpoint errors that mean the grant itself is dead. Anything else
 *  (rate limit "Access Denied", 5xx) is transient. */
const REVOKED = new Set(["invalid_code", "invalid_grant", "invalid_client", "invalid_client_secret", "unauthorized_client"]);

function toGrant(json: any, accountsUrl: string): Grant {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
    scopes: json.scope,
    raw: { api_domain: json.api_domain, accounts_url: accountsUrl },
  };
}

export async function zohoRefresh(secrets: ZohoSecrets, config: ZohoConfig, app: OAuthApp): Promise<Grant> {
  if (!isZohoAccountsHost(config.accounts_url)) throw new OAuthFlowError("bad_host", `Refusing Zoho accounts host ${config.accounts_url}`);
  const accountsUrl = config.accounts_url.replace(/\/+$/, "");
  const { status, json } = await postForm(`${accountsUrl}/oauth/v2/token`, {
    refresh_token: secrets.refresh_token ?? "", client_id: app.clientId, client_secret: app.clientSecret, grant_type: "refresh_token",
  });
  if (json?.access_token) return toGrant(json, accountsUrl);
  if (REVOKED.has(String(json?.error))) throw new GrantRevokedError(`Zoho: ${json.error}`);
  throw new Error(`Zoho token refresh failed HTTP ${status}: ${json?.error_description ?? json?.error ?? "no access token"}`);
}

export const zohoConnector: ConnectorDef<ZohoConfig, ZohoSecrets> = {
  provider: "zoho",
  label: "Zoho Books",
  category: "accounting",
  authModes: ["platform", "own_app"],
  grantTypes: { platform: ["authorization_code"], own_app: ["authorization_code", "static_refresh"] },
  configSchema,
  secretsSchema,
  configFields: [
    { key: "daily_budget", label: "Daily API budget", kind: "number", help: "Zoho caps about 5,000 calls a day per organisation" },
    { key: "default_for_providers", label: "Default books for gateways", kind: "json", help: 'e.g. ["COD"]' },
  ],
  startParams: [{ key: "dc", label: "Zoho data centre", options: DCS }],
  oauth: {
    authorizeUrl({ state, redirectUri, app, params }) {
      const dc = params.dc && isZohoAccountsHost(params.dc) ? params.dc.replace(/\/+$/, "") : DEFAULT_ACCOUNTS;
      const q = new URLSearchParams({
        scope: ZOHO_SCOPE, client_id: app.clientId, response_type: "code", access_type: "offline", prompt: "consent",
        redirect_uri: redirectUri, state,
      });
      return `${dc}/oauth/v2/auth?${q}`;
    },
    async exchangeCode({ code, redirectUri, app, query, params }) {
      const server = (query.get("accounts-server") || params.dc || DEFAULT_ACCOUNTS).replace(/\/+$/, "");
      if (!isZohoAccountsHost(server)) throw new OAuthFlowError("bad_host", `Unexpected Zoho accounts server ${server}`);
      const { status, json } = await postForm(`${server}/oauth/v2/token`, {
        code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code",
      });
      if (!json?.access_token) throw new OAuthFlowError("exchange_failed", `Zoho code exchange failed HTTP ${status}: ${json?.error ?? "no token"}`);
      if (!json.refresh_token) {
        throw new OAuthFlowError("exchange_failed", "Zoho returned no refresh token — remove this app under accounts.zoho.com → Connected Apps, then connect again");
      }
      return toGrant(json, server);
    },
    refresh: zohoRefresh,
  },
  async accountsFromGrant(grant) {
    const apiDomain = String(grant.raw.api_domain || "https://www.zohoapis.com").replace(/\/+$/, "");
    const accountsUrl = String(grant.raw.accounts_url || DEFAULT_ACCOUNTS);
    const { status, json } = await getJson(`${apiDomain}/books/v3/organizations`, { Authorization: `Zoho-oauthtoken ${grant.accessToken}` });
    if (status !== 200 || json.code !== 0) throw new OAuthFlowError("no_accounts", `Zoho /organizations failed HTTP ${status}: ${json?.message ?? ""}`);
    return (json.organizations ?? []).map((o: any) => ({
      accountRef: String(o.organization_id),
      label: String(o.name),
      config: { accounts_url: accountsUrl, api_domain: apiDomain, org_name: String(o.name) },
      scopes: grant.scopes,
    }));
  },
  async test(conn, token) {
    const { status, json } = await getJson(`${conn.config.api_domain}/books/v3/organizations/${conn.accountRef}`, { Authorization: `Zoho-oauthtoken ${token}` });
    return status === 200 && json.code === 0 ? { ok: true, accountName: json.organization?.name } : { ok: false, error: json?.message ?? `HTTP ${status}` };
  },
  /** Books that payouts, statements or postings already point at can't be
   *  deleted — posting to the wrong organisation is the one failure that
   *  must never happen. Disable instead. */
  async references(conn) {
    const checks: [table: string, label: string][] = [
      ["payouts", "payouts"], ["statement_accounts", "statement accounts"], ["settlement_records", "settlements"],
      ["zoho_account_config", "account mappings"], ["order_adjustments", "order adjustments"],
    ];
    // Rows written before multi-org store '' for "the default organisation".
    const ids = conn.id === peekSetting<string>("zoho.default_connection_id") ? [conn.id, ""] : [conn.id];
    const out: string[] = [];
    for (const [table, label] of checks) {
      const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true }).in("zoho_connection_id", ids);
      if (error) throw new Error(`Checking ${table} failed: ${error.message}`);
      if (count) out.push(`${count} ${label}`);
    }
    return out;
  },
};

registerConnector(zohoConnector);
