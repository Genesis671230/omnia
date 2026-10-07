# Settings & Connections Foundation — Design

Date: 2026-10-07 · Status: draft for review · Sub-project 1+2 of the productization track

## 1. Why

Omnia Finance OS works, but every deployment is configured through ~120
`process.env` reads: Shopify stores (`SHOPIFY_STORE_CODES` + `SHOPIFY_<CODE>_URL/TOKEN`),
a Gmail refresh token pasted by hand from a console script, Zoho account ids,
sync intervals, feature flags. A second client means editing `.env` and
redeploying. That is the bottleneck to productizing.

**Outcome:** an admin can connect Zoho Books, any number of Gmail mailboxes and
any number of Shopify stores from **Settings**, by OAuth or with their own app
credentials, and manage every business setting there — no `.env` edits, no
redeploys. Omnia keeps running unchanged through the migration.

**Success criteria**
1. A fresh client copy (provisioned by `db/provision-client.mjs`) reaches a
   working order sync, Gmail payout ingest and Zoho connection using only the
   Settings UI.
2. Omnia's resolved Shopify stores, Gmail mailboxes and Zoho orgs after the
   migration are identical to what the env-based code resolves today.
3. After release 2, `process.env` is read only for the allowlist in §9; a lint
   rule enforces it.
4. Adding a provider later (Amazon, TikTok Shop, noon, gateways) is one file in
   `lib/connectors/` with no new tables, routes or Settings UI code.

## 2. Decisions taken (brainstorm, 2026-10-06/07)

| Decision | Choice |
|---|---|
| Deployment model | **Copy per client now, built for shared SaaS later.** Everything new is tenant-scoped; one tenant active per deployment. |
| OAuth app ownership | **Both, per connector.** "Connect with RAMZA" (our registered app) when available; "Use your own app credentials" always available. Both produce the same connection record. |
| First spec scope | **Foundation + Zoho, Gmail, Shopify (multi-store).** |
| Storage shape | **One generic `connections` table** + provider modules with zod-validated config, not per-provider tables. |
| Tenant column | Reuse the existing `tenant_id` (already on almost every table, default `'omnia'`). No new `workspace_id`. |
| First industry pack (later spec) | **Wholesale / distribution.** |

## 3. Scope

**In:** `connections`, `workspace_settings`, `oauth_states` tables; connector
interface + runtime; OAuth start/callback routes; Zoho, Gmail, Shopify
connectors; the env → DB importer; the Settings UI (Business profile,
Connections, Accounting, Sync & schedules, Advanced); the Orders preview tab in
the connection drawer; the module-toggle registry fed by the business profile;
moving all current callers to the runtime; the release-2 env lockdown.

**Out (own specs, in this order):**
- **P3 Gateways as settings** — gateway catalogue, per-gateway credentials
  (Stripe, Telr, Tabby, Tamara, Checkout), bank-narration rules as data instead
  of `lib/gateways.ts` code.
- **P4 Marketplaces** — Amazon SP-API, TikTok Shop, noon connectors (each needs
  developer / partner approval at the provider before code can talk to it).
- **P5 Documents & billing engine** — invoice, expense, credit note, sales
  return created from the portal, plus recurring invoices / bills / expenses
  and retainer invoices, on top of `lib/integrations/zoho-books-actions.ts`.
  Keeps the "post only on an explicit click" rule.
- **Team & roles** — real users replacing the shared `OMNIA_PW_*` passwords
  (note: `lib/auth-config.ts` currently falls back to hardcoded default
  passwords when the env var is unset; that spec must remove the fallback).
- **P7 Wholesale pack** — customer price lists, sales order → delivery note →
  invoice, credit terms/limits, statements and ageing. Construction and
  logistics packs follow.
- Turning on multi-tenant SaaS.

## 4. Data model

All DDL lands in `db/schema.sql` (idempotent `create table if not exists` /
`add column if not exists`) and `db/bootstrap.sql`, applied with
`node db/apply-schema.mjs`.

### 4.1 `connections`

