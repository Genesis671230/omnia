import type { ZodType } from "zod";
import type { OrderRow } from "@/lib/normalize/order";

/* Shared vocabulary for every connector (Zoho, Gmail, Shopify, and later
 * marketplaces and gateways). A provider is one ConnectorDef; the runtime in
 * ./runtime.ts owns storage, token refresh and re-auth for all of them. */

export type AuthMode = "platform" | "own_app" | "token";
export type GrantType = "authorization_code" | "client_credentials" | "static_token" | "static_refresh";
export type ConnectionStatus = "active" | "error" | "disabled" | "needs_reauth";
export type Category = "accounting" | "email" | "store" | "marketplace" | "gateway" | "ads" | "courier";

export type Grant = {
  accessToken: string;
  /** epoch ms; undefined = does not expire (Shopify offline token). */
  expiresAt?: number;
  refreshToken?: string;
  scopes?: string;
  raw: Record<string, unknown>;
};
export type OAuthApp = { clientId: string; clientSecret: string };
export type DiscoveredAccount = { accountRef: string; label: string; config: Record<string, unknown>; scopes?: string };

export type BaseSecrets = {
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  access_token?: string;
  access_token_expires_at?: number;
  webhook_secret?: string;
  /** sha256 of the refresh token — rows sharing one grant (Zoho orgs) refresh together. */
  grant_id?: string;
};

export type Connection<C = Record<string, unknown>, S extends BaseSecrets = BaseSecrets> = {
  id: string;
  tenantId: string;
  provider: string;
  authMode: AuthMode;
  grantType: GrantType;
  accountRef: string;
  label: string;
  config: C;
  secrets: S;
  scopes: string;
  status: ConnectionStatus;
  lastCheckedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string;
  connectedBy: string;
  createdAt: string;
  updatedAt: string;
  /** Set when config/secrets failed schema parsing; status is then "error". */
  parseError?: string;
};

export type PublicConnection = Omit<Connection, "secrets"> & { hasSecrets: boolean; category: Category; providerLabel: string };

export type ConfigField = { key: string; label: string; kind: "text" | "number" | "select" | "toggle" | "json"; options?: string[]; help?: string };

export interface ConnectorDef<C = any, S extends BaseSecrets = BaseSecrets> {
  provider: string;
  label: string;
  category: Category;
  authModes: AuthMode[];
  /** Grant types allowed per auth mode; first is the default. */
  grantTypes: Partial<Record<AuthMode, GrantType[]>>;
  configSchema: ZodType<C>;
  secretsSchema: ZodType<S>;
  configFields: ConfigField[];
  /** Which `params` the start form must collect (e.g. shop + store code, Zoho data centre). */
  startParams?: { key: string; label: string; pattern?: string; options?: string[] }[];
  oauth?: {
    authorizeUrl(ctx: { state: string; redirectUri: string; app: OAuthApp; pkceChallenge?: string; params: Record<string, string> }): string;
    exchangeCode(ctx: { code: string; redirectUri: string; app: OAuthApp; pkceVerifier?: string; query: URLSearchParams; params: Record<string, string> }): Promise<Grant>;
    refresh(secrets: S, config: C, app: OAuthApp): Promise<Grant>;
    clientCredentials?(app: OAuthApp, config: C, params: Record<string, string>): Promise<Grant>;
    revoke?(secrets: S, config: C): Promise<void>;
  };
  /** Throws OAuthFlowError when the callback is not authentic (Shopify HMAC). */
  verifyCallback?(query: URLSearchParams, app: OAuthApp, params: Record<string, string>): void;
  accountsFromGrant(grant: Grant, app: OAuthApp, params: Record<string, string>): Promise<DiscoveredAccount[]>;
  test(conn: Connection<C, S>, accessToken: string): Promise<{ ok: boolean; accountName?: string; scopes?: string; missingScopes?: string[]; error?: string }>;
  onConnect?(conn: Connection<C, S>, accessToken: string): Promise<void>;
  onDisconnect?(conn: Connection<C, S>, accessToken: string): Promise<void>;
  /** Rows elsewhere that point at this connection; non-empty blocks delete. */
  references?(conn: Connection<C, S>): Promise<string[]>;
  listOrders?(conn: Connection<C, S>, accessToken: string, opts: { since?: string; limit: number }): Promise<OrderRow[]>;
}

/** Thrown BY CONNECTORS when the provider says the grant is dead. */
export class GrantRevokedError extends Error {}

/** Thrown BY THE RUNTIME to callers: this connection needs the user to reconnect. */
export class ReauthRequiredError extends Error {
  constructor(public connectionId: string, message: string) {
    super(message);
  }
}

export type OAuthErrorCode =
  | "state_invalid" | "state_expired" | "state_used" | "state_user_mismatch" | "provider_mismatch"
  | "bad_host" | "bad_hmac" | "denied" | "exchange_failed" | "no_accounts" | "bad_request" | "no_app";

export class OAuthFlowError extends Error {
  constructor(public code: OAuthErrorCode, message: string) {
    super(message);
  }
}
