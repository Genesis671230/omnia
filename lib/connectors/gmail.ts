import { z } from "zod";
import { getJson, postForm } from "./http";
import { registerConnector } from "./registry";
import { GrantRevokedError, OAuthFlowError, type ConnectorDef, type Grant } from "./types";

/* Gmail, read-only, for payout-report ingestion. One connection per mailbox.
 * Google OAuth with PKCE; the mailbox address comes from the ID token (the
 * `openid email` scopes). Google does not rotate refresh tokens; a project
 * left in "Testing" publishing status expires them after 7 days, which shows
 * up here as invalid_grant → needs_reauth. */

export const GMAIL_SCOPES = "openid email https://www.googleapis.com/auth/gmail.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

const configSchema = z.object({
  ingest_queries: z.record(z.string()).default({}),
  labels: z.array(z.string()).default([]),
});
export type GmailConfig = z.infer<typeof configSchema>;

const secretsSchema = z.object({
  client_id: z.string().optional(), client_secret: z.string().optional(), refresh_token: z.string().optional(),
  access_token: z.string().optional(), access_token_expires_at: z.number().optional(), grant_id: z.string().optional(),
});
type GmailSecrets = z.infer<typeof secretsSchema>;

const REVOKED = new Set(["invalid_grant", "unauthorized_client", "invalid_client"]);

const grantOf = (json: any): Grant => ({
  accessToken: json.access_token,
  refreshToken: json.refresh_token,
  scopes: json.scope,
  expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
  raw: { id_token: json.id_token },
});

function emailFromIdToken(idToken: unknown): string {
  // The ID token comes straight from Google's token endpoint over TLS, so its
  // claims are trusted without checking the signature (OIDC Core §3.1.3.7).
  const part = String(idToken ?? "").split(".")[1];
  if (!part) throw new OAuthFlowError("no_accounts", "Google returned no ID token — the email scope is required");
  let claims: { email?: string; email_verified?: boolean };
  try {
    claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw new OAuthFlowError("no_accounts", "Google ID token could not be read");
  }
  if (!claims.email) throw new OAuthFlowError("no_accounts", "Google ID token has no email address");
  if (claims.email_verified === false) throw new OAuthFlowError("no_accounts", `${claims.email} is not a verified Google address`);
  return claims.email.toLowerCase();
}

export const gmailConnector: ConnectorDef<GmailConfig, GmailSecrets> = {
  provider: "gmail",
  label: "Gmail",
  category: "email",
  authModes: ["platform", "own_app"],
  grantTypes: { platform: ["authorization_code"], own_app: ["authorization_code"] },
  configSchema,
  secretsSchema,
  configFields: [{ key: "ingest_queries", label: "Search queries per gateway", kind: "json", help: '{"Tabby":"from:tabby subject:settlement"}' }],
  oauth: {
    authorizeUrl({ state, redirectUri, app, pkceChallenge }) {
      const q = new URLSearchParams({
        client_id: app.clientId, redirect_uri: redirectUri, response_type: "code", scope: GMAIL_SCOPES,
        access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
        ...(pkceChallenge ? { code_challenge: pkceChallenge, code_challenge_method: "S256" } : {}),
      });
      return `${AUTH_URL}?${q}`;
    },
    async exchangeCode({ code, redirectUri, app, pkceVerifier }) {
      const { status, json } = await postForm(TOKEN_URL, {
        code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code",
        ...(pkceVerifier ? { code_verifier: pkceVerifier } : {}),
      });
      if (!json?.access_token) throw new OAuthFlowError("exchange_failed", `Google code exchange failed HTTP ${status}: ${json?.error_description ?? json?.error ?? ""}`);
      if (!json.refresh_token) {
        throw new OAuthFlowError("exchange_failed", "Google returned no refresh token — remove the app at myaccount.google.com/permissions, then connect again");
      }
      return grantOf(json);
    },
    async refresh(secrets, _config, app) {
      const { status, json } = await postForm(TOKEN_URL, {
        refresh_token: secrets.refresh_token ?? "", client_id: app.clientId, client_secret: app.clientSecret, grant_type: "refresh_token",
      });
      if (json?.access_token) return grantOf(json);
      if (REVOKED.has(String(json?.error))) throw new GrantRevokedError(`Google: ${json.error_description ?? json.error}`);
      throw new Error(`Google token refresh failed HTTP ${status}: ${json?.error_description ?? json?.error ?? ""}`);
    },
    async revoke(secrets) {
      const token = secrets.refresh_token ?? secrets.access_token;
      if (token) await postForm(REVOKE_URL, { token });
    },
  },
  async accountsFromGrant(grant) {
    const email = emailFromIdToken(grant.raw.id_token);
    return [{ accountRef: email, label: email, config: {}, scopes: grant.scopes }];
  },
  async test(conn, token) {
    const { status, json } = await getJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", { Authorization: `Bearer ${token}` });
    if (status !== 200) return { ok: false, error: json?.error?.message ?? `HTTP ${status}` };
    const email = String(json.emailAddress ?? "").toLowerCase();
    if (email !== conn.accountRef.toLowerCase()) return { ok: false, error: `This token belongs to ${email}, not ${conn.accountRef}` };
    return { ok: true, accountName: email };
  },
  async onDisconnect(conn) {
    await gmailConnector.oauth!.revoke!(conn.secrets, conn.config);
  },
  async references() {
    return []; // ingest history never blocks removing a mailbox
  },
};

registerConnector(gmailConnector);