```sql
create table if not exists connections (
  id               text primary key,          -- readable slug; migrated Zoho rows keep their id; env main org = 'env'
  tenant_id        text not null default 'omnia',
  provider         text not null,             -- 'zoho' | 'gmail' | 'shopify' | later 'amazon' | 'tiktok_shop' | 'noon' | gateways
  auth_mode        text not null,             -- 'platform' | 'own_app' | 'token'
  grant_type       text not null default 'authorization_code', -- | 'client_credentials' | 'static_token' | 'static_refresh'
  account_ref      text not null,             -- zoho org id | mailbox address | xxx.myshopify.com
  label            text not null,
  config           jsonb not null default '{}',   -- non-secret, validated by the provider's configSchema
  secrets_enc      text not null default '',      -- one encrypted JSON blob (secret-box v1 format)
  scopes           text not null default '',
  status           text not null default 'active', -- active | error | disabled | needs_reauth
  last_checked_at  timestamptz,
  last_synced_at   timestamptz,
  last_error       text not null default '',
  connected_by     text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, provider, account_ref)
);
create index if not exists connections_tenant_provider on connections (tenant_id, provider);
```

`secrets_enc` decrypts to the provider's `secretsSchema`, e.g.
`{ client_id?, client_secret?, refresh_token?, access_token?, access_token_expires_at?, webhook_secret?, grant_id? }`.
`grant_id` is a hash of the refresh token; connections sharing one grant (several
Zoho orgs from one login) carry the same value so a refresh or reconnect updates all of them.
`client_id` lives in secrets (not config) for own-app mode so the whole app
credential pair is replaced together. For platform mode the app credentials
come from the env allowlist (§9), never the row.

### 4.2 `workspace_settings`

```sql
create table if not exists workspace_settings (
  tenant_id   text not null default 'omnia',
  key         text not null,
  value       jsonb not null,
  updated_by  text not null default '',
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, key)
);
```

Keys are declared once in `lib/settings/registry.ts`:

```ts
type SettingDef<T> = {
  key: string;                 // 'sync.order_interval_minutes'
  group: "profile" | "accounting" | "sync" | "advanced";
  label: string; help?: string;
  schema: ZodType<T>;
  default: T;
  legacyEnv?: string;          // 'ORDER_SYNC_INTERVAL_MINUTES' — fallback in release 1, importer source
  parseEnv?: (raw: string) => T;
};
```

Writes with an unknown key or a value failing `schema` are rejected (400).
Business profile fields (`profile.legal_name`, `profile.trn`,
`profile.base_currency`, `profile.fiscal_year_end`, `profile.timezone`,
`profile.industries: string[]`, `profile.modules: Record<string, boolean>`)
and `app.public_url` are ordinary registry keys.

Initial registry (env keys moved in this spec): the `*_INTERVAL_MINUTES`
family, `CFO_DIGEST_HOUR_DUBAI`, `GROUP_SUMMARY_HOUR_DUBAI`,
`ZOHO_DAILY_BUDGET`, `ZOHO_FEE_ACCOUNT_ID`, `ZOHO_BANK_ACCOUNT_ID`,
`ZOHO_CLEARING_ACCOUNTS`, `ZOHO_EXPENSE_ACCOUNTS_BY_KIND`,
`ZOHO_DEFAULT_INCOME_ACCOUNT_ID`, `COD_PREPAID_ORDERS_ZOHO_ORG`,
`ORDERS_WA_COUNT_COD_AS_PAID`, `STOCK_WRITE_MODE`, `WOO_ORDER_SYNC`,
`SHOPIFY_API_VERSION`, `SHOPIFY_ANALYTICS_API_VERSION`, Zoho throttle tuning
(`ZOHO_MIN_GAP_MS`, `ZOHO_MAX_429_RETRIES`, …), `GOOGLE_SHEETS_*_SPREADSHEET_ID`,
`TELEGRAM_CHAT_ID` / `TELEGRAM_ALERT_CHAT_ID`, `FROM_EMAIL`. Where a value
already has a DB home (`zoho_account_config`, `payment_sheet_months`) that
table stays the source of truth and the registry entry only documents it.
Ads, Telr, Stripe, Woo, SMSA, Telegram bot and SendGrid credentials stay in env
until their connector spec (P3 / later); they are listed in the allowlist as
"pending connector", not as permanent.

### 4.3 `oauth_states`

```sql
create table if not exists oauth_states (
  state          text primary key,          -- 32 random bytes, base64url
  tenant_id      text not null,
  provider       text not null,
  auth_mode      text not null,
  pkce_verifier  text not null default '',
  pending_app_enc text not null default '',  -- own-app client id/secret, encrypted, until the callback
  params         jsonb not null default '{}', -- shop domain, zoho dc, reconnect_connection_id
  created_by     text not null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,       -- created_at + 10 min
  used_at        timestamptz
);
```

A state is valid once: the callback sets `used_at` in the same update that
checks it is null and unexpired. Rows older than a day are purged by the
scheduler.

### 4.4 `pending_grants`

When one grant yields several accounts (a Zoho login with three orgs), the
callback stores the grant encrypted in `pending_grants (id, tenant_id,
provider, grant_enc, accounts jsonb, created_by, expires_at)` (15 min) and
redirects to the Settings picker. Choosing accounts creates the connections
and deletes the row.

### 4.5 Existing tables

Unchanged, still keyed by connection id: `zoho_account_config.zoho_connection_id`,
`zoho_api_usage_org`, `statement_accounts.zoho_connection_id`,
`payouts.zoho_connection_id`, `settlement_records.zoho_connection_id`,
`order_adjustments.zoho_connection_id` (`'env'`), `zoho_action_log.connection_id`
(`'env'`), `zoho_records` / `zoho_sync_cursors`. `''` keeps meaning "the
tenant's default Zoho connection", resolved through the setting
`zoho.default_connection_id` (default `'env'`).

`stores` stays the store registry that `orders.store_id` references. A Shopify
connection carries `config.store_id`; `onConnect` upserts the `stores` row
(`store_id`, `platform='shopify'`, `domain`, `currency`, `timezone` read from
the shop).

`zoho_connections` becomes read-only in release 1 (importer source, nothing
writes it) and is dropped in release 2.

## 5. Connector interface — `lib/connectors/`

```
lib/connectors/
  types.ts         ConnectorDef, Grant, OAuthApp, DiscoveredAccount, errors
  registry.ts      provider -> ConnectorDef
  runtime.ts       list/get/getAccessToken/save/disable/remove
  oauth.ts         state create/consume, PKCE, redirect URI
  importer.ts      env + zoho_connections -> connections/workspace_settings
  zoho.ts  gmail.ts  shopify.ts
```

```ts
type AuthMode = "platform" | "own_app" | "token";

type Grant = {
  accessToken: string; expiresAt?: number; refreshToken?: string;
  scopes?: string; raw: Record<string, unknown>;        // e.g. Zoho api_domain, accounts-server
};
type OAuthApp = { clientId: string; clientSecret: string };
type DiscoveredAccount = { accountRef: string; label: string; config: Record<string, unknown> };

interface ConnectorDef<Config, Secrets> {
  provider: string;
  label: string;
  category: "accounting" | "email" | "store" | "marketplace" | "gateway" | "ads" | "courier";
  authModes: AuthMode[];
  configSchema: ZodType<Config>;
  secretsSchema: ZodType<Secrets>;
  /** Field metadata for the auto-generated config form. */
  configFields: { key: keyof Config & string; label: string; kind: "text" | "number" | "select" | "toggle" | "json"; options?: string[] }[];
  oauth?: {
    authorizeUrl(ctx: { state: string; redirectUri: string; app: OAuthApp; pkceChallenge?: string; params: Record<string, string> }): string;
    exchangeCode(ctx: { code: string; redirectUri: string; app: OAuthApp; pkceVerifier?: string; query: URLSearchParams }): Promise<Grant>;
    refresh(secrets: Secrets, config: Config, app: OAuthApp): Promise<Grant>;
    /** Client-credentials style providers (Shopify Dev Dashboard same-org apps). */
    clientCredentials?(app: OAuthApp, config: Config): Promise<Grant>;
    revoke?(secrets: Secrets, config: Config): Promise<void>;
  };
  accountsFromGrant(grant: Grant, app: OAuthApp, params: Record<string, string>): Promise<DiscoveredAccount[]>;
  test(conn: Connection<Config, Secrets>): Promise<{ ok: boolean; accountName?: string; scopes?: string; error?: string }>;
  onConnect?(conn: Connection<Config, Secrets>): Promise<void>;
  onDisconnect?(conn: Connection<Config, Secrets>): Promise<void>;
  /** Stores/marketplaces: live preview for the Orders tab. */
  listOrders?(conn: Connection<Config, Secrets>, opts: { since?: string; limit: number }): Promise<OrderRow[]>;
}
```

`OrderRow` is the existing type in `lib/normalize/order.ts`, so the preview and
the sync share one shape.

### 5.1 Runtime — `lib/connectors/runtime.ts`

- `listConnections(provider, { includeDisabled? })`, `getConnection(id)`:
  server-only, decrypt `secrets_enc`, parse with the provider schemas. A row
  that fails parsing is returned with `status: 'error'` and a reason, never
  thrown at list time.
- `getAccessToken(conn)`: in-process cache keyed by connection id; refresh
  60 s before `expiresAt`; a per-connection in-flight promise so concurrent
  callers share one refresh; rotated refresh/access tokens are written back
  (encrypted) before resolving. For `client_credentials` grants the same path
  calls `clientCredentials()` (Shopify tokens live 24 h).
- On `invalid_grant` / 401-revoked from a refresh: set
  `status='needs_reauth'`, `last_error`, send one Telegram alert per
  transition (not per call), throw `ReauthRequiredError(connectionId)`.
- `resolveApp(conn)`: platform mode → env allowlist credentials for that
  provider; own_app → decrypted `client_id`/`client_secret`. Missing platform
  credentials make the "Connect with RAMZA" button hidden for that provider.
- `currentTenant()`: replaces the 32 `process.env.DEFAULT_TENANT_ID` reads;
  returns `DEFAULT_TENANT_ID || 'omnia'` today — the single seam for
  multi-tenant later.

### 5.2 Callers moved to the runtime

| Today | After |
|---|---|
| `getShopifyStores()` (sync, env) — ~12 callers in `lib/sync/*`, `lib/payout-sync.ts`, `lib/zoho-sync.ts`, `lib/inventory-export.ts`, `lib/lookup-sku.ts`, `lib/channel-adapters/shopify.ts`, `lib/integrations/shopify*.ts`, `lib/integrations/ads/tracking-check.ts`, `app/api/integrations/{zoho,payouts}/route.ts` | `await listShopifyStores()` returning the same `ShopifyStoreConfig` shape (`code`, `url`, `token`) with `token` from `getAccessToken` |
| Shopify webhook secrets `SHOPIFY_<CODE>_WEBHOOK_SECRET` | the connection's app secret (or `secrets.webhook_secret` for legacy tokens, see §6.1); webhook route looks the connection up by `X-Shopify-Shop-Domain` |
| `gmailMailboxes()`, `refreshTokenFor()`, `getAccessToken(mailbox)` in `lib/integrations/gmail.ts` | same exported names, backed by `gmail` connections |
| `envConnection()`, `getZohoConnection()`, `listZohoConnections()`, `saveZohoConnection()` in `lib/integrations/zoho-org.ts` | same signatures, backed by `zoho` connections; `withZohoOrg` / `getScopedAccessToken` unchanged for callers |
| `process.env.X` business settings | `await getSetting('key')` (cached 30 s per process, invalidated on write) |

Release 1 keeps an env fallback inside each of these (DB first, then env);
release 2 deletes the fallback.

## 6. OAuth flow

Routes (all under the existing `/api` middleware session check):

- `POST /api/connections/[provider]/start` — `requireRole('admin')`. Body:
  `{ authMode, grantType?, ownApp?: { clientId, clientSecret }, params?: { shop?, dc?, reconnectId? } }`.
  Validates params (Shopify `shop` must match `^[a-z0-9][a-z0-9-]*\.myshopify\.com$`),
  creates the `oauth_states` row, returns `{ url }`. For `token` mode and
  `client_credentials` there is no redirect: the route validates, calls
  `test`, saves, and returns the connection.
- `GET /api/connections/[provider]/callback` — consumes the state (once,
  unexpired, matching provider); Shopify: verifies the `hmac` query param with
  the app secret and that `shop` equals the state's shop. Exchanges the code,
  runs `accountsFromGrant`. One account → upsert connection (or update the
  `reconnectId` row), `onConnect`, `test`, redirect to
  `/settings?tab=connections&connected=<id>`. Several → `pending_grants` and
  redirect to the picker. Any failure → redirect with `?error=<code>` and an
  `audit_logs` row; nothing written to `connections`.
- `POST /api/connections/pending/[id]` — picker submit: selected account refs →
  connections.
- `GET /api/connections` (status only, no secrets — any signed-in role),
  `PATCH /api/connections/[id]` (label, config, status), `POST
  /api/connections/[id]/test`, `POST /api/connections/[id]/sync`, `GET
  /api/connections/[id]/orders?limit=50`, `DELETE /api/connections/[id]` — all
  writes `requireRole('admin')`.
- `GET/PUT /api/settings` — registry-validated reads/writes, `requireRole('admin')`
  for writes.

Redirect URI: `${getSetting('app.public_url')}/api/connections/${provider}/callback`.
The Settings own-app form shows this exact URL to copy into the provider's
console.

### 6.1 Provider notes

**Zoho** — modes: platform, own_app (self-client / server-based client).
Authorize at the chosen DC's accounts server
(`accounts.zoho.com|.sa|.eu|.in|.com.au`), `access_type=offline`,
`prompt=consent`, scope `ZohoBooks.fullaccess.all` (narrower scope list
selectable later). The callback's `accounts-server` param overrides the DC;
the token response's `api_domain` is stored in config. Access token 1 h,
refresh token does not expire. `accountsFromGrant` = the existing
`discoverZohoOrgs` (GET `/organizations`) → one connection per selected org,
each holding the same refresh token. Existing paste-the-refresh-token flow in
`ZohoOrgsPanel` stays as own_app with a pre-made token (`grant_type
static_refresh`) for clients who already have a self-client token.
Config: `accounts_url`, `api_domain`, `org_name`, `daily_budget`,
`default_for_providers: string[]`.

**Gmail** — modes: platform, own_app. Google authorize with
`access_type=offline`, `prompt=consent`, PKCE (S256), scope
`https://www.googleapis.com/auth/gmail.readonly` plus `openid email` to learn
the mailbox address (`accountsFromGrant` reads it from the ID token). The
own-app form warns: a Google Cloud project left in **Testing** publishing
status issues refresh tokens that expire after 7 days — set it to **In
production** (an **Internal** app on Google Workspace needs no Google
verification). Platform mode requires our Google app to pass restricted-scope
verification; until then the platform button is hidden for Gmail.
Config: `ingest_queries` (today's per-gateway search strings), `labels`.
`onDisconnect` revokes via `https://oauth2.googleapis.com/revoke`.

**Shopify** — one connection per store. Modes:
- `platform`: our app, authorization-code grant → non-expiring offline token.
- `own_app` + authorization code: the client's Dev Dashboard app, same flow.
- `own_app` + `client_credentials`: Dev Dashboard app owned by the same
  organisation as the store; no consent screen; token expires every 24 h and
  is re-fetched by the runtime.
- `token`: existing `shpat_` legacy custom-app tokens (still valid; Shopify
  stopped allowing *new* legacy custom apps on 2026-01-01).

Scopes: `read_orders, read_all_orders, read_products, read_inventory,
write_inventory, read_customers, read_shopify_payments_payouts, read_reports`
(the last two are the scopes currently missing on UAE/KSA). `test` reads
`shop { name currencyCode ianaTimezone }` and the granted scopes, and reports
missing ones by name. `onConnect` upserts `stores` and registers the order
webhooks. Shopify signs webhooks with the app's secret: for platform and
own-app connections that is the client secret; for `token` (legacy custom app)
connections the admin pastes the app's API secret key into
`secrets.webhook_secret`, replacing `SHOPIFY_<CODE>_WEBHOOK_SECRET`. The webhook
route finds the connection by `X-Shopify-Shop-Domain` and verifies with that. `listOrders` reuses the
existing GraphQL `ORDERS_QUERY` and `normalizeShopifyOrder`.
Config: `store_id`, `api_version`, `webhook_topics`.

## 7. Settings UI

`/settings` (still rendered via `FinanceWorkspace view="settings"`), tabs:

| Tab | Content |
|---|---|
| Business profile | `profile.*` keys; industries multi-select applies a module preset; per-module toggles below |
| Connections | Cards grouped by category; status pill, account, last sync, scopes, Test / Reconnect / Disable / Remove; **Add connection** catalogue showing built providers and greyed "coming soon" ones (Amazon, TikTok Shop, noon) |
| Accounting | Existing `ZohoSettingsPanel` + `ZohoOrgsPanel` content (account mappings per org, gateway → org) |
| Sync & schedules | `sync.*` keys |
| Team & roles | Placeholder card linking to its own spec |
| Advanced | `PaymentSheetMonthsPanel`, flags |

Non-admin roles see Connections status read-only and nothing else.

**Connection drawer:** generated config form (from `configFields`), secrets
shown only as "•••• set <date> by <user>" with a Replace action, scopes with
missing ones highlighted, last error, and per-category tabs:
- Store / marketplace → **Orders**: live `listOrders` (latest 50) beside the
  count already in `orders` for that `store_id`, rows flagged "not in our DB",
  and **Sync now**.
- Zoho → orgs, today's API usage vs budget, account mapping for that org.
- Gmail → last 20 `payout_email_ingests` rows for the mailbox.

**Settings fields** show their source badge: **Database**, **.env fallback**
(release 1 only), **Default**. Every write appends to `audit_logs`
(`entity='setting'|'connection'`, payload = key and old/new value with secrets
redacted).

**Modules:** `lib/modules.ts` declares `{ id, label, nav, presetFor: industry[] }`.
The nav in `finance-workspace.tsx` hides items whose module is off. The
e-commerce preset enables every module that exists today, so Omnia's nav is
unchanged. Wholesale / construction / logistics modules are declared by their
own specs.

Visual style follows the existing finance workspace (blue page, white cards,
ink figures; colour only for status) — see memory "Blue dashboard theme".

## 8. Rollout

1. **Release 1 — tables + importer + DB-first reads with env fallback.**
   `lib/connectors/importer.ts` runs once at boot from `instrumentation.ts`
   (and as `node db/import-connections.mjs`). Idempotent: upserts on
   `(tenant_id, provider, account_ref)` and never overwrites a row whose
   `updated_at` is newer than its `created_at` (i.e. edited in the UI).
   Sources: `zoho_connections` rows (ids kept) + env main org (id `env`);
   `SHOPIFY_STORE_CODES` stores (`token` mode, id `shopify-<code>`); `GMAIL_USER`
   mailboxes (`own_app`, app from `GMAIL_CLIENT_ID/SECRET`, id
   `gmail-<slug>`); registry `legacyEnv` values into `workspace_settings`.
2. **Verify on live data**, no Zoho writes: `node db/verify-connections.mjs`
   prints, per provider, env-resolved vs DB-resolved accounts and settings and
   exits non-zero on any difference. Then one order sync, one Gmail ingest and
   Zoho posting dry-runs through the DB path.
3. **Release 2 — remove the fallback.** Delete env branches; drop
   `zoho_connections`; add an ESLint `no-restricted-properties` rule on
   `process.env` with the allowlist file `lib/env-allowlist.ts` as the only
   exempt module.
4. **Provisioning:** `db/provision-client.mjs` stops writing business keys to
   `.env`; it writes `app.public_url` and the tenant id only.

## 9. Env allowlist (permanent)

`SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`CONNECTIONS_KEY` (accepts legacy `ZOHO_CREDENTIALS_KEY`),
`OMNIA_SESSION_SECRET`, `ANTHROPIC_API_KEY`, `DEFAULT_TENANT_ID`,
`NODE_ENV`, `NEXT_RUNTIME`, platform OAuth apps (`PLATFORM_ZOHO_CLIENT_ID/SECRET`,
`PLATFORM_GOOGLE_CLIENT_ID/SECRET`, `PLATFORM_SHOPIFY_CLIENT_ID/SECRET`), the
RAMZA marketing `NEXT_PUBLIC_*` build-time values, and debug flags
(`HMAC_DEBUG`, `CLOBBER_DEBUG`, `RECON_TIMING`).

**Pending connector (temporary, listed separately):** Telr, Stripe, Woo, ads
(Meta/TikTok/Snap/Google Ads), SMSA, Telegram bots, SendGrid, Google service
account, `OMNIA_PW_*`. Each moves out in its own spec.

## 10. Error handling

| Situation | Behaviour |
|---|---|
| Refresh rejected (revoked / expired grant) | `needs_reauth`, one Telegram alert per transition, Reconnect banner in Settings and on affected screens; schedulers skip that connection and record it in `sync_runs`; other connections continue |
| Provider down / rate-limited | Existing backoff (Shopify throttle, Zoho 429 pacing); status stays `active`; `last_error` + `sync_runs` record it |
| Bad / expired / replayed state, bad Shopify HMAC, shop mismatch | 400 → redirect with error code, `audit_logs` row, nothing written |
| Config or secrets fail schema parse | Row reported as `error` with the field name; not thrown at list time |
| `CONNECTIONS_KEY` missing or wrong length | Boot fails with an explicit message; key rotation procedure documented in the client runbook |
| Remove a connection still referenced (payouts, settlements, statement accounts, `zoho_account_config`) | 409 listing the references; only Disable is offered |
| A screen whose data comes from a `needs_reauth` connection | Shows "Reconnect <label>" — never an empty dataset or zero totals |

## 11. Testing

- **Provider contract tests** (`tests/connectors/<provider>.test.ts`, mocked
  `fetch`): authorize URL params, code exchange, refresh, client-credentials
  (Shopify), account discovery (Zoho multi-org, Gmail email from ID token,
  Shopify shop), revoked-token → `ReauthRequiredError`.
- **Runtime:** N concurrent `getAccessToken` calls → one refresh; rotated
  tokens persisted; `needs_reauth` alert sent once per transition.
- **OAuth state:** expired, replayed, wrong provider, Shopify HMAC tamper, shop
  mismatch.
- **Settings registry:** unknown key rejected, schema validation, DB → env →
  default resolution order.
- **Importer:** run twice → no changes; UI-edited row not overwritten; a fixture
  copy of Omnia's env resolves to exactly the same stores, mailboxes and orgs
  as `getShopifyStores()` / `gmailMailboxes()` / `envConnection()` today.
- **Manual live check:** OAuth-connect one Shopify store, one Gmail mailbox and
  the Zoho org in own-app mode; each drawer tab shows live data; one order sync
  and one Gmail ingest succeed through the DB path.

## 12. Risks

- **Google restricted-scope verification** for platform-mode Gmail can take
  weeks and requires a security assessment; own-app mode is the path until it
  clears.
- **Shopify platform app** needs App Store review only if listed publicly; an
  unlisted app installed by link is enough for clients we onboard ourselves.
- **Async `listShopifyStores()`** touches ~12 call sites including schedulers;
  each move is mechanical but must be covered by the importer equivalence test
  before release 2.
- **Shared refresh token across Zoho orgs:** reconnecting one org must update
  every connection holding the same grant; the runtime updates by grant
  fingerprint, not by row.
