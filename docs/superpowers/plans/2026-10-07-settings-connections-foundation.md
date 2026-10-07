# Settings & Connections Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `.env`-driven configuration with a tenant-scoped `connections` + `workspace_settings` model, OAuth/own-app/token connect flows for Zoho Books, Gmail and Shopify (multi-store), and a Settings UI — without breaking Omnia's live syncs.

**Architecture:** One generic `connections` table (encrypted secrets, zod-validated config) behind a provider-agnostic runtime (`lib/connectors/runtime.ts`) that owns token refresh, re-auth detection and persistence. Providers are single files implementing `ConnectorDef`. A typed settings registry resolves DB → env (release 1 only) → default. Existing call sites keep their exported names; only their backend changes.

**Tech Stack:** Next.js (app router) · TypeScript · Supabase (PostgREST via `@/lib/supabase`) · zod 3.25 · node:test via `tsx --test` · AES-256-GCM secret box.

**Spec:** `docs/superpowers/specs/2026-10-07-settings-connections-foundation-design.md`

## Global Constraints

- Tenant column is the existing `tenant_id` (default `'omnia'`); no `workspace_id`. Read it only through `currentTenant()`.
- Existing Zoho connection ids are preserved; the env main org becomes connection id `env`; `''` means "default Zoho connection" via setting `zoho.default_connection_id` (default `'env'`).
- `stores` stays the store registry; `orders.store_id` FK is untouched. `stores.id` has no default — insert with `crypto.randomUUID()`.
- Secrets never leave the server: no API returns `secrets`, `secrets_enc`, client secrets or tokens. UI shows "•••• set <date> by <user>".
- Every connection/setting write requires `requireRole("admin")` and appends to `audit_logs` (secrets redacted).
- Encryption key env: `CONNECTIONS_KEY` (32 bytes base64), legacy `ZOHO_CREDENTIALS_KEY` accepted.
- Shopify `shop` must match `^[a-z0-9][a-z0-9-]*\.myshopify\.com$`. Zoho accounts server must match `^https://accounts\.zoho\.[a-z.]+$`.
- OAuth state: single use, 10-minute TTL. Pending grants: 15-minute TTL.
- Release 1 keeps an env fallback everywhere (DB first). Release 2 (Task 17) removes it. No Zoho writes during verification.
- Schema changes go in `db/schema.sql` **and** `db/bootstrap.sql`, then `node db/apply-schema.mjs` (editing the file alone does not touch the live DB).
- Follow existing UI style: blue page, white cards, ink figures, colour only for status (hex values as in `components/finance/zoho/zoho-orgs-panel.tsx`).
- Tests: `node:test` + `node:assert/strict`, files under `tests/**`, run with `npm test` or `npx tsx --test <file>`.
- **Tests compile as CommonJS — top-level `await` is a transform error.** Where a test below shows `const x = await import("…")`, write a static `import` instead and set env vars at module top after the imports (every module in this plan reads env lazily, at call time). Module-level constants that read env at import are the exception: set those vars in the npm script / a `--import` preload, or restructure the constant into a getter.

**Spec deviations (forced by the codebase, apply everywhere):**
1. OAuth routes live at `/api/connections/oauth/[provider]/start|callback` (not `/api/connections/[provider]/…`) because Next.js forbids sibling dynamic segments `[provider]` and `[id]` under `/api/connections`. Redirect URI = `${app.public_url}/api/connections/oauth/${provider}/callback`.
2. `db/provision-client.mjs` never wrote `.env`; Task 17 instead makes it seed `app.public_url` + tenant into `workspace_settings` from CLI flags.
3. Importer/verify scripts are TypeScript run with `npx tsx db/<name>.ts` (they import `lib/`).
4. `ConnectorDef` gains two optional members not in the spec: `verifyCallback` (Shopify HMAC) and `references` (delete guard).

## Review Focus

1. **Zoho/Shopify callback host injection** — a forged `accounts-server` or `shop` param must never receive our client secret or code; expect `OAuthFlowError("bad_host")` before any token request (tests in Tasks 7, 9).
2. **Concurrent refresh after restart** — 10 parallel `getAccessToken` calls with an empty cache and an expired persisted token must issue exactly one refresh and persist once (Task 5).
3. **A revoked grant during a scheduler run** — one connection in `needs_reauth` must not abort sync for other stores/mailboxes; expect the loop to skip it and record the error (Task 14 test on `listShopifyStores` + order-sync loop).
4. **Importer re-run after UI edits** — running the importer again must not overwrite a label/config edited in Settings (Task 11).
5. **Callback replayed or opened by a different admin** — reused state → `state_used`; state created by user A consumed by user B → `state_user_mismatch` (Task 6).

---

## File Structure

```
lib/tenant.ts                      currentTenant()
lib/audit.ts                       writeAudit()
lib/crypto/secret-box.ts           + CONNECTIONS_KEY, encryptJson/decryptJson
lib/settings/registry.ts           SettingDef list (keys, schema, default, legacyEnv)
lib/settings/backend.ts            SettingsBackend: supabase + memory
lib/settings/index.ts              getSetting/peekSetting/setSetting/describeSettings/loadSettings
lib/connectors/types.ts            shared types + errors
lib/connectors/store.ts            ConnectionStore: supabase + memory
lib/connectors/registry.ts         provider -> ConnectorDef
lib/connectors/runtime.ts          list/get/save/update/remove/test/getAccessToken
lib/connectors/oauth.ts            state/PKCE/pending-grant stores, HMAC, redirectUri
lib/connectors/flow.ts             startConnect / completeCallback / completePending
lib/connectors/http.ts             postForm/getJson helpers
lib/connectors/zoho.ts | gmail.ts | shopify.ts
lib/connectors/importer.ts         env + zoho_connections -> DB
lib/modules.ts                     module registry + industry presets
db/import-connections.ts           CLI wrapper for importer
db/verify-connections.ts           env vs DB diff (exit 1 on mismatch)
app/api/connections/route.ts                       GET list (public)
app/api/connections/[id]/route.ts                  PATCH / DELETE
app/api/connections/[id]/test/route.ts             POST
app/api/connections/[id]/sync/route.ts             POST
app/api/connections/[id]/orders/route.ts           GET
app/api/connections/oauth/[provider]/start/route.ts    POST
app/api/connections/oauth/[provider]/callback/route.ts GET
app/api/connections/pending/[id]/route.ts          GET / POST
app/api/settings/route.ts                          GET / PUT
components/settings/*.tsx          Settings UI
tests/connectors/*.test.ts, tests/settings/*.test.ts
```

---

### Task 1: Schema — connections, workspace_settings, oauth_states, pending_grants

**Files:**
- Modify: `db/schema.sql` (append at end)
- Modify: `db/bootstrap.sql` (append the same block at end)
- Test: `tests/connectors/schema.test.ts`

**Interfaces:**
- Produces: tables `connections`, `workspace_settings`, `oauth_states`, `pending_grants` exactly as below; later tasks select/insert these column names.

- [ ] **Step 1: Write the failing test** (guards that both SQL files carry the same DDL — provisioning uses bootstrap, live uses schema)

```ts
// tests/connectors/schema.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const TABLES = ["connections", "workspace_settings", "oauth_states", "pending_grants"];

for (const file of ["db/schema.sql", "db/bootstrap.sql"]) {
  test(`${file} creates the connection tables`, () => {
    const sql = readFileSync(file, "utf8");
    for (const t of TABLES) assert.match(sql, new RegExp(`create table if not exists ${t} \\(`), `${t} missing in ${file}`);
    assert.match(sql, /unique \(tenant_id, provider, account_ref\)/);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/connectors/schema.test.ts`
Expected: FAIL — `connections missing in db/schema.sql`

- [ ] **Step 3: Append DDL to both files**

```sql
-- ── Settings & connections foundation (2026-10-07) ─────────────────────────
-- docs/superpowers/specs/2026-10-07-settings-connections-foundation-design.md
create table if not exists connections (
  id               text primary key,
  tenant_id        text not null default 'omnia',
  provider         text not null,
  auth_mode        text not null,
  grant_type       text not null default 'authorization_code',
  account_ref      text not null,
  label            text not null,
  config           jsonb not null default '{}',
  secrets_enc      text not null default '',
  scopes           text not null default '',
  status           text not null default 'active',
  last_checked_at  timestamptz,
  last_synced_at   timestamptz,
  last_error       text not null default '',
  connected_by     text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, provider, account_ref)
);
create index if not exists connections_tenant_provider on connections (tenant_id, provider);

create table if not exists workspace_settings (
  tenant_id   text not null default 'omnia',
  key         text not null,
  value       jsonb,                      -- NULL = explicitly "use the built-in default"
  updated_by  text not null default '',
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, key)
);

create table if not exists oauth_states (
  state            text primary key,
  tenant_id        text not null,
  provider         text not null,
  auth_mode        text not null,
  pkce_verifier    text not null default '',
  pending_app_enc  text not null default '',
  params           jsonb not null default '{}',
  created_by       text not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  used_at          timestamptz
);

create table if not exists pending_grants (
  id          text primary key,
  tenant_id   text not null,
  provider    text not null,
  auth_mode   text not null,
  grant_enc   text not null,
  accounts    jsonb not null default '[]',
  params      jsonb not null default '{}',
  created_by  text not null,
  expires_at  timestamptz not null
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/connectors/schema.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Apply to the live DB and confirm**

Run: `node db/apply-schema.mjs && node -e "require('dotenv/config');const pg=require('pg');const c=new pg.Client({connectionString:process.env.DIRECT_URL||process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query(\"select table_name from information_schema.tables where table_name in ('connections','workspace_settings','oauth_states','pending_grants')\")).then(r=>{console.log(r.rows.map(x=>x.table_name).sort().join(','));return c.end()})"`
Expected: `connections,oauth_states,pending_grants,workspace_settings`

- [ ] **Step 6: Commit**

```bash
git add db/schema.sql db/bootstrap.sql tests/connectors/schema.test.ts
git commit -m "feat(connections): schema for connections, workspace settings, oauth states"
```

---

### Task 2: Secret box JSON helpers, tenant helper, audit helper

**Files:**
- Modify: `lib/crypto/secret-box.ts` (function `key()` + two new exports)
- Create: `lib/tenant.ts`, `lib/audit.ts`
- Modify: every file containing `process.env.DEFAULT_TENANT_ID || "omnia"` (32 occurrences)
- Test: `tests/connectors/secret-box.test.ts`

**Interfaces:**
- Produces: `encryptJson(value: unknown): string`, `decryptJson<T>(stored: string): T`, `currentTenant(): string`, `writeAudit(e: { entity: string; entityId: string; event: string; actor: string; payload: Record<string, unknown> }): Promise<void>`, `redactSecrets(obj: Record<string, unknown>): Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/connectors/secret-box.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.CONNECTIONS_KEY = randomBytes(32).toString("base64");
delete process.env.ZOHO_CREDENTIALS_KEY;

const { encryptJson, decryptJson, encryptSecret, decryptSecret } = await import("@/lib/crypto/secret-box");
const { redactSecrets } = await import("@/lib/audit");

test("JSON round-trips through the box", () => {
  const v = { refresh_token: "r1", nested: { a: 1 } };
  const enc = encryptJson(v);
  assert.match(enc, /^v1:/);
  assert.deepEqual(decryptJson(enc), v);
});

test("CONNECTIONS_KEY is used; legacy ZOHO_CREDENTIALS_KEY still decrypts old values", () => {
  const enc = encryptSecret("x");
  const saved = process.env.CONNECTIONS_KEY!;
  delete process.env.CONNECTIONS_KEY;
  process.env.ZOHO_CREDENTIALS_KEY = saved;
  assert.equal(decryptSecret(enc), "x");
  process.env.CONNECTIONS_KEY = saved;
  delete process.env.ZOHO_CREDENTIALS_KEY;
});

test("redactSecrets masks secret-looking keys at any depth", () => {
  assert.deepEqual(
    redactSecrets({ label: "a", client_secret: "s", secrets: { refresh_token: "t" }, nested: { access_token: "z", ok: 1 } }),
    { label: "a", client_secret: "••••", secrets: "••••", nested: { access_token: "••••", ok: 1 } },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/connectors/secret-box.test.ts`
Expected: FAIL — `encryptJson` is not exported / `@/lib/audit` not found

- [ ] **Step 3: Implement**

In `lib/crypto/secret-box.ts` replace `key()` and append the JSON helpers:

```ts
function key(): Buffer {
  const raw = process.env.CONNECTIONS_KEY || process.env.ZOHO_CREDENTIALS_KEY;
  if (!raw) throw new Error("CONNECTIONS_KEY is not set — required to store or read connection secrets");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("CONNECTIONS_KEY must be 32 bytes, base64-encoded");
  return k;
}
```

```ts
/** Encrypt a whole JSON value (a connection's secrets blob). */
export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T>(stored: string): T {
  return JSON.parse(decryptSecret(stored)) as T;
}
```

Update the header comment's key line to `Key: CONNECTIONS_KEY (legacy name ZOHO_CREDENTIALS_KEY still accepted)`.

```ts
// lib/tenant.ts
/** The tenant every query is scoped to. One tenant per deployment today; the
 *  single seam where a request-scoped tenant plugs in for shared SaaS later. */
export function currentTenant(): string {
  return process.env.DEFAULT_TENANT_ID || "omnia";
}
```

```ts
// lib/audit.ts
import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/supabase";
import { currentTenant } from "@/lib/tenant";

const SECRET_KEY = /secret|token|password|secrets/i;

/** Copy of `obj` with every secret-looking key replaced by "••••". */
export function redactSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY.test(k)) out[k] = "••••";
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = redactSecrets(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

/** Append one row to audit_logs. Never throws — an audit failure is logged,
 *  not allowed to undo the change it describes. */
export async function writeAudit(e: { entity: string; entityId: string; event: string; actor: string; payload: Record<string, unknown> }): Promise<void> {
  const { error } = await supabase.from("audit_logs").insert({
    id: randomUUID(),
    tenant_id: currentTenant(),
    entity: e.entity,
    entity_id: e.entityId,
    event: e.event,
    actor_id: e.actor,
    payload: redactSecrets(e.payload),
  });
  if (error) console.error(`[audit] ${e.entity}/${e.entityId} ${e.event} not recorded: ${error.message}`);
}
```

- [ ] **Step 4: Replace the 32 tenant reads**

Run:
```bash
grep -rl 'process.env.DEFAULT_TENANT_ID || "omnia"' lib app components | while read f; do
  sed -i '' 's/process\.env\.DEFAULT_TENANT_ID || "omnia"/currentTenant()/g' "$f"
  grep -q 'from "@/lib/tenant"' "$f" || sed -i '' '1,/^import /{/^import /i\
import { currentTenant } from "@/lib/tenant";
}' "$f"
done
grep -rn "DEFAULT_TENANT_ID" lib app components | grep -v "lib/tenant.ts"
```
Expected: last grep prints nothing. Open two of the changed files and confirm the import landed above the first import (files starting with a `"use client"` directive must keep it on line 1 — if any such file was touched, move the import below the directive by hand).

- [ ] **Step 5: Run tests and typecheck**

Run: `npx tsx --test tests/connectors/secret-box.test.ts && npx tsc --noEmit -p .`
Expected: 3 tests PASS; tsc reports no new errors (compare count with `git stash; npx tsc --noEmit -p . | grep -c error; git stash pop` if the tree already had errors — memory notes 2 pre-existing build breakers).

- [ ] **Step 6: Commit**

```bash
git add lib/crypto/secret-box.ts lib/tenant.ts lib/audit.ts tests/connectors/secret-box.test.ts $(git diff --name-only | grep -E '^(lib|app|components)/')
git commit -m "feat(connections): JSON secret box, currentTenant(), audit helper"
```

---

### Task 3: Settings registry and resolver

**Files:**
- Create: `lib/settings/registry.ts`, `lib/settings/backend.ts`, `lib/settings/index.ts`
- Test: `tests/settings/settings.test.ts`

**Interfaces:**
- Consumes: `currentTenant()`, `writeAudit()` (Task 2)
- Produces:
  - `type SettingSource = "database" | "env" | "default"`
  - `getSetting<T = unknown>(key: string): Promise<T>`
  - `peekSetting<T = unknown>(key: string): T` (sync; last loaded snapshot → env → default)
  - `loadSettings(force?: boolean): Promise<void>`
  - `setSetting(key: string, value: unknown, actor: string): Promise<void>` (throws `SettingError`)
  - `describeSettings(): Promise<{ key; group; label; help?; kind; value; source: SettingSource; legacyEnv?: string }[]>`
  - `setSettingsBackend(b: SettingsBackend): void`, `memorySettingsBackend(): SettingsBackend`
  - `ENV_FALLBACK` constant (true in release 1)

- [ ] **Step 1: Write the failing test**

```ts
// tests/settings/settings.test.ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getSetting, peekSetting, setSetting, describeSettings, loadSettings,
  setSettingsBackend, memorySettingsBackend, SettingError,
} from "@/lib/settings";

beforeEach(async () => {
  setSettingsBackend(memorySettingsBackend());
  delete process.env.ORDER_SYNC_INTERVAL_MINUTES;
  await loadSettings(true);
});

test("default when neither DB nor env has a value", async () => {
  assert.equal(await getSetting("sync.order_interval_minutes"), null);
  assert.equal(await getSetting("profile.base_currency"), "AED");
});

test("env fallback is parsed with the registry's parser", async () => {
  process.env.ORDER_SYNC_INTERVAL_MINUTES = "7";
  await loadSettings(true);
  assert.equal(await getSetting("sync.order_interval_minutes"), 7);
  const d = (await describeSettings()).find((s) => s.key === "sync.order_interval_minutes")!;
  assert.equal(d.source, "env");
});

test("database beats env", async () => {
  process.env.ORDER_SYNC_INTERVAL_MINUTES = "7";
  await setSetting("sync.order_interval_minutes", 3, "test");
  assert.equal(await getSetting("sync.order_interval_minutes"), 3);
  assert.equal(peekSetting("sync.order_interval_minutes"), 3);
});

test("unknown key and invalid value are rejected", async () => {
  await assert.rejects(setSetting("nope.key", 1, "t"), SettingError);
  await assert.rejects(setSetting("sync.order_interval_minutes", -5, "t"), SettingError);
  await assert.rejects(setSetting("profile.base_currency", "dirhams", "t"), SettingError);
});

test("peekSetting works before any load (env/default only)", () => {
  assert.equal(peekSetting("profile.timezone"), "Asia/Dubai");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/settings/settings.test.ts`
Expected: FAIL — cannot find module `@/lib/settings`

- [ ] **Step 3: Implement the registry**

```ts
// lib/settings/registry.ts
import { z, type ZodType } from "zod";

export type SettingGroup = "profile" | "accounting" | "sync" | "advanced";
export type SettingKind = "text" | "number" | "toggle" | "select" | "json" | "tags";

export type SettingDef<T = unknown> = {
  key: string;
  group: SettingGroup;
  label: string;
  help?: string;
  kind: SettingKind;
  options?: string[];
  schema: ZodType<T>;
  default: T;
  /** Release 1 fallback + importer source. */
  legacyEnv?: string;
  parseEnv?: (raw: string) => T;
};

const int = (raw: string) => {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};
const bool = (raw: string) => raw.trim().toLowerCase() === "true";
const json = (raw: string) => JSON.parse(raw);
const minutes = z.number().int().positive().nullable();
const hour = z.number().int().min(0).max(23).nullable();

/** Every setting this app knows. A key not listed here cannot be written. */
export const SETTINGS: SettingDef<any>[] = [
  // ── profile ─────────────────────────────────────────────────────────
  { key: "app.public_url", group: "profile", label: "Public URL of this app", help: "Used to build OAuth redirect and webhook URLs.", kind: "text", schema: z.string().url(), default: "http://localhost:3000", legacyEnv: "APP_PUBLIC_URL" },
  { key: "profile.legal_name", group: "profile", label: "Legal name", kind: "text", schema: z.string(), default: "" },
  { key: "profile.trn", group: "profile", label: "Tax registration number (TRN)", kind: "text", schema: z.string().regex(/^(\d{15})?$/, "15 digits"), default: "" },
  { key: "profile.base_currency", group: "profile", label: "Base currency", kind: "select", options: ["AED", "SAR", "KWD", "QAR", "BHD", "OMR", "USD"], schema: z.enum(["AED", "SAR", "KWD", "QAR", "BHD", "OMR", "USD"]), default: "AED" },
  { key: "profile.fiscal_year_end", group: "profile", label: "Fiscal year end (MM-DD)", kind: "text", schema: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/), default: "12-31" },
  { key: "profile.timezone", group: "profile", label: "Timezone", kind: "text", schema: z.string().min(1), default: "Asia/Dubai" },
  { key: "profile.industries", group: "profile", label: "Industries", kind: "tags", options: ["ecommerce", "wholesale", "construction", "logistics", "services"], schema: z.array(z.enum(["ecommerce", "wholesale", "construction", "logistics", "services"])).min(1), default: ["ecommerce"] },
  { key: "profile.modules", group: "profile", label: "Module overrides", kind: "json", schema: z.record(z.boolean()), default: {} },

  // ── accounting ──────────────────────────────────────────────────────
  { key: "zoho.default_connection_id", group: "accounting", label: "Default Zoho organisation", kind: "text", schema: z.string().min(1), default: "env" },
  { key: "zoho.cod_prepaid_org", group: "accounting", label: "Zoho org for prepaid COD orders", kind: "text", schema: z.string(), default: "", legacyEnv: "COD_PREPAID_ORDERS_ZOHO_ORG" },
  { key: "zoho.bank_account_id", group: "accounting", label: "Zoho bank account id (env org)", kind: "text", schema: z.string(), default: "", legacyEnv: "ZOHO_BANK_ACCOUNT_ID" },
  { key: "zoho.fee_account_id", group: "accounting", label: "Zoho fee account id (env org)", kind: "text", schema: z.string(), default: "", legacyEnv: "ZOHO_FEE_ACCOUNT_ID" },
  { key: "zoho.clearing_accounts", group: "accounting", label: "Clearing accounts by gateway", kind: "json", schema: z.record(z.string()), default: {}, legacyEnv: "ZOHO_CLEARING_ACCOUNTS", parseEnv: json },
  { key: "zoho.expense_accounts_by_kind", group: "accounting", label: "Expense accounts by kind", kind: "json", schema: z.record(z.string()), default: {}, legacyEnv: "ZOHO_EXPENSE_ACCOUNTS_BY_KIND", parseEnv: json },
  { key: "zoho.default_income_account_id", group: "accounting", label: "Default income account id", kind: "text", schema: z.string(), default: "", legacyEnv: "ZOHO_DEFAULT_INCOME_ACCOUNT_ID" },
  { key: "zoho.daily_budget", group: "accounting", label: "Zoho daily API budget (env org)", kind: "number", schema: z.number().int().positive(), default: 7000, legacyEnv: "ZOHO_DAILY_BUDGET", parseEnv: (r) => int(r) ?? 7000 },

  // ── sync & schedules (null = scheduler's built-in default) ───────────
  { key: "sync.order_interval_minutes", group: "sync", label: "Order sync every (minutes)", kind: "number", schema: minutes, default: null, legacyEnv: "ORDER_SYNC_INTERVAL_MINUTES", parseEnv: int },
  { key: "sync.payout_interval_minutes", group: "sync", label: "Payout sync every (minutes)", kind: "number", schema: minutes, default: null, legacyEnv: "PAYOUT_SYNC_INTERVAL_MINUTES", parseEnv: int },
  { key: "sync.shopify_payments_interval_minutes", group: "sync", label: "Shopify Payments sync every (minutes)", kind: "number", schema: minutes, default: null, legacyEnv: "SHOPIFY_PAYMENTS_SYNC_MINUTES", parseEnv: int },
  { key: "sync.zoho_interval_minutes", group: "sync", label: "Zoho sync every (minutes)", kind: "number", schema: minutes, default: null, legacyEnv: "ZOHO_SYNC_INTERVAL_MINUTES", parseEnv: int },
  { key: "sync.payment_confirm_interval_minutes", group: "sync", label: "Payment confirmation every (minutes)", kind: "number", schema: minutes, default: null, legacyEnv: "PAYMENT_CONFIRM_INTERVAL_MINUTES", parseEnv: int },
  { key: "sync.gmail_interval_minutes", group: "sync", label: "Gmail payout ingest every (minutes)", kind: "number", schema: minutes, default: null, legacyEnv: "GMAIL_INGEST_INTERVAL_MINUTES", parseEnv: int },
  { key: "sync.ad_interval_minutes", group: "sync", label: "Ad sync every (minutes)", kind: "number", schema: minutes, default: null, legacyEnv: "AD_SYNC_INTERVAL_MINUTES", parseEnv: int },
  { key: "sync.cfo_digest_hour", group: "sync", label: "CFO digest hour (Dubai)", kind: "number", schema: hour, default: null, legacyEnv: "CFO_DIGEST_HOUR_DUBAI", parseEnv: int },
  { key: "sync.group_summary_hour", group: "sync", label: "Group summary hour (Dubai)", kind: "number", schema: hour, default: null, legacyEnv: "GROUP_SUMMARY_HOUR_DUBAI", parseEnv: int },

  // ── advanced ────────────────────────────────────────────────────────
  { key: "shopify.api_version", group: "advanced", label: "Shopify Admin API version", kind: "text", schema: z.string().regex(/^\d{4}-\d{2}$/), default: "2024-04", legacyEnv: "SHOPIFY_API_VERSION" },
  { key: "shopify.analytics_api_version", group: "advanced", label: "Shopify analytics API version", kind: "text", schema: z.string().regex(/^(\d{4}-\d{2}|unstable)$/), default: "2025-10", legacyEnv: "SHOPIFY_ANALYTICS_API_VERSION" },
  { key: "orders.wa_count_cod_as_paid", group: "advanced", label: "Count WhatsApp COD orders as paid", kind: "toggle", schema: z.boolean(), default: false, legacyEnv: "ORDERS_WA_COUNT_COD_AS_PAID", parseEnv: bool },
  { key: "inventory.stock_write_mode", group: "advanced", label: "Stock write mode", kind: "select", options: ["off", "shadow", "live"], schema: z.enum(["off", "shadow", "live"]), default: "off", legacyEnv: "STOCK_WRITE_MODE" },
  { key: "orders.woo_sync", group: "advanced", label: "WooCommerce order sync", kind: "toggle", schema: z.boolean(), default: true, legacyEnv: "WOO_ORDER_SYNC", parseEnv: (r) => r.trim().toLowerCase() !== "off" },
  { key: "zoho.min_gap_ms", group: "advanced", label: "Zoho min gap between calls (ms)", kind: "number", schema: z.number().int().min(0), default: 150, legacyEnv: "ZOHO_MIN_GAP_MS", parseEnv: (r) => int(r) ?? 150 },
  { key: "zoho.max_429_retries", group: "advanced", label: "Zoho 429 retries", kind: "number", schema: z.number().int().min(0), default: 3, legacyEnv: "ZOHO_MAX_429_RETRIES", parseEnv: (r) => int(r) ?? 3 },
  { key: "zoho.max_retry_wait_ms", group: "advanced", label: "Zoho max retry wait (ms)", kind: "number", schema: z.number().int().min(0), default: 120000, legacyEnv: "ZOHO_MAX_RETRY_WAIT_MS", parseEnv: (r) => int(r) ?? 120000 },
  { key: "sheets.spreadsheet_id", group: "advanced", label: "Dispatch intake spreadsheet id", kind: "text", schema: z.string(), default: "", legacyEnv: "GOOGLE_SHEETS_SPREADSHEET_ID" },
  { key: "sheets.payments_spreadsheet_id", group: "advanced", label: "Payments spreadsheet id (pinned month)", kind: "text", schema: z.string(), default: "", legacyEnv: "GOOGLE_SHEETS_PAYMENTS_SPREADSHEET_ID" },
  { key: "alerts.telegram_chat_id", group: "advanced", label: "Telegram chat id", kind: "text", schema: z.string(), default: "", legacyEnv: "TELEGRAM_CHAT_ID" },
  { key: "alerts.telegram_alert_chat_id", group: "advanced", label: "Telegram alert chat id", kind: "text", schema: z.string(), default: "", legacyEnv: "TELEGRAM_ALERT_CHAT_ID" },
  { key: "email.from", group: "advanced", label: "From email address", kind: "text", schema: z.string(), default: "", legacyEnv: "FROM_EMAIL" },
];

export const SETTINGS_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));
```

- [ ] **Step 4: Implement backend and resolver**

```ts
// lib/settings/backend.ts
import { supabase } from "@/lib/supabase";

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
```

```ts
// lib/settings/index.ts
import { currentTenant } from "@/lib/tenant";
import { SETTINGS, SETTINGS_BY_KEY, type SettingDef } from "./registry";
import { supabaseSettingsBackend, memorySettingsBackend, type SettingsBackend } from "./backend";

export { memorySettingsBackend, type SettingsBackend };
export type SettingSource = "database" | "env" | "default";

/** Release 1: env vars still answer when the DB has no value. Task 17 sets false. */
export const ENV_FALLBACK = true;
const TTL_MS = 30_000;

export class SettingError extends Error {}

let backend: SettingsBackend = supabaseSettingsBackend;
let snapshot: Record<string, unknown> | null = null;
let loadedAt = 0;
let loading: Promise<void> | null = null;

export function setSettingsBackend(b: SettingsBackend) {
  backend = b;
  snapshot = null;
  loadedAt = 0;
}

export async function loadSettings(force = false): Promise<void> {
  if (!force && snapshot && Date.now() - loadedAt < TTL_MS) return;
  if (loading) return loading;
  loading = backend.all(currentTenant())
    .then((all) => { snapshot = all; loadedAt = Date.now(); })
    .finally(() => { loading = null; });
  return loading;
}

function def(key: string): SettingDef {
  const d = SETTINGS_BY_KEY.get(key);
  if (!d) throw new SettingError(`Unknown setting "${key}"`);
  return d;
}

function resolve(d: SettingDef): { value: unknown; source: SettingSource } {
  if (snapshot && d.key in snapshot) {
    const parsed = d.schema.safeParse(snapshot[d.key]);
    if (parsed.success) return { value: parsed.data, source: "database" };
    console.error(`[settings] stored ${d.key} is invalid, ignoring: ${parsed.error.issues[0]?.message}`);
  }
  if (ENV_FALLBACK && d.legacyEnv) {
    const raw = process.env[d.legacyEnv];
    if (raw !== undefined && raw !== "") {
      try {
        const parsed = d.schema.safeParse(d.parseEnv ? d.parseEnv(raw) : raw);
        if (parsed.success) return { value: parsed.data, source: "env" };
      } catch { /* malformed env JSON falls through to default */ }
    }
  }
  return { value: d.default, source: "default" };
}

export async function getSetting<T = unknown>(key: string): Promise<T> {
  const d = def(key);
  await loadSettings();
  return resolve(d).value as T;
}

/** Synchronous read for hot paths and module-level constants: uses the last
 *  loaded snapshot (warmed at boot by instrumentation.ts). */
export function peekSetting<T = unknown>(key: string): T {
  return resolve(def(key)).value as T;
}

export async function setSetting(key: string, value: unknown, actor: string): Promise<void> {
  const d = def(key);
  const parsed = d.schema.safeParse(value);
  if (!parsed.success) throw new SettingError(`${d.label}: ${parsed.error.issues[0]?.message ?? "invalid value"}`);
  await loadSettings();
  const old = resolve(d).value;
  await backend.set(currentTenant(), key, parsed.data, actor);
  await loadSettings(true);
  if (backend === supabaseSettingsBackend) {
    const { writeAudit } = await import("@/lib/audit");
    await writeAudit({ entity: "setting", entityId: key, event: "updated", actor, payload: { old, new: parsed.data } });
  }
}

export async function describeSettings() {
  await loadSettings();
  return SETTINGS.map((d) => {
    const { value, source } = resolve(d);
    return { key: d.key, group: d.group, label: d.label, help: d.help, kind: d.kind, options: d.options, value, source, legacyEnv: d.legacyEnv };
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test tests/settings/settings.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/settings tests/settings
git commit -m "feat(settings): typed settings registry with DB → env → default resolution"
```

---

### Task 4: Connector types and connection store

**Files:**
- Create: `lib/connectors/types.ts`, `lib/connectors/store.ts`, `lib/connectors/http.ts`
- Test: `tests/connectors/store.test.ts`

**Interfaces:**
- Produces (exact names used by every later task):

```ts
// types.ts
export type AuthMode = "platform" | "own_app" | "token";
export type GrantType = "authorization_code" | "client_credentials" | "static_token" | "static_refresh";
export type ConnectionStatus = "active" | "error" | "disabled" | "needs_reauth";
export type Category = "accounting" | "email" | "store" | "marketplace" | "gateway" | "ads" | "courier";
export type Grant = { accessToken: string; expiresAt?: number; refreshToken?: string; scopes?: string; raw: Record<string, unknown> };
export type OAuthApp = { clientId: string; clientSecret: string };
export type DiscoveredAccount = { accountRef: string; label: string; config: Record<string, unknown>; scopes?: string };
export type BaseSecrets = { client_id?: string; client_secret?: string; refresh_token?: string; access_token?: string; access_token_expires_at?: number; webhook_secret?: string; grant_id?: string };
export type Connection<C = Record<string, unknown>, S extends BaseSecrets = BaseSecrets> = {...};
export type PublicConnection = Omit<Connection, "secrets"> & { hasSecrets: boolean; secretsUpdatedAt: string | null };
export interface ConnectorDef<C, S> {...}
export class GrantRevokedError, ReauthRequiredError, OAuthFlowError
// store.ts
export type ConnectionRow = {...snake_case columns...};
export interface ConnectionStore { list; get; findByAccount; insert; update; remove; listByGrant }
export const supabaseConnectionStore: ConnectionStore;
export function memoryConnectionStore(): ConnectionStore;
// http.ts
export async function postForm(url: string, body: Record<string, string>): Promise<{ status: number; json: any }>;
export async function getJson(url: string, headers: Record<string, string>): Promise<{ status: number; json: any }>;
export async function postJson(url: string, body: unknown, headers?: Record<string, string>): Promise<{ status: number; json: any }>;
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/connectors/store.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryConnectionStore, type ConnectionRow } from "@/lib/connectors/store";

const row = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  id: "shopify-uae", tenant_id: "omnia", provider: "shopify", auth_mode: "token", grant_type: "static_token",
  account_ref: "uae.myshopify.com", label: "UAE", config: { store_id: "UAE" }, secrets_enc: "", scopes: "",
  status: "active", last_checked_at: null, last_synced_at: null, last_error: "", connected_by: "t",
  created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z", ...over,
});

test("memory store: insert, find by account, update, list by provider, remove", async () => {
  const s = memoryConnectionStore();
  await s.insert(row());
  await s.insert(row({ id: "gmail-a", provider: "gmail", account_ref: "a@x.com" }));
  assert.equal((await s.findByAccount("omnia", "shopify", "uae.myshopify.com"))?.id, "shopify-uae");
  await s.update("omnia", "shopify-uae", { label: "UAE store" });
  assert.equal((await s.get("omnia", "shopify-uae"))?.label, "UAE store");
  assert.deepEqual((await s.list("omnia", "gmail")).map((r) => r.id), ["gmail-a"]);
  await s.remove("omnia", "gmail-a");
  assert.equal(await s.get("omnia", "gmail-a"), null);
});

test("memory store: duplicate (tenant, provider, account_ref) is rejected", async () => {
  const s = memoryConnectionStore();
  await s.insert(row());
  await assert.rejects(s.insert(row({ id: "other" })), /already connected/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/connectors/store.test.ts`
Expected: FAIL — cannot find module `@/lib/connectors/store`

- [ ] **Step 3: Implement types**

```ts
// lib/connectors/types.ts
import type { ZodType } from "zod";
import type { OrderRow } from "@/lib/normalize/order";

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
  /** Which `params` the start form must collect (e.g. ["shop","store_id"], ["dc"]). */
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
```

- [ ] **Step 4: Implement store and http helpers**

```ts
// lib/connectors/store.ts
import { supabase } from "@/lib/supabase";

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
  return {
    async list(t, p) { return [...rows.values()].filter((r) => r.tenant_id === t && (!p || r.provider === p)).map((r) => ({ ...r })); },
    async get(t, id) { const r = rows.get(k(t, id)); return r ? { ...r } : null; },
    async findByAccount(t, p, a) { const r = [...rows.values()].find((x) => x.tenant_id === t && x.provider === p && x.account_ref === a); return r ? { ...r } : null; },
    async insert(row) {
      if ([...rows.values()].some((x) => x.tenant_id === row.tenant_id && x.provider === row.provider && x.account_ref === row.account_ref) || rows.has(k(row.tenant_id, row.id))) {
        throw new Error(`${row.provider} account ${row.account_ref} is already connected`);
      }
      rows.set(k(row.tenant_id, row.id), { ...row });
    },
    async update(t, id, patch) { const r = rows.get(k(t, id)); if (r) rows.set(k(t, id), { ...r, ...patch, updated_at: new Date().toISOString() }); },
    async remove(t, id) { rows.delete(k(t, id)); },
  };
}
```

```ts
// lib/connectors/http.ts
/** Tiny fetch helpers shared by connectors. They never throw on HTTP status —
 *  connectors decide what a status means (revoked vs transient). */
export async function postForm(url: string, body: Record<string, string>, headers: Record<string, string> = {}) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...headers }, body: new URLSearchParams(body), cache: "no-store" });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

export async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", ...headers }, body: JSON.stringify(body), cache: "no-store" });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

export async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, cache: "no-store" });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
```

- [ ] **Step 5: Run tests**

Run: `npx tsx --test tests/connectors/store.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/connectors/types.ts lib/connectors/store.ts lib/connectors/http.ts tests/connectors/store.test.ts
git commit -m "feat(connections): connector types, connection store, http helpers"
```

---

### Task 5: Connector registry + runtime (tokens, re-auth, save/test/remove)

**Files:**
- Create: `lib/connectors/registry.ts`, `lib/connectors/runtime.ts`
- Test: `tests/connectors/runtime.test.ts`

**Interfaces:**
- Consumes: Task 2 (`encryptJson`, `decryptJson`, `currentTenant`, `writeAudit`), Task 4 types/store.
- Produces:
  - `registerConnector(def: ConnectorDef): void`, `getConnector(provider: string): ConnectorDef` (throws for unknown), `allConnectors(): ConnectorDef[]`
  - `setConnectionStore(s: ConnectionStore)`, `setAlertSink(fn: (text: string) => Promise<unknown>)`
  - `listConnections(provider?: string, opts?: { includeDisabled?: boolean }): Promise<Connection[]>`
  - `listPublicConnections(): Promise<PublicConnection[]>`
  - `getConnection(id: string): Promise<Connection | null>`
  - `saveConnection(input: SaveInput): Promise<Connection>` where `SaveInput = { id?: string; provider: string; authMode: AuthMode; grantType: GrantType; accountRef: string; label: string; config: Record<string, unknown>; secrets: BaseSecrets & Record<string, unknown>; scopes?: string; connectedBy: string; status?: ConnectionStatus }` — upserts on (tenant, provider, accountRef), preserving an existing row's id
  - `updateConnection(id: string, patch: { label?: string; config?: Record<string, unknown>; status?: ConnectionStatus; secrets?: Partial<BaseSecrets> & Record<string, unknown> }, actor: string): Promise<void>`
  - `removeConnection(id: string, actor: string): Promise<{ removed: true } | { blocked: string[] }>`
  - `getAccessToken(connOrId: Connection | string): Promise<string>` (throws `ReauthRequiredError`)
  - `testConnection(id: string): Promise<{ ok: boolean; accountName?: string; missingScopes?: string[]; error?: string }>`
  - `markSynced(id: string): Promise<void>`
  - `resolveApp(conn: { provider: string; authMode: AuthMode; secrets: BaseSecrets }): OAuthApp | null`
  - `grantFingerprint(refreshToken: string): string`
  - `toPublic(conn: Connection): PublicConnection`
  - `_resetRuntimeCaches(): void` (tests only)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/connectors/runtime.test.ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { z } from "zod";

process.env.CONNECTIONS_KEY = randomBytes(32).toString("base64");

const { memoryConnectionStore } = await import("@/lib/connectors/store");
const rt = await import("@/lib/connectors/runtime");
const { registerConnector } = await import("@/lib/connectors/registry");
const { GrantRevokedError, ReauthRequiredError } = await import("@/lib/connectors/types");

let refreshCalls = 0;
let refreshMode: "ok" | "revoked" | "rotate" = "ok";
const alerts: string[] = [];

registerConnector({
  provider: "fake", label: "Fake", category: "store",
  authModes: ["own_app", "token"], grantTypes: { own_app: ["authorization_code"], token: ["static_token"] },
  configSchema: z.object({ n: z.number().default(1) }),
  secretsSchema: z.object({ client_id: z.string().optional(), client_secret: z.string().optional(), refresh_token: z.string().optional(), access_token: z.string().optional(), access_token_expires_at: z.number().optional(), grant_id: z.string().optional() }),
  configFields: [],
  oauth: {
    authorizeUrl: () => "https://fake/auth",
    exchangeCode: async () => ({ accessToken: "a0", raw: {} }),
    refresh: async () => {
      refreshCalls++;
      await new Promise((r) => setTimeout(r, 20));
      if (refreshMode === "revoked") throw new GrantRevokedError("invalid_grant");
      return { accessToken: `a${refreshCalls}`, expiresAt: Date.now() + 3600_000, refreshToken: refreshMode === "rotate" ? "r2" : undefined, raw: {} };
    },
  },
  accountsFromGrant: async () => [],
  test: async () => ({ ok: true, accountName: "Fake shop" }),
});

beforeEach(() => {
  rt.setConnectionStore(memoryConnectionStore());
  rt.setAlertSink(async (t) => { alerts.push(t); });
  rt._resetRuntimeCaches();
  refreshCalls = 0; refreshMode = "ok"; alerts.length = 0;
});

const save = (over: Record<string, unknown> = {}) => rt.saveConnection({
  provider: "fake", authMode: "own_app", grantType: "authorization_code", accountRef: "acct-1", label: "One",
  config: {}, secrets: { client_id: "c", client_secret: "s", refresh_token: "r1", access_token: "old", access_token_expires_at: Date.now() - 1000 },
  connectedBy: "test", ...over,
});

test("saveConnection encrypts secrets and preserves id on re-save of the same account", async () => {
  const a = await save({ id: "fake-one" });
  const b = await save({ label: "Renamed" });
  assert.equal(b.id, "fake-one");
  assert.equal(b.label, "Renamed");
  assert.equal(b.secrets.refresh_token, "r1");
  assert.equal(a.config.n, 1); // schema default applied
});

test("10 concurrent getAccessToken calls with an expired persisted token → one refresh, persisted", async () => {
  const c = await save();
  const tokens = await Promise.all(Array.from({ length: 10 }, () => rt.getAccessToken(c.id)));
  assert.equal(refreshCalls, 1);
  assert.ok(tokens.every((t) => t === "a1"));
  rt._resetRuntimeCaches(); // simulate restart: persisted token is still valid
  assert.equal(await rt.getAccessToken(c.id), "a1");
  assert.equal(refreshCalls, 1);
});

test("rotated refresh tokens are persisted", async () => {
  refreshMode = "rotate";
  const c = await save();
  await rt.getAccessToken(c.id);
  assert.equal((await rt.getConnection(c.id))!.secrets.refresh_token, "r2");
});

test("revoked grant → needs_reauth, ReauthRequiredError, exactly one alert across repeated calls", async () => {
  refreshMode = "revoked";
  const c = await save();
  await assert.rejects(rt.getAccessToken(c.id), ReauthRequiredError);
  await assert.rejects(rt.getAccessToken(c.id), ReauthRequiredError);
  assert.equal((await rt.getConnection(c.id))!.status, "needs_reauth");
  assert.equal(alerts.length, 1);
  assert.equal(refreshCalls, 1); // second call short-circuits on status
});

test("static token mode returns the stored token without refreshing", async () => {
  const c = await rt.saveConnection({ provider: "fake", authMode: "token", grantType: "static_token", accountRef: "t", label: "T", config: {}, secrets: { access_token: "shpat_x" }, connectedBy: "t" });
  assert.equal(await rt.getAccessToken(c.id), "shpat_x");
  assert.equal(refreshCalls, 0);
});

test("listPublicConnections never exposes secrets", async () => {
  await save();
  const [p] = await rt.listPublicConnections();
  assert.equal((p as any).secrets, undefined);
  assert.equal(p.hasSecrets, true);
  assert.ok(!JSON.stringify(p).includes("r1"));
});

test("invalid stored config surfaces as status error, not a throw", async () => {
  // updateConnection validates config, so write the bad row straight into the store:
  const store = memoryConnectionStore();
  rt.setConnectionStore(store);
  await store.insert({ id: "bad", tenant_id: "omnia", provider: "fake", auth_mode: "token", grant_type: "static_token", account_ref: "b", label: "B", config: { n: "x" } as any, secrets_enc: "", scopes: "", status: "active", last_checked_at: null, last_synced_at: null, last_error: "", connected_by: "", created_at: "", updated_at: "" });
  const [bad] = await rt.listConnections("fake");
  assert.equal(bad.status, "error");
  assert.match(bad.parseError!, /n/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/connectors/runtime.test.ts`
Expected: FAIL — cannot find module `@/lib/connectors/runtime`

- [ ] **Step 3: Implement registry**

```ts
// lib/connectors/registry.ts
import type { ConnectorDef } from "./types";

const defs = new Map<string, ConnectorDef>();

export function registerConnector(def: ConnectorDef): void {
  defs.set(def.provider, def);
}

export function getConnector(provider: string): ConnectorDef {
  const d = defs.get(provider);
  if (!d) throw new Error(`Unknown connector "${provider}"`);
  return d;
}

export function allConnectors(): ConnectorDef[] {
  return [...defs.values()];
}
```

- [ ] **Step 4: Implement runtime**

```ts
// lib/connectors/runtime.ts
import { createHash } from "node:crypto";
import { decryptJson, encryptJson } from "@/lib/crypto/secret-box";
import { currentTenant } from "@/lib/tenant";
import { getConnector } from "./registry";
import { supabaseConnectionStore, type ConnectionRow, type ConnectionStore } from "./store";
import {
  GrantRevokedError, ReauthRequiredError,
  type AuthMode, type BaseSecrets, type Connection, type ConnectionStatus, type GrantType, type OAuthApp, type PublicConnection,
} from "./types";

let store: ConnectionStore = supabaseConnectionStore;
let alertSink: (text: string) => Promise<unknown> = async (text) => {
  const { sendTelegramMessage } = await import("@/lib/integrations/telegram");
  return sendTelegramMessage(text);
};

export function setConnectionStore(s: ConnectionStore) { store = s; }
export function setAlertSink(fn: (text: string) => Promise<unknown>) { alertSink = fn; }

const REFRESH_MARGIN_MS = 60_000;
const tokenCache = new Map<string, { token: string; expiresAt?: number }>();
const inflight = new Map<string, Promise<string>>();
export function _resetRuntimeCaches() { tokenCache.clear(); inflight.clear(); }

export const grantFingerprint = (refreshToken: string) => createHash("sha256").update(refreshToken).digest("hex").slice(0, 32);

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "conn";

function toConnection(row: ConnectionRow): Connection {
  const def = getConnector(row.provider);
  let parseError: string | undefined;
  const cfg = def.configSchema.safeParse(row.config ?? {});
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
  if (!cfg.success) parseError = `config: ${cfg.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(", ")}`;
  return {
    id: row.id, tenantId: row.tenant_id, provider: row.provider,
    authMode: row.auth_mode as AuthMode, grantType: row.grant_type as GrantType,
    accountRef: row.account_ref, label: row.label,
    config: cfg.success ? (cfg.data as Record<string, unknown>) : (row.config ?? {}),
    secrets, scopes: row.scopes,
    status: parseError ? "error" : (row.status as ConnectionStatus),
    lastCheckedAt: row.last_checked_at, lastSyncedAt: row.last_synced_at, lastError: parseError ?? row.last_error,
    connectedBy: row.connected_by, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(parseError ? { parseError } : {}),
  };
}

export function toPublic(c: Connection): PublicConnection {
  const { secrets, ...rest } = c;
  const def = getConnector(c.provider);
  return { ...rest, hasSecrets: Object.keys(secrets).length > 0, category: def.category, providerLabel: def.label };
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

export async function saveConnection(input: SaveInput): Promise<Connection> {
  const def = getConnector(input.provider);
  if (!def.authModes.includes(input.authMode)) throw new Error(`${def.label} does not support ${input.authMode}`);
  const config = def.configSchema.parse(input.config);
  const secrets = def.secretsSchema.parse({
    ...input.secrets,
    ...(input.secrets.refresh_token && !input.secrets.grant_id ? { grant_id: grantFingerprint(input.secrets.refresh_token) } : {}),
  });
  const tenant = currentTenant();
  const now = new Date().toISOString();
  const existing = await store.findByAccount(tenant, input.provider, input.accountRef);
  if (existing) {
    await store.update(tenant, existing.id, {
      auth_mode: input.authMode, grant_type: input.grantType, label: input.label, config: config as Record<string, unknown>,
      secrets_enc: encryptJson(secrets), scopes: input.scopes ?? existing.scopes, status: input.status ?? "active", last_error: "",
    });
    tokenCache.delete(existing.id);
    return toConnection((await store.get(tenant, existing.id))!);
  }
  let id = input.id ?? `${input.provider}-${slug(input.accountRef)}`;
  if (!input.id) for (let n = 2; await store.get(tenant, id); n++) id = `${input.provider}-${slug(input.accountRef)}-${n}`;
  await store.insert({
    id, tenant_id: tenant, provider: input.provider, auth_mode: input.authMode, grant_type: input.grantType,
    account_ref: input.accountRef, label: input.label, config: config as Record<string, unknown>, secrets_enc: encryptJson(secrets),
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
  const { writeAudit } = await import("@/lib/audit");
  await writeAudit({ entity: "connection", entityId: id, event: "updated", actor, payload: { ...patch } });
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
  const { writeAudit } = await import("@/lib/audit");
  await writeAudit({ entity: "connection", entityId: id, event: "removed", actor, payload: { provider: conn.provider, accountRef: conn.accountRef } });
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
    await alertSink(`⚠️ ${getConnector(conn.provider).label} connection "${conn.label}" needs to be reconnected (${reason}). Settings → Connections.`).catch(() => {});
  }
  tokenCache.delete(conn.id);
  throw new ReauthRequiredError(conn.id, `${conn.label} needs to be reconnected: ${reason}`);
}

async function mintToken(conn: Connection): Promise<string> {
  const def = getConnector(conn.provider);
  const app = resolveApp(conn);
  let grant;
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
  const nextSecrets = {
    ...conn.secrets,
    access_token: grant.accessToken,
    access_token_expires_at: grant.expiresAt,
    ...(rotated ? { refresh_token: rotated, grant_id: grantFingerprint(rotated) } : {}),
  };
  await store.update(currentTenant(), conn.id, { secrets_enc: encryptJson(nextSecrets), ...(grant.scopes ? { scopes: grant.scopes } : {}) });
  // Siblings on the same grant (several Zoho orgs) get the rotated refresh token too.
  if (rotated && conn.secrets.grant_id) {
    for (const sib of await listConnections(conn.provider, { includeDisabled: true })) {
      if (sib.id !== conn.id && sib.secrets.grant_id === conn.secrets.grant_id) {
        await store.update(currentTenant(), sib.id, { secrets_enc: encryptJson({ ...sib.secrets, refresh_token: rotated, grant_id: grantFingerprint(rotated) }) });
      }
    }
  }
  tokenCache.set(conn.id, { token: grant.accessToken, expiresAt: grant.expiresAt });
  return grant.accessToken;
}

const fresh = (expiresAt?: number) => expiresAt === undefined || expiresAt > Date.now() + REFRESH_MARGIN_MS;

/** A usable access token for the connection. Throws ReauthRequiredError when
 *  the user must reconnect — callers show "Reconnect", never empty data. */
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
    if (s.access_token && fresh(s.access_token_expires_at) && (s.access_token_expires_at !== undefined || conn.grantType === "authorization_code")) {
      tokenCache.set(id, { token: s.access_token, expiresAt: s.access_token_expires_at });
      return s.access_token;
    }
    return mintToken(conn);
  })();
  inflight.set(id, p);
  try { return await p; } finally { inflight.delete(id); }
}

export async function testConnection(id: string) {
  const conn = await getConnection(id);
  if (!conn) return { ok: false, error: "Connection not found" };
  const def = getConnector(conn.provider);
  let result: { ok: boolean; accountName?: string; scopes?: string; missingScopes?: string[]; error?: string };
  try {
    tokenCache.delete(id);
    result = await def.test(conn, await getAccessToken(conn));
  } catch (e) {
    if (e instanceof ReauthRequiredError) return { ok: false, error: e.message };
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
```

Note on the access-token reuse condition: a persisted token is reused when it is still fresh. For `authorization_code` grants with no `access_token_expires_at` (Shopify offline tokens) `fresh(undefined)` is true and the token never expires; for providers that always set an expiry (Zoho, Google) the stored expiry governs.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test tests/connectors/runtime.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/connectors/registry.ts lib/connectors/runtime.ts tests/connectors/runtime.test.ts
git commit -m "feat(connections): runtime with single-flight refresh and needs_reauth handling"
```

---

### Task 6: OAuth state, PKCE, pending grants, Shopify HMAC

**Files:**
- Create: `lib/connectors/oauth.ts`
- Test: `tests/connectors/oauth.test.ts`

**Interfaces:**
- Consumes: `encryptJson/decryptJson`, `currentTenant`, `getSetting("app.public_url")`, `OAuthFlowError`.
- Produces:
  - `type StateRecord = { state: string; tenantId: string; provider: string; authMode: AuthMode; pkceVerifier: string; pendingApp: OAuthApp | null; params: Record<string, string>; createdBy: string }`
  - `interface OAuthStateStore { insert(r): Promise<void>; consume(state: string): Promise<{ row: any | null; reason?: "missing" | "expired" | "used" }>; savePending(p): Promise<void>; takePending(id: string, tenantId: string): Promise<any | null>; peekPending(id: string, tenantId: string): Promise<any | null> }`
  - `setOAuthStateStore(s)`, `memoryOAuthStateStore()`
  - `createState(input: Omit<StateRecord, "state" | "tenantId" | "pkceVerifier">, opts?: { pkce?: boolean }): Promise<{ state: string; pkceChallenge?: string }>`
  - `consumeState(state: string, provider: string, user: string): Promise<StateRecord>` (throws `OAuthFlowError`)
  - `savePendingGrant(p: { provider: string; authMode: AuthMode; grant: Grant; app: OAuthApp; accounts: DiscoveredAccount[]; params: Record<string, string>; createdBy: string }): Promise<string>`
  - `takePendingGrant(id: string, user: string): Promise<{ provider; authMode; grant: Grant; app: OAuthApp; accounts: DiscoveredAccount[]; params }>`
  - `peekPendingAccounts(id: string): Promise<{ provider: string; accounts: DiscoveredAccount[] } | null>`
  - `redirectUri(provider: string): Promise<string>`
  - `verifyShopifyHmac(query: URLSearchParams, secret: string): boolean`
  - `isShopDomain(shop: string): boolean`, `isZohoAccountsHost(url: string): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/connectors/oauth.test.ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHmac, createHash } from "node:crypto";

process.env.CONNECTIONS_KEY = randomBytes(32).toString("base64");
const o = await import("@/lib/connectors/oauth");
const { OAuthFlowError } = await import("@/lib/connectors/types");

beforeEach(() => o.setOAuthStateStore(o.memoryOAuthStateStore()));

const base = { provider: "gmail", authMode: "own_app" as const, pendingApp: { clientId: "c", clientSecret: "s" }, params: {}, createdBy: "admin" };

test("state is single-use and returns the encrypted own-app credentials", async () => {
  const { state } = await o.createState(base);
  const rec = await o.consumeState(state, "gmail", "admin");
  assert.deepEqual(rec.pendingApp, { clientId: "c", clientSecret: "s" });
  await assert.rejects(o.consumeState(state, "gmail", "admin"), (e: any) => e instanceof OAuthFlowError && e.code === "state_used");
});

test("unknown, wrong-provider and wrong-user states are rejected", async () => {
  await assert.rejects(o.consumeState("nope", "gmail", "admin"), (e: any) => e.code === "state_invalid");
  const a = await o.createState(base);
  await assert.rejects(o.consumeState(a.state, "zoho", "admin"), (e: any) => e.code === "provider_mismatch");
  const b = await o.createState(base);
  await assert.rejects(o.consumeState(b.state, "gmail", "someone-else"), (e: any) => e.code === "state_user_mismatch");
});

test("expired state is rejected", async () => {
  const s = o.memoryOAuthStateStore();
  o.setOAuthStateStore(s);
  const { state } = await o.createState(base);
  (s as any)._expire(state);
  await assert.rejects(o.consumeState(state, "gmail", "admin"), (e: any) => e.code === "state_expired");
});

test("PKCE challenge is S256 of the stored verifier", async () => {
  const { state, pkceChallenge } = await o.createState(base, { pkce: true });
  const rec = await o.consumeState(state, "gmail", "admin");
  assert.equal(pkceChallenge, createHash("sha256").update(rec.pkceVerifier).digest("base64url"));
});

test("Shopify HMAC: valid passes, tampered fails", () => {
  const q = new URLSearchParams({ code: "abc", shop: "x.myshopify.com", state: "s1", timestamp: "1700000000" });
  const msg = [...q.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
  q.set("hmac", createHmac("sha256", "secret").update(msg).digest("hex"));
  assert.equal(o.verifyShopifyHmac(q, "secret"), true);
  q.set("shop", "evil.myshopify.com");
  assert.equal(o.verifyShopifyHmac(q, "secret"), false);
});

test("host validators", () => {
  assert.equal(o.isShopDomain("omnia-store-main.myshopify.com"), true);
  assert.equal(o.isShopDomain("evil.com/x.myshopify.com"), false);
  assert.equal(o.isShopDomain("x.myshopify.com.evil.com"), false);
  assert.equal(o.isZohoAccountsHost("https://accounts.zoho.sa"), true);
  assert.equal(o.isZohoAccountsHost("https://accounts.zoho.com.evil.io"), false);
  assert.equal(o.isZohoAccountsHost("https://evil.io"), false);
});

test("pending grant round-trip is single-use and user-bound", async () => {
  const id = await o.savePendingGrant({ provider: "zoho", authMode: "own_app", grant: { accessToken: "a", refreshToken: "r", raw: {} }, app: { clientId: "c", clientSecret: "s" }, accounts: [{ accountRef: "1", label: "Org", config: {} }], params: {}, createdBy: "admin" });
  assert.equal((await o.peekPendingAccounts(id))!.accounts.length, 1);
  await assert.rejects(o.takePendingGrant(id, "other"), (e: any) => e.code === "state_user_mismatch");
  const p = await o.takePendingGrant(id, "admin");
  assert.equal(p.grant.refreshToken, "r");
  await assert.rejects(o.takePendingGrant(id, "admin"), (e: any) => e.code === "state_invalid");
});
```

Note: `https://accounts.zoho.com.evil.io` **matches** the spec's regex `^https://accounts\.zoho\.[a-z.]+$`, so the spec's check is too loose. Step 3 implements a strict allowlist of Zoho data-centre hosts instead.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/connectors/oauth.test.ts`
Expected: FAIL — cannot find module `@/lib/connectors/oauth`

- [ ] **Step 3: Implement**

```ts
// lib/connectors/oauth.ts
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { supabase } from "@/lib/supabase";
import { decryptJson, encryptJson } from "@/lib/crypto/secret-box";
import { currentTenant } from "@/lib/tenant";
import { getSetting } from "@/lib/settings";
import { OAuthFlowError, type AuthMode, type DiscoveredAccount, type Grant, type OAuthApp } from "./types";

const STATE_TTL_MS = 10 * 60_000;
const PENDING_TTL_MS = 15 * 60_000;

export type StateRecord = {
  state: string; tenantId: string; provider: string; authMode: AuthMode; pkceVerifier: string;
  pendingApp: OAuthApp | null; params: Record<string, string>; createdBy: string;
};

type StateRow = {
  state: string; tenant_id: string; provider: string; auth_mode: string; pkce_verifier: string; pending_app_enc: string;
  params: Record<string, string>; created_by: string; created_at?: string; expires_at: string; used_at: string | null;
};
type PendingRow = { id: string; tenant_id: string; provider: string; auth_mode: string; grant_enc: string; accounts: DiscoveredAccount[]; params: Record<string, string>; created_by: string; expires_at: string };

export interface OAuthStateStore {
  insert(r: StateRow): Promise<void>;
  /** Atomically mark used. Returns the row when it was unused and unexpired. */
  consume(state: string): Promise<{ row: StateRow | null; reason?: "missing" | "expired" | "used" }>;
  savePending(p: PendingRow): Promise<void>;
  peekPending(id: string, tenantId: string): Promise<PendingRow | null>;
  takePending(id: string, tenantId: string): Promise<PendingRow | null>;
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
    const { data: seen } = await supabase.from("oauth_states").select("used_at, expires_at").eq("state", state).maybeSingle();
    if (!seen) return { row: null, reason: "missing" };
    return { row: null, reason: seen.used_at ? "used" : "expired" };
  },
  async savePending(p) {
    const { error } = await supabase.from("pending_grants").insert(p);
    if (error) throw new Error(`pending_grants insert failed: ${error.message}`);
  },
  async peekPending(id, tenantId) {
    const { data } = await supabase.from("pending_grants").select("*").eq("id", id).eq("tenant_id", tenantId).gt("expires_at", new Date().toISOString()).maybeSingle();
    return (data as PendingRow) ?? null;
  },
  async takePending(id, tenantId) {
    const { data } = await supabase.from("pending_grants").delete().eq("id", id).eq("tenant_id", tenantId).gt("expires_at", new Date().toISOString()).select("*").maybeSingle();
    return (data as PendingRow) ?? null;
  },
};

export function memoryOAuthStateStore(): OAuthStateStore & { _expire(state: string): void } {
  const states = new Map<string, StateRow>();
  const pending = new Map<string, PendingRow>();
  const live = (iso: string) => new Date(iso).getTime() > Date.now();
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
    async peekPending(id, t) { const p = pending.get(id); return p && p.tenant_id === t && live(p.expires_at) ? { ...p } : null; },
    async takePending(id, t) { const p = await this.peekPending(id, t); if (p) pending.delete(id); return p; },
    _expire(state) { const r = states.get(state); if (r) r.expires_at = new Date(Date.now() - 1000).toISOString(); },
  };
}

let stateStore: OAuthStateStore = supabaseOAuthStateStore;
export function setOAuthStateStore(s: OAuthStateStore) { stateStore = s; }

export async function createState(
  input: { provider: string; authMode: AuthMode; pendingApp: OAuthApp | null; params: Record<string, string>; createdBy: string },
  opts: { pkce?: boolean } = {},
): Promise<{ state: string; pkceChallenge?: string }> {
  const state = randomBytes(32).toString("base64url");
  const pkceVerifier = opts.pkce ? randomBytes(48).toString("base64url") : "";
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

export async function savePendingGrant(p: { provider: string; authMode: AuthMode; grant: Grant; app: OAuthApp; accounts: DiscoveredAccount[]; params: Record<string, string>; createdBy: string }): Promise<string> {
  const id = randomUUID();
  await stateStore.savePending({
    id, tenant_id: currentTenant(), provider: p.provider, auth_mode: p.authMode,
    grant_enc: encryptJson({ grant: p.grant, app: p.app }), accounts: p.accounts, params: p.params,
    created_by: p.createdBy, expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
  });
  return id;
}

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

export async function redirectUri(provider: string): Promise<string> {
  const base = String(await getSetting<string>("app.public_url")).replace(/\/+$/, "");
  return `${base}/api/connections/oauth/${provider}/callback`;
}

export function verifyShopifyHmac(query: URLSearchParams, secret: string): boolean {
  const given = query.get("hmac") ?? "";
  const msg = [...query.entries()].filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("&");
  const digest = createHmac("sha256", secret).update(msg).digest("hex");
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(digest, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const isShopDomain = (shop: string) => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);

/** Zoho data-centre login servers we accept. Strict list: a callback's
 *  accounts-server decides where we POST our client secret. */
const ZOHO_ACCOUNTS_HOSTS = new Set([
  "https://accounts.zoho.com", "https://accounts.zoho.eu", "https://accounts.zoho.in", "https://accounts.zoho.com.au",
  "https://accounts.zoho.jp", "https://accounts.zoho.sa", "https://accounts.zoho.uk", "https://accounts.zohocloud.ca", "https://accounts.zoho.com.cn",
]);
export const isZohoAccountsHost = (url: string) => ZOHO_ACCOUNTS_HOSTS.has(url.replace(/\/+$/, ""));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/connectors/oauth.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/connectors/oauth.ts tests/connectors/oauth.test.ts
git commit -m "feat(connections): single-use OAuth state, PKCE, pending grants, Shopify HMAC"
```

---

### Task 7: Zoho Books connector

**Files:**
- Create: `lib/connectors/zoho.ts`
- Test: `tests/connectors/zoho.test.ts`

**Interfaces:**
- Consumes: `registerConnector`, `postForm/getJson`, `isZohoAccountsHost`, types.
- Produces: `zohoConnector: ConnectorDef<ZohoConfig, ZohoSecrets>` (registered on import), `type ZohoConfig = { accounts_url: string; api_domain: string; org_name: string; daily_budget: number; default_for_providers: string[]; login_email: string }`, `ZOHO_SCOPE = "ZohoBooks.fullaccess.all"`, `zohoRefresh(secrets, config, app)` (also used by Task 12).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/connectors/zoho.test.ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { zohoConnector } from "@/lib/connectors/zoho";
import { GrantRevokedError, OAuthFlowError } from "@/lib/connectors/types";

const realFetch = globalThis.fetch;
const calls: { url: string; body?: string }[] = [];
function mockFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  globalThis.fetch = (async (url: any, init?: any) => {
    calls.push({ url: String(url), body: init?.body ? String(init.body) : undefined });
    const r = handler(String(url), init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
}
afterEach(() => { globalThis.fetch = realFetch; calls.length = 0; });
const app = { clientId: "cid", clientSecret: "csec" };

test("authorize URL: chosen data centre, offline, consent, Books scope", () => {
  const u = new URL(zohoConnector.oauth!.authorizeUrl({ state: "st", redirectUri: "https://app/cb", app, params: { dc: "https://accounts.zoho.sa" } }));
  assert.equal(u.origin, "https://accounts.zoho.sa");
  assert.equal(u.pathname, "/oauth/v2/auth");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("prompt"), "consent");
  assert.equal(u.searchParams.get("scope"), "ZohoBooks.fullaccess.all");
  assert.equal(u.searchParams.get("state"), "st");
});

test("exchangeCode posts to the callback's accounts-server and keeps api_domain", async () => {
  mockFetch(() => ({ body: { access_token: "at", refresh_token: "rt", expires_in: 3600, api_domain: "https://www.zohoapis.sa", scope: "ZohoBooks.fullaccess.all" } }));
  const g = await zohoConnector.oauth!.exchangeCode({ code: "c", redirectUri: "https://app/cb", app, query: new URLSearchParams({ "accounts-server": "https://accounts.zoho.sa" }), params: {} });
  assert.equal(calls[0].url, "https://accounts.zoho.sa/oauth/v2/token");
  assert.equal(g.refreshToken, "rt");
  assert.equal(g.raw.api_domain, "https://www.zohoapis.sa");
  assert.equal(g.raw.accounts_url, "https://accounts.zoho.sa");
});

test("exchangeCode refuses a forged accounts-server before sending the secret", async () => {
  mockFetch(() => ({ body: {} }));
  await assert.rejects(
    zohoConnector.oauth!.exchangeCode({ code: "c", redirectUri: "x", app, query: new URLSearchParams({ "accounts-server": "https://accounts.zoho.com.evil.io" }), params: {} }),
    (e: any) => e instanceof OAuthFlowError && e.code === "bad_host",
  );
  assert.equal(calls.length, 0);
});

test("accountsFromGrant: one account per organisation", async () => {
  mockFetch(() => ({ body: { code: 0, organizations: [{ organization_id: "799179049", name: "House of Omnia", currency_code: "AED" }, { organization_id: "1", name: "Omniastores", currency_code: "AED" }] } }));
  const accts = await zohoConnector.accountsFromGrant({ accessToken: "at", raw: { api_domain: "https://www.zohoapis.com", accounts_url: "https://accounts.zoho.com" } }, app, {});
  assert.deepEqual(accts.map((a) => a.accountRef), ["799179049", "1"]);
  assert.equal(accts[0].config.org_name, "House of Omnia");
  assert.match(calls[0].url, /\/books\/v3\/organizations$/);
});

test("refresh: invalid_code → GrantRevokedError; other errors are plain", async () => {
  const cfg = zohoConnector.configSchema.parse({});
  mockFetch(() => ({ body: { error: "invalid_code" } }));
  await assert.rejects(zohoConnector.oauth!.refresh({ refresh_token: "r" }, cfg, app), GrantRevokedError);
  mockFetch(() => ({ status: 500, body: { error: "server" } }));
  await assert.rejects(zohoConnector.oauth!.refresh({ refresh_token: "r" }, cfg, app), (e: any) => !(e instanceof GrantRevokedError));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/connectors/zoho.test.ts`
Expected: FAIL — cannot find module `@/lib/connectors/zoho`

- [ ] **Step 3: Implement**

```ts
// lib/connectors/zoho.ts
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { getJson, postForm } from "./http";
import { isZohoAccountsHost } from "./oauth";
import { registerConnector } from "./registry";
import { GrantRevokedError, OAuthFlowError, type ConnectorDef, type Grant, type OAuthApp } from "./types";

export const ZOHO_SCOPE = "ZohoBooks.fullaccess.all";
const DCS = ["https://accounts.zoho.com", "https://accounts.zoho.eu", "https://accounts.zoho.in", "https://accounts.zoho.com.au", "https://accounts.zoho.sa", "https://accounts.zoho.uk"];

const configSchema = z.object({
  accounts_url: z.string().url().default("https://accounts.zoho.com"),
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

const REVOKED = new Set(["invalid_code", "invalid_grant", "invalid_client", "invalid_client_secret", "unauthorized_client"]);

function toGrant(json: any, extra: Record<string, unknown>): Grant {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
    scopes: json.scope,
    raw: { api_domain: json.api_domain, ...extra },
  };
}

export async function zohoRefresh(secrets: ZohoSecrets, config: ZohoConfig, app: OAuthApp): Promise<Grant> {
  if (!isZohoAccountsHost(config.accounts_url)) throw new OAuthFlowError("bad_host", `Refusing Zoho accounts host ${config.accounts_url}`);
  const { status, json } = await postForm(`${config.accounts_url}/oauth/v2/token`, {
    refresh_token: secrets.refresh_token ?? "", client_id: app.clientId, client_secret: app.clientSecret, grant_type: "refresh_token",
  });
  if (json?.access_token) return toGrant(json, { accounts_url: config.accounts_url });
  if (REVOKED.has(String(json?.error))) throw new GrantRevokedError(`Zoho: ${json.error}`);
  throw new Error(`Zoho token refresh failed HTTP ${status}: ${json?.error_description ?? json?.error ?? "no access token"}`);
}

export const zohoConnector: ConnectorDef<ZohoConfig, ZohoSecrets> = {
  provider: "zoho",
  label: "Zoho Books",
  category: "accounting",
  authModes: ["platform", "own_app"],
  grantTypes: { platform: ["authorization_code"], own_app: ["authorization_code", "static_refresh"] },
  configSchema, secretsSchema,
  configFields: [
    { key: "daily_budget", label: "Daily API budget", kind: "number", help: "Zoho caps ~5,000 calls/day per organisation" },
    { key: "default_for_providers", label: "Default books for gateways", kind: "json", help: 'e.g. ["COD"]' },
  ],
  startParams: [{ key: "dc", label: "Zoho data centre", options: DCS }],
  oauth: {
    authorizeUrl({ state, redirectUri, app, params }) {
      const dc = params.dc && isZohoAccountsHost(params.dc) ? params.dc : "https://accounts.zoho.com";
      const q = new URLSearchParams({ scope: ZOHO_SCOPE, client_id: app.clientId, response_type: "code", access_type: "offline", prompt: "consent", redirect_uri: redirectUri, state });
      return `${dc}/oauth/v2/auth?${q}`;
    },
    async exchangeCode({ code, redirectUri, app, query, params }) {
      const server = (query.get("accounts-server") || params.dc || "https://accounts.zoho.com").replace(/\/+$/, "");
      if (!isZohoAccountsHost(server)) throw new OAuthFlowError("bad_host", `Unexpected Zoho accounts server ${server}`);
      const { status, json } = await postForm(`${server}/oauth/v2/token`, {
        code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code",
      });
      if (!json?.access_token) throw new OAuthFlowError("exchange_failed", `Zoho code exchange failed HTTP ${status}: ${json?.error ?? "no token"}`);
      if (!json.refresh_token) throw new OAuthFlowError("exchange_failed", "Zoho returned no refresh token — remove the app's old grant at accounts.zoho.com → Connected Apps and retry");
      return toGrant(json, { accounts_url: server });
    },
    refresh: zohoRefresh,
  },
  async accountsFromGrant(grant) {
    const apiDomain = String(grant.raw.api_domain || "https://www.zohoapis.com");
    const accountsUrl = String(grant.raw.accounts_url || "https://accounts.zoho.com");
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
  async references(conn) {
    const checks: [string, string][] = [["payouts", "zoho_connection_id"], ["statement_accounts", "zoho_connection_id"], ["settlement_records", "zoho_connection_id"], ["zoho_account_config", "zoho_connection_id"]];
    const out: string[] = [];
    for (const [table, col] of checks) {
      const { count } = await supabase.from(table).select("*", { count: "exact", head: true }).eq(col, conn.id);
      if (count) out.push(`${count} ${table.replace(/_/g, " ")}`);
    }
    return out;
  },
};

registerConnector(zohoConnector);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/connectors/zoho.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/connectors/zoho.ts tests/connectors/zoho.test.ts
git commit -m "feat(connections): Zoho Books connector (OAuth + own app, multi-org discovery)"
```

---

### Task 8: Gmail connector

**Files:**
- Create: `lib/connectors/gmail.ts`
- Test: `tests/connectors/gmail.test.ts`

**Interfaces:**
- Produces: `gmailConnector` (registered on import), `GMAIL_SCOPES = "openid email https://www.googleapis.com/auth/gmail.readonly"`, `type GmailConfig = { ingest_queries: Record<string, string>; labels: string[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/connectors/gmail.test.ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { gmailConnector } from "@/lib/connectors/gmail";
import { GrantRevokedError } from "@/lib/connectors/types";

const realFetch = globalThis.fetch;
const calls: { url: string; body?: string }[] = [];
const mock = (status: number, body: unknown) => {
  globalThis.fetch = (async (url: any, init?: any) => { calls.push({ url: String(url), body: init?.body?.toString() }); return new Response(JSON.stringify(body), { status }); }) as typeof fetch;
};
afterEach(() => { globalThis.fetch = realFetch; calls.length = 0; });
const app = { clientId: "cid", clientSecret: "csec" };
const idToken = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;

test("authorize URL: offline, consent, PKCE S256, read-only + email scopes", () => {
  const u = new URL(gmailConnector.oauth!.authorizeUrl({ state: "s", redirectUri: "https://app/cb", app, pkceChallenge: "ch", params: {} }));
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("prompt"), "consent");
  assert.equal(u.searchParams.get("code_challenge"), "ch");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("scope"), "openid email https://www.googleapis.com/auth/gmail.readonly");
});

test("exchangeCode sends the PKCE verifier; mailbox comes from the ID token", async () => {
  mock(200, { access_token: "at", refresh_token: "rt", expires_in: 3599, scope: "x", id_token: idToken({ email: "Marketing@Omnia.com", email_verified: true }) });
  const g = await gmailConnector.oauth!.exchangeCode({ code: "c", redirectUri: "r", app, pkceVerifier: "ver", query: new URLSearchParams(), params: {} });
  assert.match(calls[0].body!, /code_verifier=ver/);
  const [acct] = await gmailConnector.accountsFromGrant(g, app, {});
  assert.equal(acct.accountRef, "marketing@omnia.com");
});

test("refresh: invalid_grant → GrantRevokedError", async () => {
  mock(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
  await assert.rejects(gmailConnector.oauth!.refresh({ refresh_token: "r" }, gmailConnector.configSchema.parse({}), app), GrantRevokedError);
});

test("test(): mailbox mismatch is reported", async () => {
  mock(200, { emailAddress: "other@x.com" });
  const r = await gmailConnector.test({ accountRef: "a@x.com" } as any, "tok");
  assert.equal(r.ok, false);
  assert.match(r.error!, /other@x.com/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/connectors/gmail.test.ts`
Expected: FAIL — cannot find module `@/lib/connectors/gmail`

- [ ] **Step 3: Implement**

```ts
// lib/connectors/gmail.ts
import { z } from "zod";
import { getJson, postForm } from "./http";
import { registerConnector } from "./registry";
import { GrantRevokedError, OAuthFlowError, type ConnectorDef, type Grant } from "./types";

export const GMAIL_SCOPES = "openid email https://www.googleapis.com/auth/gmail.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const configSchema = z.object({
  ingest_queries: z.record(z.string()).default({}),
  labels: z.array(z.string()).default([]),
});
export type GmailConfig = z.infer<typeof configSchema>;
const secretsSchema = z.object({
  client_id: z.string().optional(), client_secret: z.string().optional(), refresh_token: z.string().optional(),
  access_token: z.string().optional(), access_token_expires_at: z.number().optional(), grant_id: z.string().optional(),
});

const grantOf = (json: any): Grant => ({
  accessToken: json.access_token, refreshToken: json.refresh_token, scopes: json.scope,
  expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000, raw: { id_token: json.id_token },
});

function emailFromIdToken(idToken: unknown): string {
  // Received directly from Google's token endpoint over TLS, so the payload is
  // trusted without verifying the signature (OIDC Core §3.1.3.7).
  const part = String(idToken ?? "").split(".")[1];
  if (!part) throw new OAuthFlowError("no_accounts", "Google returned no ID token — the email scope is required");
  const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  if (!claims.email) throw new OAuthFlowError("no_accounts", "Google ID token has no email");
  return String(claims.email).toLowerCase();
}

export const gmailConnector: ConnectorDef<GmailConfig, z.infer<typeof secretsSchema>> = {
  provider: "gmail",
  label: "Gmail",
  category: "email",
  authModes: ["platform", "own_app"],
  grantTypes: { platform: ["authorization_code"], own_app: ["authorization_code"] },
  configSchema, secretsSchema,
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
      if (!json.refresh_token) throw new OAuthFlowError("exchange_failed", "Google returned no refresh token — remove the app at myaccount.google.com/permissions and retry");
      return grantOf(json);
    },
    async refresh(secrets, _config, app) {
      const { status, json } = await postForm(TOKEN_URL, {
        refresh_token: secrets.refresh_token ?? "", client_id: app.clientId, client_secret: app.clientSecret, grant_type: "refresh_token",
      });
      if (json?.access_token) return grantOf(json);
      if (json?.error === "invalid_grant" || json?.error === "unauthorized_client") throw new GrantRevokedError(`Google: ${json.error_description ?? json.error}`);
      throw new Error(`Google token refresh failed HTTP ${status}: ${json?.error ?? ""}`);
    },
    async revoke(secrets) {
      const token = secrets.refresh_token ?? secrets.access_token;
      if (token) await postForm("https://oauth2.googleapis.com/revoke", { token });
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
    if (email !== conn.accountRef) return { ok: false, error: `Token belongs to ${email}, not ${conn.accountRef}` };
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/connectors/gmail.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/connectors/gmail.ts tests/connectors/gmail.test.ts
git commit -m "feat(connections): Gmail connector with PKCE and mailbox-from-ID-token"
```

---

### Task 9: Shopify connector (four ways in, orders preview, stores row)

**Files:**
- Create: `lib/connectors/shopify.ts`
- Test: `tests/connectors/shopify.test.ts`

**Interfaces:**
- Consumes: `isShopDomain`, `verifyShopifyHmac`, `postJson/postForm`, `normalizeShopifyOrder` + `ORDERS_QUERY` (export `ORDERS_QUERY` from `lib/integrations/shopify.ts` if it is not exported — it is `const ORDERS_QUERY` today; change to `export const ORDERS_QUERY`).
- Produces: `shopifyConnector`, `SHOPIFY_SCOPES: string[]`, `type ShopifyConfig = { store_id: string; shop_name: string; currency: string; timezone: string; api_version: string; webhook_topics: string[] }`, `shopifyGraphql(shop: string, token: string, apiVersion: string, query: string, variables?: object): Promise<any>`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/connectors/shopify.test.ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { shopifyConnector, SHOPIFY_SCOPES } from "@/lib/connectors/shopify";
import { OAuthFlowError } from "@/lib/connectors/types";

const realFetch = globalThis.fetch;
const calls: { url: string; body?: string }[] = [];
const mock = (fn: (url: string, body: string) => { status?: number; body: unknown }) => {
  globalThis.fetch = (async (url: any, init?: any) => {
    const b = init?.body?.toString() ?? "";
    calls.push({ url: String(url), body: b });
    const r = fn(String(url), b);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
};
afterEach(() => { globalThis.fetch = realFetch; calls.length = 0; });
const app = { clientId: "cid", clientSecret: "csec" };
const params = { shop: "omnia-uae.myshopify.com", store_id: "UAE" };

test("authorize URL targets the shop admin with the required scopes", () => {
  const u = new URL(shopifyConnector.oauth!.authorizeUrl({ state: "s", redirectUri: "https://app/cb", app, params }));
  assert.equal(u.origin + u.pathname, "https://omnia-uae.myshopify.com/admin/oauth/authorize");
  assert.equal(u.searchParams.get("scope"), SHOPIFY_SCOPES.join(","));
  assert.equal(u.searchParams.get("state"), "s");
});

test("authorize URL refuses a non-myshopify shop", () => {
  assert.throws(() => shopifyConnector.oauth!.authorizeUrl({ state: "s", redirectUri: "r", app, params: { shop: "evil.com", store_id: "X" } }), (e: any) => e instanceof OAuthFlowError && e.code === "bad_host");
});

test("verifyCallback: HMAC and shop must match the state's shop", () => {
  const q = new URLSearchParams({ code: "c", shop: "omnia-uae.myshopify.com", state: "s", timestamp: "1" });
  const msg = [...q.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
  q.set("hmac", createHmac("sha256", "csec").update(msg).digest("hex"));
  assert.doesNotThrow(() => shopifyConnector.verifyCallback!(q, app, params));
  assert.throws(() => shopifyConnector.verifyCallback!(q, app, { ...params, shop: "other.myshopify.com" }), (e: any) => e.code === "bad_host");
  q.set("code", "tampered");
  assert.throws(() => shopifyConnector.verifyCallback!(q, app, params), (e: any) => e.code === "bad_hmac");
});

test("exchangeCode → non-expiring offline token", async () => {
  mock(() => ({ body: { access_token: "shpua_x", scope: "read_orders" } }));
  const g = await shopifyConnector.oauth!.exchangeCode({ code: "c", redirectUri: "r", app, query: new URLSearchParams(), params });
  assert.equal(calls[0].url, "https://omnia-uae.myshopify.com/admin/oauth/access_token");
  assert.equal(g.expiresAt, undefined);
});

test("client credentials → 24h token", async () => {
  mock(() => ({ body: { access_token: "t", scope: "read_orders", expires_in: 86399 } }));
  const g = await shopifyConnector.oauth!.clientCredentials!(app, shopifyConnector.configSchema.parse({ store_id: "UAE", shop: "omnia-uae.myshopify.com" }), {});
  assert.match(calls[0].body!, /grant_type=client_credentials/);
  assert.ok(g.expiresAt! > Date.now() + 86_000_000);
});

test("test() reports missing scopes by name", async () => {
  mock(() => ({ body: { data: { shop: { name: "Omnia UAE", currencyCode: "AED", ianaTimezone: "Asia/Dubai" }, currentAppInstallation: { accessScopes: [{ handle: "read_orders" }] } } } }));
  const conn = { accountRef: "omnia-uae.myshopify.com", config: shopifyConnector.configSchema.parse({ store_id: "UAE", shop: "omnia-uae.myshopify.com" }) } as any;
  const r = await shopifyConnector.test(conn, "tok");
  assert.equal(r.ok, true);
  assert.ok(r.missingScopes!.includes("read_shopify_payments_payouts"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/connectors/shopify.test.ts`
Expected: FAIL — cannot find module `@/lib/connectors/shopify`

- [ ] **Step 3: Export the orders query**

In `lib/integrations/shopify.ts` change `const ORDERS_QUERY = /* GraphQL */` to `export const ORDERS_QUERY = /* GraphQL */`.

- [ ] **Step 4: Implement**

```ts
// lib/connectors/shopify.ts
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { peekSetting } from "@/lib/settings";
import { ORDERS_QUERY } from "@/lib/integrations/shopify";
import { normalizeShopifyOrder } from "@/lib/normalize/order";
import { postForm, postJson } from "./http";
import { isShopDomain, verifyShopifyHmac } from "./oauth";
import { registerConnector } from "./registry";
import { GrantRevokedError, OAuthFlowError, type ConnectorDef, type Grant } from "./types";

export const SHOPIFY_SCOPES = [
  "read_orders", "read_all_orders", "read_products", "read_inventory", "write_inventory",
  "read_customers", "read_shopify_payments_payouts", "read_reports",
];

const configSchema = z.object({
  store_id: z.string().regex(/^[A-Z0-9_]+$/, "Store code: capitals, digits, underscore"),
  shop: z.string().refine(isShopDomain, "Must be xxx.myshopify.com"),
  shop_name: z.string().default(""),
  currency: z.string().default(""),
  timezone: z.string().default(""),
  api_version: z.string().default(""),
  webhook_topics: z.array(z.string()).default(["ORDERS_CREATE", "ORDERS_PAID", "INVENTORY_LEVELS_UPDATE"]),
});
export type ShopifyConfig = z.infer<typeof configSchema>;
const secretsSchema = z.object({
  client_id: z.string().optional(), client_secret: z.string().optional(), access_token: z.string().optional(),
  access_token_expires_at: z.number().optional(), webhook_secret: z.string().optional(), refresh_token: z.string().optional(), grant_id: z.string().optional(),
});

const version = (c?: { api_version?: string }) => c?.api_version || peekSetting<string>("shopify.api_version");

export async function shopifyGraphql(shop: string, token: string, apiVersion: string, query: string, variables: object = {}) {
  const { status, json } = await postJson(`https://${shop}/admin/api/${apiVersion}/graphql.json`, { query, variables }, { "X-Shopify-Access-Token": token });
  if (status === 401 || status === 403) throw new GrantRevokedError(`Shopify ${shop}: HTTP ${status}`);
  if (status !== 200 || json.errors) throw new Error(`Shopify ${shop} GraphQL failed HTTP ${status}: ${JSON.stringify(json.errors ?? json).slice(0, 300)}`);
  return json.data;
}

function shopOf(params: Record<string, string>): string {
  const shop = (params.shop ?? "").trim().toLowerCase();
  if (!isShopDomain(shop)) throw new OAuthFlowError("bad_host", `"${shop}" is not a xxx.myshopify.com domain`);
  return shop;
}

async function tokenRequest(shop: string, body: Record<string, string>): Promise<Grant> {
  const { status, json } = await postForm(`https://${shop}/admin/oauth/access_token`, body);
  if (!json?.access_token) {
    if (status === 400 || status === 401) throw new GrantRevokedError(`Shopify ${shop}: ${json?.error_description ?? json?.error ?? status}`);
    throw new OAuthFlowError("exchange_failed", `Shopify token request failed HTTP ${status}`);
  }
  return {
    accessToken: json.access_token, scopes: json.scope,
    expiresAt: json.expires_in ? Date.now() + Number(json.expires_in) * 1000 : undefined,
    raw: { shop },
  };
}

const SHOP_QUERY = `{ shop { name currencyCode ianaTimezone myshopifyDomain } currentAppInstallation { accessScopes { handle } } }`;

export const shopifyConnector: ConnectorDef<ShopifyConfig, z.infer<typeof secretsSchema>> = {
  provider: "shopify",
  label: "Shopify",
  category: "store",
  authModes: ["platform", "own_app", "token"],
  grantTypes: { platform: ["authorization_code"], own_app: ["authorization_code", "client_credentials"], token: ["static_token"] },
  configSchema, secretsSchema,
  configFields: [
    { key: "store_id", label: "Store code", kind: "text", help: "Used on orders, e.g. UAE" },
    { key: "api_version", label: "API version override", kind: "text" },
  ],
  startParams: [
    { key: "shop", label: "Shop domain", pattern: "^[a-z0-9][a-z0-9-]*\\.myshopify\\.com$" },
    { key: "store_id", label: "Store code", pattern: "^[A-Z0-9_]+$" },
  ],
  oauth: {
    authorizeUrl({ state, redirectUri, app, params }) {
      const q = new URLSearchParams({ client_id: app.clientId, scope: SHOPIFY_SCOPES.join(","), redirect_uri: redirectUri, state });
      return `https://${shopOf(params)}/admin/oauth/authorize?${q}`;
    },
    async exchangeCode({ code, app, params }) {
      return tokenRequest(shopOf(params), { client_id: app.clientId, client_secret: app.clientSecret, code });
    },
    async refresh(_s, config, app) {
      // Only client-credentials tokens expire; re-mint the same way.
      return tokenRequest(config.shop, { client_id: app.clientId, client_secret: app.clientSecret, grant_type: "client_credentials" });
    },
    async clientCredentials(app, config, params) {
      const shop = config?.shop ?? shopOf(params);
      return tokenRequest(shop, { client_id: app.clientId, client_secret: app.clientSecret, grant_type: "client_credentials" });
    },
  },
  verifyCallback(query, app, params) {
    if ((query.get("shop") ?? "").toLowerCase() !== shopOf(params)) throw new OAuthFlowError("bad_host", "Callback shop differs from the shop you started with");
    if (!verifyShopifyHmac(query, app.clientSecret)) throw new OAuthFlowError("bad_hmac", "Shopify callback signature is invalid");
  },
  async accountsFromGrant(grant, _app, params) {
    const shop = shopOf(params);
    const d = await shopifyGraphql(shop, grant.accessToken, version(), SHOP_QUERY);
    return [{
      accountRef: shop, label: d.shop.name,
      config: { store_id: params.store_id, shop, shop_name: d.shop.name, currency: d.shop.currencyCode, timezone: d.shop.ianaTimezone },
      scopes: (d.currentAppInstallation?.accessScopes ?? []).map((s: any) => s.handle).join(","),
    }];
  },
  async test(conn, token) {
    const d = await shopifyGraphql(conn.config.shop, token, version(conn.config), SHOP_QUERY);
    const granted: string[] = (d.currentAppInstallation?.accessScopes ?? []).map((s: any) => s.handle);
    const missingScopes = SHOPIFY_SCOPES.filter((s) => !granted.includes(s) && !(s.startsWith("read_") && granted.includes(s.replace("read_", "write_"))));
    return { ok: true, accountName: d.shop.name, scopes: granted.join(","), missingScopes };
  },
  async onConnect(conn, token) {
    const { data: existing } = await supabase.from("stores").select("id").eq("store_id", conn.config.store_id).maybeSingle();
    const row = { store_id: conn.config.store_id, platform: "shopify", domain: conn.config.shop, currency: conn.config.currency || "AED", timezone: conn.config.timezone || "Asia/Dubai" };
    const { error } = existing
      ? await supabase.from("stores").update(row).eq("id", existing.id)
      : await supabase.from("stores").insert({ id: randomUUID(), ...row });
    if (error) throw new Error(`stores upsert failed: ${error.message}`);
    if (conn.authMode === "token") return; // legacy custom apps keep the webhooks configured in the Shopify admin
    const base = String(peekSetting<string>("app.public_url")).replace(/\/+$/, "");
    const paths: Record<string, string> = { ORDERS_CREATE: "orders-create", ORDERS_PAID: "orders-paid", INVENTORY_LEVELS_UPDATE: "inventory-update" };
    for (const topic of conn.config.webhook_topics) {
      const path = paths[topic];
      if (!path) continue;
      await shopifyGraphql(conn.config.shop, token, version(conn.config),
        `mutation($t: WebhookSubscriptionTopic!, $u: URL!) { webhookSubscriptionCreate(topic: $t, webhookSubscription: { callbackUrl: $u, format: JSON }) { userErrors { message } } }`,
        { t: topic, u: `${base}/api/webhooks/shopify/${conn.config.store_id}/${path}` });
    }
  },
  async references(conn) {
    const { count } = await supabase.from("orders").select("*", { count: "exact", head: true }).eq("store_id", conn.config.store_id);
    return count ? [`${count} orders (disable instead — order history stays)`] : [];
  },
  async listOrders(conn, token, { since, limit }) {
    const d = await shopifyGraphql(conn.config.shop, token, version(conn.config), ORDERS_QUERY, {
      first: Math.min(limit, 50), after: null, query: since ? `updated_at:>=${since}` : null,
    });
    return (d.orders?.edges ?? []).map((e: any) => normalizeShopifyOrder(e.node, conn.config.store_id));
  },
};

registerConnector(shopifyConnector);
```

Before Step 5, open `lib/integrations/shopify.ts` and confirm `ORDERS_QUERY`'s variable names are `$first`, `$after`, `$query` (they are, per lines 64–70) and that `normalizeShopifyOrder` accepts `edge.node` — check how `fetchShopifyOrders` calls it and pass the identical shape (if it passes `edge.node`, the code above is right; if it maps nodes first, copy that mapping).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test tests/connectors/shopify.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/connectors/shopify.ts lib/integrations/shopify.ts tests/connectors/shopify.test.ts
git commit -m "feat(connections): Shopify connector — OAuth, client credentials, legacy tokens, orders preview"
```

---

### Task 10: Connect flow + API routes

**Files:**
- Create: `lib/connectors/flow.ts`, `lib/connectors/index.ts`
- Create: `app/api/connections/route.ts`, `app/api/connections/[id]/route.ts`, `app/api/connections/[id]/test/route.ts`, `app/api/connections/[id]/sync/route.ts`, `app/api/connections/[id]/orders/route.ts`, `app/api/connections/oauth/[provider]/start/route.ts`, `app/api/connections/oauth/[provider]/callback/route.ts`, `app/api/connections/pending/[id]/route.ts`, `app/api/settings/route.ts`
- Test: `tests/connectors/flow.test.ts`

**Interfaces:**
- Consumes: Tasks 3–9.
- Produces:
  - `lib/connectors/index.ts` — imports `./zoho`, `./gmail`, `./shopify` (registers them) and re-exports `./runtime`. **Every app/lib caller imports from `@/lib/connectors`** so providers are always registered.
  - `startConnect(input: StartInput, actor: string): Promise<{ redirect: string } | { connection: PublicConnection }>` with `StartInput = { provider: string; authMode: AuthMode; grantType?: GrantType; ownApp?: { clientId: string; clientSecret: string }; token?: string; refreshToken?: string; webhookSecret?: string; params?: Record<string, string> }`
  - `completeCallback(provider: string, query: URLSearchParams, actor: string): Promise<{ connectionIds: string[] } | { pendingId: string }>`
  - `completePending(pendingId: string, accountRefs: string[], actor: string): Promise<string[]>`
  - `finishConnection(input: SaveInput): Promise<Connection>` (save + onConnect + test)
  - `registerSyncHandler(provider: string, fn: (conn: Connection) => Promise<{ summary: string }>)`, `runSync(id: string)` — Task 14 registers Shopify/Gmail/Zoho handlers.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/connectors/flow.test.ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { z } from "zod";

process.env.CONNECTIONS_KEY = randomBytes(32).toString("base64");
const { setSettingsBackend, memorySettingsBackend, setSetting } = await import("@/lib/settings");
const { memoryConnectionStore } = await import("@/lib/connectors/store");
const rt = await import("@/lib/connectors/runtime");
const { registerConnector } = await import("@/lib/connectors/registry");
const oauth = await import("@/lib/connectors/oauth");
const flow = await import("@/lib/connectors/flow");

let accounts = [{ accountRef: "org-1", label: "Org 1", config: {} }];
let onConnectCalls = 0;
registerConnector({
  provider: "multi", label: "Multi", category: "accounting",
  authModes: ["own_app", "token"], grantTypes: { own_app: ["authorization_code"], token: ["static_token"] },
  configSchema: z.object({}).passthrough(), secretsSchema: z.object({}).passthrough() as any, configFields: [],
  oauth: {
    authorizeUrl: ({ state, redirectUri }) => `https://idp/auth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: async ({ code }) => ({ accessToken: `at-${code}`, refreshToken: "rt", expiresAt: Date.now() + 3600_000, raw: {} }),
    refresh: async () => ({ accessToken: "x", expiresAt: Date.now() + 3600_000, raw: {} }),
  },
  accountsFromGrant: async () => accounts,
  test: async () => ({ ok: true, accountName: "ok" }),
  onConnect: async () => { onConnectCalls++; },
});

beforeEach(async () => {
  setSettingsBackend(memorySettingsBackend());
  await setSetting("app.public_url", "https://os.example.com", "t");
  rt.setConnectionStore(memoryConnectionStore());
  rt.setAlertSink(async () => {});
  oauth.setOAuthStateStore(oauth.memoryOAuthStateStore());
  accounts = [{ accountRef: "org-1", label: "Org 1", config: {} }];
  onConnectCalls = 0;
});

const stateOf = (url: string) => new URL(url).searchParams.get("state")!;

test("own-app start → callback with one account → active connection, onConnect ran", async () => {
  const r = await flow.startConnect({ provider: "multi", authMode: "own_app", ownApp: { clientId: "c", clientSecret: "s" } }, "admin") as { redirect: string };
  assert.match(r.redirect, /redirect_uri=https%3A%2F%2Fos\.example\.com%2Fapi%2Fconnections%2Foauth%2Fmulti%2Fcallback/);
  const done = await flow.completeCallback("multi", new URLSearchParams({ code: "abc", state: stateOf(r.redirect) }), "admin") as { connectionIds: string[] };
  const c = await rt.getConnection(done.connectionIds[0]);
  assert.equal(c!.status, "active");
  assert.equal(c!.secrets.client_secret, "s");
  assert.equal(c!.secrets.refresh_token, "rt");
  assert.equal(onConnectCalls, 1);
});

test("several accounts → pending picker → chosen accounts become connections sharing one grant", async () => {
  accounts = [{ accountRef: "org-1", label: "A", config: {} }, { accountRef: "org-2", label: "B", config: {} }, { accountRef: "org-3", label: "C", config: {} }];
  const r = await flow.startConnect({ provider: "multi", authMode: "own_app", ownApp: { clientId: "c", clientSecret: "s" } }, "admin") as { redirect: string };
  const p = await flow.completeCallback("multi", new URLSearchParams({ code: "abc", state: stateOf(r.redirect) }), "admin") as { pendingId: string };
  const ids = await flow.completePending(p.pendingId, ["org-1", "org-3"], "admin");
  assert.equal(ids.length, 2);
  const [a, b] = await Promise.all(ids.map((id) => rt.getConnection(id)));
  assert.equal(a!.secrets.grant_id, b!.secrets.grant_id);
});

test("provider error in callback (?error=access_denied) → OAuthFlowError denied, nothing saved", async () => {
  const r = await flow.startConnect({ provider: "multi", authMode: "own_app", ownApp: { clientId: "c", clientSecret: "s" } }, "admin") as { redirect: string };
  await assert.rejects(flow.completeCallback("multi", new URLSearchParams({ error: "access_denied", state: stateOf(r.redirect) }), "admin"), (e: any) => e.code === "denied");
  assert.equal((await rt.listConnections()).length, 0);
});

test("token mode saves without redirect", async () => {
  const r = await flow.startConnect({ provider: "multi", authMode: "token", token: "tok", params: { account: "acct-t" } }, "admin") as any;
  assert.ok(r.connection);
  assert.equal(r.connection.secrets, undefined);
});

test("platform mode without platform credentials → no_app", async () => {
  await assert.rejects(flow.startConnect({ provider: "multi", authMode: "platform" } as any, "admin"), (e: any) => e.code === "bad_request" || e.code === "no_app");
});
```

For the token-mode test the fake connector's `accountsFromGrant` returns `accounts` — token mode resolves the account the same way (it builds a `Grant` from the pasted token and calls `accountsFromGrant`), so `params.account` is unused by the fake; the assertion only checks a connection was created.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/connectors/flow.test.ts`
Expected: FAIL — cannot find module `@/lib/connectors/flow`

- [ ] **Step 3: Implement the flow**

```ts
// lib/connectors/flow.ts
import { getConnector } from "./registry";
import {
  consumeState, createState, redirectUri, savePendingGrant, takePendingGrant,
} from "./oauth";
import {
  getAccessToken, getConnection, grantFingerprint, isLiveStore, resolveApp, saveConnection, setConnectionError, testConnection, toPublic, type SaveInput,
} from "./runtime";
import { OAuthFlowError, type AuthMode, type Connection, type DiscoveredAccount, type Grant, type GrantType, type OAuthApp, type PublicConnection } from "./types";

export type StartInput = {
  provider: string; authMode: AuthMode; grantType?: GrantType;
  ownApp?: { clientId: string; clientSecret: string };
  token?: string; refreshToken?: string; webhookSecret?: string;
  params?: Record<string, string>;
};

/** Save, then run onConnect and a live test. A failing onConnect leaves the
 *  row in "error" with the reason rather than throwing away the grant. */
export async function finishConnection(input: SaveInput): Promise<Connection> {
  const conn = await saveConnection(input);
  const def = getConnector(conn.provider);
  if (def.onConnect) {
    try { await def.onConnect(conn, await getAccessToken(conn)); }
    catch (e) {
      await setConnectionError(conn.id, `Setup step failed: ${(e as Error).message}`);
      return (await getConnection(conn.id))!;
    }
  }
  await testConnection(conn.id);
  if (!isLiveStore()) return (await getConnection(conn.id))!;
  const { writeAudit } = await import("@/lib/audit");
  await writeAudit({ entity: "connection", entityId: conn.id, event: "connected", actor: input.connectedBy, payload: { provider: conn.provider, authMode: conn.authMode, accountRef: conn.accountRef } });
  return (await getConnection(conn.id))!;
}

function cleanParams(def: ReturnType<typeof getConnector>, params: Record<string, string> = {}): Record<string, string> {
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

const accountSecrets = (grant: Grant, app: OAuthApp | null, authMode: AuthMode) => ({
  ...(authMode === "own_app" && app ? { client_id: app.clientId, client_secret: app.clientSecret } : {}),
  access_token: grant.accessToken,
  access_token_expires_at: grant.expiresAt,
  ...(grant.refreshToken ? { refresh_token: grant.refreshToken, grant_id: grantFingerprint(grant.refreshToken) } : {}),
});

async function saveAccounts(provider: string, authMode: AuthMode, grantType: GrantType, grant: Grant, app: OAuthApp | null, accounts: DiscoveredAccount[], actor: string, extraSecrets: Record<string, string> = {}): Promise<string[]> {
  const ids: string[] = [];
  for (const a of accounts) {
    const conn = await finishConnection({
      provider, authMode, grantType, accountRef: a.accountRef, label: a.label, config: a.config,
      secrets: { ...accountSecrets(grant, app, authMode), ...extraSecrets }, scopes: a.scopes ?? grant.scopes ?? "", connectedBy: actor,
    });
    ids.push(conn.id);
  }
  return ids;
}

export async function startConnect(input: StartInput, actor: string): Promise<{ redirect: string } | { connection: PublicConnection }> {
  const def = getConnector(input.provider);
  if (!def.authModes.includes(input.authMode)) throw new OAuthFlowError("bad_request", `${def.label} does not support ${input.authMode}`);
  const grantType = input.grantType ?? def.grantTypes[input.authMode]?.[0];
  if (!grantType || !def.grantTypes[input.authMode]?.includes(grantType)) throw new OAuthFlowError("bad_request", `Unsupported grant type for ${def.label}`);
  const params = cleanParams(def, input.params);
  const ownApp = input.ownApp && input.ownApp.clientId.trim() && input.ownApp.clientSecret.trim()
    ? { clientId: input.ownApp.clientId.trim(), clientSecret: input.ownApp.clientSecret.trim() } : null;
  if (input.authMode === "own_app" && !ownApp) throw new OAuthFlowError("bad_request", "Client ID and client secret are required");
  const app = input.authMode === "platform" ? resolveApp({ provider: def.provider, authMode: "platform", secrets: {} }) : ownApp;
  if (input.authMode === "platform" && !app) throw new OAuthFlowError("no_app", `${def.label} platform app is not configured on this deployment`);
  const extra = input.webhookSecret?.trim() ? { webhook_secret: input.webhookSecret.trim() } : {};

  // No redirect: pasted access token, pasted refresh token, or client credentials.
  if (grantType === "static_token" || grantType === "static_refresh" || grantType === "client_credentials") {
    let grant: Grant;
    if (grantType === "static_token") {
      if (!input.token?.trim()) throw new OAuthFlowError("bad_request", "Paste the access token");
      grant = { accessToken: input.token.trim(), raw: {} };
    } else if (grantType === "static_refresh") {
      if (!input.refreshToken?.trim() || !def.oauth) throw new OAuthFlowError("bad_request", "Paste the refresh token");
      const cfg = def.configSchema.parse({ ...(params.dc ? { accounts_url: params.dc } : {}) });
      grant = await def.oauth.refresh({ refresh_token: input.refreshToken.trim() } as any, cfg, app!);
      grant.refreshToken = input.refreshToken.trim();
    } else {
      if (!def.oauth?.clientCredentials) throw new OAuthFlowError("bad_request", "Client credentials not supported");
      grant = await def.oauth.clientCredentials(app!, null as any, params);
    }
    const accounts = await def.accountsFromGrant(grant, app ?? { clientId: "", clientSecret: "" }, params);
    if (!accounts.length) throw new OAuthFlowError("no_accounts", "These credentials reach no account");
    const ids = await saveAccounts(def.provider, input.authMode, grantType, grant, app, accounts, actor, extra);
    return { connection: toPublic((await getConnection(ids[0]))!) };
  }

  const pkce = def.provider === "gmail";
  const { state, pkceChallenge } = await createState(
    { provider: def.provider, authMode: input.authMode, pendingApp: ownApp, params: { ...params, ...extra, grant_type: grantType }, createdBy: actor },
    { pkce },
  );
  return { redirect: def.oauth!.authorizeUrl({ state, redirectUri: await redirectUri(def.provider), app: app!, pkceChallenge, params }) };
}

export async function completeCallback(provider: string, query: URLSearchParams, actor: string): Promise<{ connectionIds: string[] } | { pendingId: string }> {
  const def = getConnector(provider);
  const rec = await consumeState(query.get("state") ?? "", provider, actor);
  if (query.get("error")) throw new OAuthFlowError("denied", `${def.label}: ${query.get("error_description") ?? query.get("error")}`);
  const app = rec.authMode === "platform" ? resolveApp({ provider, authMode: "platform", secrets: {} }) : rec.pendingApp;
  if (!app) throw new OAuthFlowError("no_app", "App credentials missing");
  const { grant_type, webhook_secret, ...params } = rec.params;
  def.verifyCallback?.(query, app, params);
  const code = query.get("code");
  if (!code) throw new OAuthFlowError("bad_request", "No authorization code returned");
  const grant = await def.oauth!.exchangeCode({ code, redirectUri: await redirectUri(provider), app, pkceVerifier: rec.pkceVerifier || undefined, query, params });
  const accounts = await def.accountsFromGrant(grant, app, params);
  if (!accounts.length) throw new OAuthFlowError("no_accounts", `${def.label} login reaches no account`);
  const extra = webhook_secret ? { webhook_secret } : {};
  if (accounts.length > 1) {
    return { pendingId: await savePendingGrant({ provider, authMode: rec.authMode, grant, app, accounts, params: { ...params, grant_type: grant_type ?? "authorization_code", ...extra }, createdBy: actor }) };
  }
  return { connectionIds: await saveAccounts(provider, rec.authMode, (grant_type as GrantType) ?? "authorization_code", grant, app, accounts, actor, extra) };
}

export async function completePending(pendingId: string, accountRefs: string[], actor: string): Promise<string[]> {
  const p = await takePendingGrant(pendingId, actor);
  const chosen = p.accounts.filter((a) => accountRefs.includes(a.accountRef));
  if (!chosen.length) throw new OAuthFlowError("bad_request", "Pick at least one account");
  const { grant_type, webhook_secret } = p.params;
  return saveAccounts(p.provider, p.authMode, (grant_type as GrantType) ?? "authorization_code", p.grant, p.app, chosen, actor, webhook_secret ? { webhook_secret } : {});
}

/* ── Sync now ─────────────────────────────────────────────────────────── */
type SyncHandler = (conn: Connection) => Promise<{ summary: string }>;
const syncHandlers = new Map<string, SyncHandler>();
export function registerSyncHandler(provider: string, fn: SyncHandler) { syncHandlers.set(provider, fn); }
export async function runSync(id: string): Promise<{ summary: string }> {
  const conn = await getConnection(id);
  if (!conn) throw new Error("Connection not found");
  const fn = syncHandlers.get(conn.provider);
  if (!fn) return { summary: "Nothing to sync for this connection" };
  const out = await fn(conn);
  const { markSynced } = await import("./runtime");
  await markSynced(id);
  return out;
}
```

Add these two helpers to `lib/connectors/runtime.ts` (used above and by Task 11):

```ts
export async function setConnectionError(id: string, message: string): Promise<void> {
  await store.update(currentTenant(), id, { status: "error", last_error: message });
}

/** False for the in-memory test store — audit writes are skipped so tests stay offline. */
export const isLiveStore = () => store === supabaseConnectionStore;
```

In `updateConnection` and `removeConnection` (Task 5) wrap the `writeAudit` calls in `if (isLiveStore()) { … }`.

```ts
// lib/connectors/index.ts
// Importing this module registers every built connector. App code imports
// connector functions from here, never from ./runtime directly.
import "./zoho";
import "./gmail";
import "./shopify";

export * from "./runtime";
export * from "./types";
export { allConnectors, getConnector } from "./registry";
export { startConnect, completeCallback, completePending, registerSyncHandler, runSync } from "./flow";
export { peekPendingAccounts } from "./oauth";
```

- [ ] **Step 4: Run flow tests**

Run: `npx tsx --test tests/connectors/flow.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Implement the routes**

```ts
// app/api/connections/route.ts
import { NextResponse } from "next/server";
import { allConnectors, listPublicConnections } from "@/lib/connectors";
import { resolveApp } from "@/lib/connectors";

export const dynamic = "force-dynamic";

// GET → { connections: PublicConnection[], catalogue: [...] } — any signed-in role; never secrets.
export async function GET() {
  try {
    const catalogue = allConnectors().map((d) => ({
      provider: d.provider, label: d.label, category: d.category, authModes: d.authModes, grantTypes: d.grantTypes,
      startParams: d.startParams ?? [], configFields: d.configFields,
      platformAvailable: Boolean(resolveApp({ provider: d.provider, authMode: "platform", secrets: {} })),
    }));
    return NextResponse.json({ connections: await listPublicConnections(), catalogue });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
```

```ts
// app/api/connections/oauth/[provider]/start/route.ts
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session-role";
import { startConnect, OAuthFlowError } from "@/lib/connectors";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  const { provider } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, any>;
  try {
    const out = await startConnect({ ...body, provider } as any, auth.session.username);
    return NextResponse.json(out);
  } catch (e) {
    const status = e instanceof OAuthFlowError ? 400 : 422;
    return NextResponse.json({ error: (e as Error).message, code: (e as any).code }, { status });
  }
}
```

```ts
// app/api/connections/oauth/[provider]/callback/route.ts
import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/session-role";
import { completeCallback, OAuthFlowError } from "@/lib/connectors";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/settings?tab=connections&${q}`, url.origin));
  const session = await currentSession();
  if (!session || session.role !== "admin") return back("error=not_admin");
  try {
    const out = await completeCallback(provider, url.searchParams, session.username);
    if ("pendingId" in out) return back(`pick=${encodeURIComponent(out.pendingId)}`);
    return back(`connected=${encodeURIComponent(out.connectionIds.join(","))}`);
  } catch (e) {
    const code = e instanceof OAuthFlowError ? e.code : "exchange_failed";
    await writeAudit({ entity: "connection", entityId: provider, event: "connect_failed", actor: session.username, payload: { code, message: (e as Error).message } });
    return back(`error=${code}&message=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
  }
}
```

```ts
// app/api/connections/pending/[id]/route.ts
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session-role";
import { completePending, peekPendingAccounts } from "@/lib/connectors";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  const p = await peekPendingAccounts((await params).id);
  return p ? NextResponse.json(p) : NextResponse.json({ error: "This account picker expired — connect again" }, { status: 410 });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  const { accountRefs } = (await req.json().catch(() => ({}))) as { accountRefs?: string[] };
  try {
    return NextResponse.json({ connectionIds: await completePending((await params).id, accountRefs ?? [], auth.session.username) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
```

```ts
// app/api/connections/[id]/route.ts
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session-role";
import { getConnection, removeConnection, toPublic, updateConnection } from "@/lib/connectors";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await getConnection((await params).id);
  return c ? NextResponse.json({ connection: toPublic(c) }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

// PATCH { label?, config?, status?: "active"|"disabled", secrets?: { webhook_secret?, client_id?, client_secret?, access_token? } }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  const b = (await req.json().catch(() => ({}))) as Record<string, any>;
  if (b.status && !["active", "disabled"].includes(b.status)) return NextResponse.json({ error: "status must be active or disabled" }, { status: 400 });
  const allowedSecrets = ["webhook_secret", "client_id", "client_secret", "access_token"];
  const secrets = b.secrets ? Object.fromEntries(Object.entries(b.secrets).filter(([k, v]) => allowedSecrets.includes(k) && typeof v === "string" && v.trim())) : undefined;
  try {
    await updateConnection((await params).id, { label: b.label, config: b.config, status: b.status, secrets }, auth.session.username);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  const out = await removeConnection((await params).id, auth.session.username);
  return "blocked" in out
    ? NextResponse.json({ error: `Still used by: ${out.blocked.join("; ")}. Disable it instead.`, blocked: out.blocked }, { status: 409 })
    : NextResponse.json(out);
}
```

```ts
// app/api/connections/[id]/test/route.ts
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session-role";
import { testConnection } from "@/lib/connectors";

export const dynamic = "force-dynamic";
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  return NextResponse.json(await testConnection((await params).id));
}
```

```ts
// app/api/connections/[id]/sync/route.ts
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session-role";
import { runSync, ReauthRequiredError } from "@/lib/connectors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  try {
    return NextResponse.json(await runSync((await params).id));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, reauth: e instanceof ReauthRequiredError }, { status: e instanceof ReauthRequiredError ? 409 : 500 });
  }
}
```

```ts
// app/api/connections/[id]/orders/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAccessToken, getConnection, getConnector, ReauthRequiredError } from "@/lib/connectors";
import { chunkForInFilter } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET ?limit=50 → { orders: [{...OrderRow, inOurDb: boolean}], storeId, totalInDb }
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const conn = await getConnection((await params).id);
  if (!conn) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const def = getConnector(conn.provider);
  if (!def.listOrders) return NextResponse.json({ error: `${def.label} has no orders` }, { status: 400 });
  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") ?? 50) || 50, 50);
  try {
    const live = await def.listOrders(conn, await getAccessToken(conn), { limit });
    const storeId = String((conn.config as any).store_id ?? "");
    const ids = live.map((o) => o.id);
    const known = new Set<string>();
    for (const chunk of chunkForInFilter(ids)) {
      const { data } = await supabase.from("orders").select("id").in("id", chunk);
      for (const r of data ?? []) known.add(r.id as string);
    }
    const { count } = await supabase.from("orders").select("*", { count: "exact", head: true }).eq("store_id", storeId);
    return NextResponse.json({ storeId, totalInDb: count ?? 0, orders: live.map((o) => ({ ...o, inOurDb: known.has(o.id) })) });
  } catch (e) {
    if (e instanceof ReauthRequiredError) return NextResponse.json({ error: e.message, reauth: true }, { status: 409 });
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
```

Before writing the orders route, check two names against the code: `grep -n "export function chunkForInFilter" -r lib` (memory says it exists — import from wherever it lives) and `grep -n "^  id\b\|  id:" lib/normalize/order.ts` to confirm `OrderRow` has `id` (the primary key used by `orders.id`). Adjust the import path / field name to what the grep shows.

```ts
// app/api/settings/route.ts
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session-role";
import { describeSettings, setSetting, SettingError } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  return NextResponse.json({ settings: await describeSettings() });
}

// PUT { values: { [key]: value } } — all-or-nothing validation, then writes.
export async function PUT(req: Request) {
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
  const { values } = (await req.json().catch(() => ({}))) as { values?: Record<string, unknown> };
  if (!values || typeof values !== "object") return NextResponse.json({ error: "values required" }, { status: 400 });
  try {
    for (const [k, v] of Object.entries(values)) await setSetting(k, v, auth.session.username);
    return NextResponse.json({ settings: await describeSettings() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof SettingError ? 400 : 500 });
  }
}
```

Export `currentSession` from `lib/auth/session-role.ts` if it is not exported (it is declared `export async function currentSession` at line 7 — confirm).

- [ ] **Step 6: Lock the old Zoho connections route behind admin**

`app/api/integrations/zoho/connections/route.ts` POST and `[id]/route.ts` mutating handlers currently have **no role check**. Add at the top of each mutating handler:

```ts
  const auth = await requireRole("admin");
  if ("denied" in auth) return auth.denied;
```

with `import { requireRole } from "@/lib/auth/session-role";`.

- [ ] **Step 7: Typecheck and run the suite**

Run: `npx tsc --noEmit -p . && npx tsx --test tests/connectors/*.test.ts tests/settings/*.test.ts`
Expected: no new type errors; all connector/settings tests PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/connectors app/api/connections app/api/settings app/api/integrations/zoho/connections tests/connectors/flow.test.ts lib/runtime 2>/dev/null; git add -A lib/connectors app/api/connections app/api/settings app/api/integrations/zoho/connections tests/connectors
git commit -m "feat(connections): connect flow, OAuth callback, connections + settings API"
```

---

### Task 11: Importer (env + zoho_connections → DB) and verify script

**Files:**
- Create: `lib/connectors/importer.ts`, `db/import-connections.ts`, `db/verify-connections.ts`
- Modify: `instrumentation.ts` (run importer + warm settings before schedulers)
- Test: `tests/connectors/importer.test.ts`

**Interfaces:**
- Consumes: runtime `saveConnection`, `listConnections`, settings `setSetting`, `SETTINGS`.
- Produces:
  - `importFromEnv(env: NodeJS.ProcessEnv, legacyZohoRows: LegacyZohoRow[], opts?: { dryRun?: boolean }): Promise<ImportReport>` where `ImportReport = { created: string[]; skipped: string[]; settings: string[] }`
  - `type LegacyZohoRow = { id; label; org_id; org_name; accounts_url; api_domain; client_id; client_secret_enc; refresh_token_enc; login_email; daily_budget; status; scopes; default_for_providers; created_by }`
  - `readLegacyZohoRows(): Promise<LegacyZohoRow[]>`
  - `runBootImport(): Promise<void>` (logs; never throws)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/connectors/importer.test.ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.CONNECTIONS_KEY = randomBytes(32).toString("base64");
const { setSettingsBackend, memorySettingsBackend, getSetting } = await import("@/lib/settings");
const { memoryConnectionStore } = await import("@/lib/connectors/store");
const rt = await import("@/lib/connectors");
const { importFromEnv } = await import("@/lib/connectors/importer");
const { encryptSecret } = await import("@/lib/crypto/secret-box");

const ENV = {
  SHOPIFY_STORE_CODES: "WA,UAE,KSA,MAIN",
  SHOPIFY_WA_URL: "https://omnia-wa.myshopify.com/", SHOPIFY_WA_TOKEN: "shpat_wa", SHOPIFY_WA_WEBHOOK_SECRET: "whwa",
  SHOPIFY_UAE_URL: "https://omnia-uae.myshopify.com", SHOPIFY_UAE_TOKEN: "shpat_uae",
  SHOPIFY_KSA_URL: "https://omnia-ksa.myshopify.com", SHOPIFY_KSA_TOKEN: "shpat_ksa",
  SHOPIFY_MAIN_URL: "https://omnia-store-main.myshopify.com", SHOPIFY_MAIN_TOKEN: "shpat_main",
  GMAIL_USER: "marketingomniastore@gmail.com,ops@omnia.com", GMAIL_CLIENT_ID: "gcid", GMAIL_CLIENT_SECRET: "gsec",
  GMAIL_REFRESH_TOKEN: "grt", GMAIL_REFRESH_TOKEN_OPS: "grt-ops",
  ZOHO_ORGANIZATION_ID: "111", ZOHO_ORGANIZATION_LABEL: "Omniastores", ZOHO_CLIENT_ID: "zcid", ZOHO_CLIENT_SECRET: "zsec", ZOHO_REFRESH_TOKEN: "zrt",
  ORDER_SYNC_INTERVAL_MINUTES: "2", ZOHO_CLEARING_ACCOUNTS: '{"Stripe":"9"}',
} as NodeJS.ProcessEnv;

const legacy = () => [{
  id: "house-of-omnia", label: "House of Omnia", org_id: "799179049", org_name: "House of Omnia", accounts_url: "https://accounts.zoho.com",
  api_domain: "https://www.zohoapis.com", client_id: "hcid", client_secret_enc: encryptSecret("hsec"), refresh_token_enc: encryptSecret("hrt"),
  login_email: "", daily_budget: 4500, status: "active", scopes: "", default_for_providers: ["COD"], created_by: "settings",
}];

beforeEach(() => {
  setSettingsBackend(memorySettingsBackend());
  rt.setConnectionStore(memoryConnectionStore());
});

test("imports every source with the ids existing data depends on", async () => {
  await importFromEnv(ENV, legacy());
  const all = await rt.listConnections(undefined, { includeDisabled: true });
  const ids = all.map((c) => c.id).sort();
  assert.deepEqual(ids, ["env", "gmail-marketingomniastore", "gmail-ops", "house-of-omnia", "shopify-ksa", "shopify-main", "shopify-uae", "shopify-wa"]);
  const env = all.find((c) => c.id === "env")!;
  assert.equal(env.accountRef, "111");
  assert.equal(env.secrets.refresh_token, "zrt");
  assert.equal(env.grantType, "static_refresh");
  const hoo = all.find((c) => c.id === "house-of-omnia")!;
  assert.equal(hoo.secrets.client_secret, "hsec");
  assert.deepEqual((hoo.config as any).default_for_providers, ["COD"]);
  const wa = all.find((c) => c.id === "shopify-wa")!;
  assert.equal(wa.accountRef, "omnia-wa.myshopify.com");
  assert.equal(wa.secrets.access_token, "shpat_wa");
  assert.equal(wa.secrets.webhook_secret, "whwa");
  assert.equal(all.find((c) => c.id === "gmail-ops")!.secrets.refresh_token, "grt-ops");
  assert.equal(all.find((c) => c.id === "gmail-marketingomniastore")!.secrets.refresh_token, "grt");
  assert.equal(await getSetting("sync.order_interval_minutes"), 2);
  assert.deepEqual(await getSetting("zoho.clearing_accounts"), { Stripe: "9" });
});

test("idempotent and never overwrites a row edited in Settings", async () => {
  await importFromEnv(ENV, legacy());
  await rt.updateConnection("shopify-uae", { label: "UAE (edited)" }, "admin");
  const second = await importFromEnv(ENV, legacy());
  assert.equal(second.created.length, 0);
  assert.equal((await rt.getConnection("shopify-uae"))!.label, "UAE (edited)");
});

test("a store without URL/TOKEN is skipped, not half-imported", async () => {
  const r = await importFromEnv({ ...ENV, SHOPIFY_KSA_TOKEN: "" }, []);
  assert.ok(r.skipped.some((s) => s.includes("KSA")));
  assert.equal(await rt.getConnection("shopify-ksa"), null);
});
```

The "edited in Settings" rule is implemented by the importer checking existence by id/account first and **only inserting** — it never updates an existing row. That makes the test above pass and keeps the rule simple (the spec's `updated_at > created_at` heuristic is unnecessary when the importer never updates).

Audit writes are already skipped for the in-memory store (`isLiveStore()`, Task 10), so these tests stay offline.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/connectors/importer.test.ts`
Expected: FAIL — cannot find module `@/lib/connectors/importer`

- [ ] **Step 3: Implement**

```ts
// lib/connectors/importer.ts
import { supabase } from "@/lib/supabase";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { SETTINGS } from "@/lib/settings/registry";
import { getSetting, loadSettings, setSetting } from "@/lib/settings";
import { getConnection, listConnections, saveConnection } from "./index";

export type LegacyZohoRow = {
  id: string; label: string; org_id: string; org_name: string; accounts_url: string; api_domain: string;
  client_id: string; client_secret_enc: string; refresh_token_enc: string; login_email: string; daily_budget: number;
  status: string; scopes: string | null; default_for_providers: string[] | null; created_by: string;
};
export type ImportReport = { created: string[]; skipped: string[]; settings: string[] };

const mailboxSlug = (mailbox: string) => mailbox.split("@")[0].replace(/[^A-Za-z0-9]/g, "").toLowerCase();

export async function readLegacyZohoRows(): Promise<LegacyZohoRow[]> {
  const { data, error } = await supabase.from("zoho_connections").select("*");
  if (error) {
    if (/does not exist/i.test(error.message)) return []; // dropped in release 2
    throw new Error(`zoho_connections read failed: ${error.message}`);
  }
  return (data ?? []) as LegacyZohoRow[];
}

/** Copy configuration that still lives in env / zoho_connections into the
 *  connections + workspace_settings tables. Insert-only: an existing row (by
 *  id or by account) is left exactly as it is, so UI edits always win. */
export async function importFromEnv(env: NodeJS.ProcessEnv, legacyZohoRows: LegacyZohoRow[], opts: { dryRun?: boolean } = {}): Promise<ImportReport> {
  const report: ImportReport = { created: [], skipped: [], settings: [] };
  const existing = await listConnections(undefined, { includeDisabled: true });
  const has = (provider: string, id: string, accountRef: string) =>
    existing.some((c) => c.id === id || (c.provider === provider && c.accountRef === accountRef));

  const add = async (input: Parameters<typeof saveConnection>[0] & { id: string }) => {
    if (has(input.provider, input.id, input.accountRef)) return;
    if (!opts.dryRun) await saveConnection(input);
    report.created.push(input.id);
  };

  // Zoho: env main org keeps id "env"; legacy rows keep their ids.
  if (env.ZOHO_ORGANIZATION_ID && env.ZOHO_REFRESH_TOKEN && env.ZOHO_CLIENT_ID && env.ZOHO_CLIENT_SECRET) {
    await add({
      id: "env", provider: "zoho", authMode: "own_app", grantType: "static_refresh", accountRef: env.ZOHO_ORGANIZATION_ID,
      label: env.ZOHO_ORGANIZATION_LABEL || "Main organisation",
      config: { accounts_url: env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com", api_domain: "https://www.zohoapis.com", org_name: env.ZOHO_ORGANIZATION_LABEL || "", daily_budget: Number(env.ZOHO_DAILY_BUDGET ?? 7000) },
      secrets: { client_id: env.ZOHO_CLIENT_ID, client_secret: env.ZOHO_CLIENT_SECRET, refresh_token: env.ZOHO_REFRESH_TOKEN },
      connectedBy: "import:env",
    });
  } else report.skipped.push("zoho env org (ZOHO_* incomplete)");

  for (const r of legacyZohoRows) {
    await add({
      id: r.id, provider: "zoho", authMode: "own_app", grantType: "static_refresh", accountRef: r.org_id, label: r.label,
      config: { accounts_url: r.accounts_url, api_domain: r.api_domain, org_name: r.org_name, daily_budget: r.daily_budget, default_for_providers: r.default_for_providers ?? [], login_email: r.login_email },
      secrets: { client_id: r.client_id, client_secret: decryptSecret(r.client_secret_enc), refresh_token: decryptSecret(r.refresh_token_enc) },
      scopes: r.scopes ?? "", status: r.status === "disabled" ? "disabled" : "active", connectedBy: `import:${r.created_by || "zoho_connections"}`,
    });
  }

  // Shopify: one token-mode connection per store code.
  const codes = (env.SHOPIFY_STORE_CODES || "WA,UAE,KSA,MAIN").split(",").map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z0-9_]+$/.test(c));
  for (const code of codes) {
    const url = env[`SHOPIFY_${code}_URL`];
    const token = env[`SHOPIFY_${code}_TOKEN`];
    if (!url || !token) { report.skipped.push(`shopify ${code} (URL/TOKEN missing)`); continue; }
    const shop = new URL(url).hostname.toLowerCase();
    const webhook = env[`SHOPIFY_${code}_WEBHOOK_SECRET`];
    await add({
      id: `shopify-${code.toLowerCase()}`, provider: "shopify", authMode: "token", grantType: "static_token", accountRef: shop, label: code,
      config: { store_id: code, shop },
      secrets: { access_token: token, ...(webhook ? { webhook_secret: webhook } : {}) },
      connectedBy: "import:env",
    });
  }

  // Gmail: one own-app connection per mailbox.
  const mailboxes = String(env.GMAIL_USER || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const mailbox of mailboxes) {
    const slug = mailboxSlug(mailbox);
    const refresh = env[`GMAIL_REFRESH_TOKEN_${slug.toUpperCase()}`] || env.GMAIL_REFRESH_TOKEN;
    if (!refresh || !env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET) { report.skipped.push(`gmail ${mailbox} (credentials missing)`); continue; }
    await add({
      id: `gmail-${slug}`, provider: "gmail", authMode: "own_app", grantType: "authorization_code", accountRef: mailbox.toLowerCase(), label: mailbox,
      config: {}, secrets: { client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET, refresh_token: refresh },
      connectedBy: "import:env",
    });
  }

  // Settings: only keys the DB does not have yet.
  await loadSettings(true);
  const { describeSettings } = await import("@/lib/settings");
  const described = await describeSettings();
  for (const d of SETTINGS) {
    if (!d.legacyEnv) continue;
    const raw = env[d.legacyEnv];
    if (raw === undefined || raw === "") continue;
    if (described.find((x) => x.key === d.key)?.source === "database") continue;
    let value: unknown;
    try { value = d.parseEnv ? d.parseEnv(raw) : raw; } catch { report.skipped.push(`setting ${d.key} (unparseable ${d.legacyEnv})`); continue; }
    if (!d.schema.safeParse(value).success) { report.skipped.push(`setting ${d.key} (invalid ${d.legacyEnv})`); continue; }
    if (!opts.dryRun) await setSetting(d.key, value, "import:env");
    report.settings.push(d.key);
  }
  return report;
}

/** Called once from instrumentation.ts. Never throws: a failed import must not
 *  stop the schedulers (they still have the env fallback in release 1). */
export async function runBootImport(): Promise<void> {
  try {
    const r = await importFromEnv(process.env, await readLegacyZohoRows());
    if (r.created.length || r.settings.length) console.log(`[connections] imported ${r.created.length} connections, ${r.settings.length} settings`, r);
    if (r.skipped.length) console.log(`[connections] import skipped: ${r.skipped.join("; ")}`);
    await loadSettings(true);
  } catch (e) {
    console.error(`[connections] boot import failed: ${(e as Error).message}`);
  }
}
```

Unused imports (`getSetting`, `getConnection`) — remove them when lint flags them.

```ts
// db/import-connections.ts — npx tsx db/import-connections.ts [--dry-run]
import "dotenv/config";
import { importFromEnv, readLegacyZohoRows } from "@/lib/connectors/importer";

const dryRun = process.argv.includes("--dry-run");
const report = await importFromEnv(process.env, await readLegacyZohoRows(), { dryRun });
console.log(JSON.stringify({ dryRun, ...report }, null, 2));
```

```ts
// db/verify-connections.ts — npx tsx db/verify-connections.ts
// Release-1 gate: what the env-based code resolves must equal what the DB resolves.
import "dotenv/config";
import { listConnections } from "@/lib/connectors";
import { describeSettings } from "@/lib/settings";
import { SETTINGS } from "@/lib/settings/registry";

const problems: string[] = [];
const env = process.env;

const conns = await listConnections(undefined, { includeDisabled: true });
const shop = conns.filter((c) => c.provider === "shopify");
for (const code of (env.SHOPIFY_STORE_CODES || "WA,UAE,KSA,MAIN").split(",").map((c) => c.trim().toUpperCase())) {
  if (!env[`SHOPIFY_${code}_URL`] || !env[`SHOPIFY_${code}_TOKEN`]) continue;
  const c = shop.find((x) => (x.config as any).store_id === code);
  if (!c) { problems.push(`shopify ${code}: in env, not in DB`); continue; }
  if (new URL(env[`SHOPIFY_${code}_URL`]!).hostname !== c.accountRef) problems.push(`shopify ${code}: domain differs`);
  if (c.authMode === "token" && c.secrets.access_token !== env[`SHOPIFY_${code}_TOKEN`]) problems.push(`shopify ${code}: token differs`);
}
for (const mailbox of String(env.GMAIL_USER || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
  if (!conns.some((c) => c.provider === "gmail" && c.accountRef === mailbox)) problems.push(`gmail ${mailbox}: in env, not in DB`);
}
if (env.ZOHO_ORGANIZATION_ID) {
  const z = conns.find((c) => c.id === "env");
  if (!z) problems.push("zoho env org: missing connection id 'env'");
  else if (z.accountRef !== env.ZOHO_ORGANIZATION_ID) problems.push("zoho env org: org id differs");
}
for (const s of await describeSettings()) {
  const d = SETTINGS.find((x) => x.key === s.key)!;
  if (d.legacyEnv && env[d.legacyEnv] && s.source !== "database") problems.push(`setting ${s.key}: still from ${s.source}`);
}
for (const c of conns) if (c.status === "error" || c.status === "needs_reauth") problems.push(`${c.id}: ${c.status} — ${c.lastError}`);

console.log(problems.length ? `✗ ${problems.length} difference(s):\n  ${problems.join("\n  ")}` : `✓ DB matches env for ${conns.length} connections`);
process.exit(problems.length ? 1 : 0);
```

In `instrumentation.ts`, as the first lines inside `if (process.env.NEXT_RUNTIME === "nodejs") {`:

```ts
    const { runBootImport } = await import("@/lib/connectors/importer");
    await runBootImport();
```

- [ ] **Step 4: Run tests**

Run: `npx tsx --test tests/connectors/importer.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Dry-run against Omnia's real env (read-only)**

Run: `npx tsx db/import-connections.ts --dry-run`
Expected: JSON listing `env`, `house-of-omnia` (and any other existing Zoho org), `shopify-wa`, `shopify-uae`, `shopify-ksa`, `shopify-main`, Gmail mailboxes, and the settings keys present in env. Nothing written. Paste the output in the task report.

- [ ] **Step 6: Commit**

```bash
git add lib/connectors/importer.ts lib/connectors/runtime.ts lib/connectors/flow.ts db/import-connections.ts db/verify-connections.ts instrumentation.ts tests/connectors/importer.test.ts
git commit -m "feat(connections): insert-only importer from env + zoho_connections, verify script"
```

---

### Task 12: Zoho callers on the connections table

**Files:**
- Modify: `lib/integrations/zoho-org.ts` (registry, secrets, tokens, save/test/update/delete, `zohoOrgForProvider`)
- Modify: `lib/integrations/zoho-throttle.ts:24-32` (settings via `peekSetting`)
- Modify: `lib/integrations/zoho-banking.ts:144-221` (env reads → `peekSetting` with the env fallback living in settings)
- Modify: `lib/finance/delivery-entities.server.ts:21`
- Test: `tests/integrations/zoho-connections-backend.test.ts`; existing `tests/integrations/zoho-multi-org.test.ts` must still pass

**Interfaces:**
- Consumes: `@/lib/connectors` (`listConnections`, `getConnection`, `getAccessToken`, `saveConnection`, `updateConnection`, `removeConnection`, `testConnection`), `zohoRefresh` (Task 7), `peekSetting`.
- Produces: unchanged exports of `zoho-org.ts` (`ZohoConnection`, `envConnection`, `listZohoConnections`, `getZohoConnection`, `withZohoOrg`, `getScopedAccessToken`, `discoverZohoOrgs`, `saveZohoConnection`, `testZohoConnection`, `updateZohoConnection`, `deleteZohoConnection`, route helpers, `zohoOrgFor*`) with the same signatures. `ZohoConnection.source` becomes `"env" | "db"` where `"env"` now means "id is env" (kept for UI compatibility).

- [ ] **Step 1: Write the failing test**

```ts
// tests/integrations/zoho-connections-backend.test.ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.CONNECTIONS_KEY = randomBytes(32).toString("base64");
delete process.env.ZOHO_ORGANIZATION_ID; // prove the DB path, not env
const { memoryConnectionStore } = await import("@/lib/connectors/store");
const rt = await import("@/lib/connectors");
const zo = await import("@/lib/integrations/zoho-org");
const { setSettingsBackend, memorySettingsBackend } = await import("@/lib/settings");

beforeEach(async () => {
  setSettingsBackend(memorySettingsBackend());
  rt.setConnectionStore(memoryConnectionStore());
  rt._resetRuntimeCaches();
  await rt.saveConnection({ id: "env", provider: "zoho", authMode: "own_app", grantType: "static_refresh", accountRef: "111", label: "Omniastores", config: { daily_budget: 7000 }, secrets: { client_id: "c", client_secret: "s", refresh_token: "r", access_token: "tok-env", access_token_expires_at: Date.now() + 3600_000 }, connectedBy: "t" });
  await rt.saveConnection({ id: "house-of-omnia", provider: "zoho", authMode: "own_app", grantType: "static_refresh", accountRef: "799179049", label: "House of Omnia", config: { default_for_providers: ["COD"] }, secrets: { client_id: "c", client_secret: "s", refresh_token: "r", access_token: "tok-hoo", access_token_expires_at: Date.now() + 3600_000 }, connectedBy: "t" });
});

test("registry reads connections; env id and '' both resolve to the default org", async () => {
  const all = await zo.listZohoConnections();
  assert.deepEqual(all.map((c) => c.id), ["env", "house-of-omnia"]);
  assert.equal((await zo.getZohoConnection(""))!.orgId, "111");
  assert.equal((await zo.getZohoConnection("env"))!.orgId, "111");
});

test("withZohoOrg + getScopedAccessToken pick the scoped connection's token", async () => {
  assert.equal(await zo.withZohoOrg("house-of-omnia", () => zo.getScopedAccessToken()), "tok-hoo");
  assert.equal(await zo.getScopedAccessToken(), "tok-env");
});

test("zohoOrgForProvider uses config.default_for_providers", async () => {
  assert.equal(await zo.zohoOrgForProvider("COD"), "house-of-omnia");
  assert.equal(await zo.zohoOrgForProvider("Stripe"), "");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/integrations/zoho-connections-backend.test.ts`
Expected: FAIL — `listZohoConnections` still reads `zoho_connections` / env (returns `[]` or throws on supabase).

- [ ] **Step 3: Rewrite the registry/token half of `zoho-org.ts`**

Replace lines 17–191 (imports through `getScopedAccessToken`) with:

```ts
import { supabase } from "@/lib/supabase";
import {
  getAccessToken, getConnection, listConnections, removeConnection, saveConnection, testConnection, updateConnection,
  type Connection,
} from "@/lib/connectors";
import { peekSetting } from "@/lib/settings";
import { zohoThrottledFetch } from "./zoho-throttle";
import { ENV_CONNECTION_ID, currentZohoScope, runInZohoScope, type ZohoOrgScope } from "./zoho-context";

const DEFAULT_ACCOUNTS_URL = "https://accounts.zoho.com";
const DEFAULT_API_DOMAIN = "https://www.zohoapis.com";

export type ZohoConnection = {
  id: string; label: string; orgId: string; orgName: string; accountsUrl: string; apiDomain: string;
  clientId: string; loginEmail: string; dailyBudget: number;
  status: "active" | "error" | "disabled" | "needs_reauth"; lastError: string; lastCheckedAt: string | null;
  scopes: string; defaultForProviders: string[];
  /** "env" = the default organisation (connection id "env"). */
  source: "env" | "db";
};

const fromConnection = (c: Connection): ZohoConnection => {
  const cfg = c.config as any;
  return {
    id: c.id, label: c.label, orgId: c.accountRef, orgName: cfg.org_name ?? "", accountsUrl: cfg.accounts_url ?? DEFAULT_ACCOUNTS_URL,
    apiDomain: cfg.api_domain ?? DEFAULT_API_DOMAIN, clientId: c.secrets.client_id ?? "", loginEmail: cfg.login_email ?? "",
    dailyBudget: cfg.daily_budget ?? 4500, status: c.status, lastError: c.lastError, lastCheckedAt: c.lastCheckedAt,
    scopes: c.scopes, defaultForProviders: cfg.default_for_providers ?? [], source: c.id === ENV_CONNECTION_ID ? "env" : "db",
  };
};

const defaultId = () => peekSetting<string>("zoho.default_connection_id") || ENV_CONNECTION_ID;

/** The default organisation, or null when Zoho is not connected. */
export async function envConnectionAsync(): Promise<ZohoConnection | null> {
  const c = await getConnection(defaultId());
  return c ? fromConnection(c) : null;
}

/** @deprecated sync shape kept for callers that only need "is Zoho configured";
 *  prefer envConnectionAsync(). Returns null until the first async read. */
let lastDefault: ZohoConnection | null = null;
export function envConnection(): ZohoConnection | null { return lastDefault; }

export async function listZohoConnections(): Promise<ZohoConnection[]> {
  const list = (await listConnections("zoho", { includeDisabled: true })).map(fromConnection);
  lastDefault = list.find((c) => c.id === defaultId()) ?? null;
  // Default org first, as before.
  return list.sort((a, b) => (a.id === defaultId() ? -1 : b.id === defaultId() ? 1 : 0));
}

export async function getZohoConnection(id: string): Promise<ZohoConnection | null> {
  const c = await getConnection(!id || id === ENV_CONNECTION_ID ? defaultId() : id);
  const z = c && c.provider === "zoho" ? fromConnection(c) : null;
  if (z && (!id || id === ENV_CONNECTION_ID)) lastDefault = z;
  return z;
}
```

Keep `withZohoOrg`, `zohoOrgFromRequest` (lines 129–145) unchanged, except `withZohoOrg`'s `status === "disabled"` check stays and add `if (conn.status === "needs_reauth") throw new Error(\`Zoho organisation "${conn.label}" needs to be reconnected (Settings → Connections)\`);`. Then:

```ts
/** Access token for the organisation in scope (default organisation when none). */
export async function getScopedAccessToken(): Promise<string> {
  const id = currentZohoScope()?.connectionId ?? ENV_CONNECTION_ID;
  return getAccessToken(id === ENV_CONNECTION_ID ? defaultId() : id);
}
```

`envConnection()` callers: run `grep -rn "envConnection()" lib app components`. Replace each with `await envConnectionAsync()` (all callers are in async functions; if one is not, make it async — list the files in the task report).

- [ ] **Step 4: Rewrite the onboarding half**

Replace `saveZohoConnection`, `testZohoConnection`, `updateZohoConnection`, `deleteZohoConnection` (lines 229–328) with thin wrappers; keep `discoverZohoOrgs` (lines 197–212) as is but make its token call reuse `zohoRefresh`:

```ts
export async function saveZohoConnection(input: SaveConnectionInput): Promise<ZohoConnection> {
  const label = input.label.trim();
  if (!label) throw new Error("Give the organisation a name");
  const { orgs, apiDomain, scopes } = await discoverZohoOrgs(input);
  const org = orgs.find((o) => o.orgId === input.orgId);
  if (!org) throw new Error(`These credentials can't reach organisation ${input.orgId}. They can reach: ${orgs.map((o) => `${o.name} (${o.orgId})`).join(", ") || "none"}`);
  const conn = await saveConnection({
    id: input.id, provider: "zoho", authMode: "own_app", grantType: "static_refresh", accountRef: org.orgId, label,
    config: { accounts_url: input.accountsUrl || DEFAULT_ACCOUNTS_URL, api_domain: apiDomain, org_name: org.name, daily_budget: input.dailyBudget ?? 4500, login_email: input.loginEmail?.trim() ?? "" },
    secrets: { client_id: input.clientId.trim(), client_secret: input.clientSecret.trim(), refresh_token: input.refreshToken.trim() },
    scopes, connectedBy: input.createdBy ?? "settings",
  });
  return fromConnection(conn);
}

export async function testZohoConnection(id: string): Promise<{ ok: boolean; orgName?: string; error?: string }> {
  const r = await testConnection(!id || id === ENV_CONNECTION_ID ? defaultId() : id);
  return { ok: r.ok, orgName: r.accountName, error: r.error };
}

export async function updateZohoConnection(id: string, patch: { label?: string; status?: "active" | "disabled"; dailyBudget?: number; defaultForProviders?: string[] }, actor = "settings") {
  const config: Record<string, unknown> = {};
  if (patch.dailyBudget && patch.dailyBudget > 0) config.daily_budget = Math.round(patch.dailyBudget);
  if (patch.defaultForProviders) {
    const providers = [...new Set(patch.defaultForProviders.map((p) => p.trim()).filter(Boolean))];
    // A provider routes to one organisation only — take it off any other.
    for (const other of await listConnections("zoho", { includeDisabled: true })) {
      const cur: string[] = (other.config as any).default_for_providers ?? [];
      if (other.id !== id && cur.some((p) => providers.includes(p))) {
        await updateConnection(other.id, { config: { default_for_providers: cur.filter((p) => !providers.includes(p)) } }, actor);
      }
    }
    config.default_for_providers = providers;
  }
  await updateConnection(id, { label: patch.label, status: patch.status, ...(Object.keys(config).length ? { config } : {}) }, actor);
}

export async function deleteZohoConnection(id: string, actor = "settings") {
  if (id === defaultId()) throw new Error("The default organisation can't be removed — pick another default first");
  const out = await removeConnection(id, actor);
  if ("blocked" in out) throw new Error(`Still used by: ${out.blocked.join("; ")} — disable it instead of deleting`);
}
```

Replace `zohoOrgForProvider` body:

```ts
export async function zohoOrgForProvider(provider: string): Promise<string> {
  if (!provider) return "";
  const hit = (await listConnections("zoho")).find((c) => ((c.config as any).default_for_providers ?? []).includes(provider));
  return hit?.id ?? "";
}
```

In `discoverZohoOrgs` replace the call `exchangeRefreshToken(s)` with:

```ts
  const { zohoRefresh } = await import("@/lib/connectors/zoho");
  const g = await zohoRefresh({ refresh_token: s.refreshToken }, { accounts_url: s.accountsUrl } as any, { clientId: s.clientId, clientSecret: s.clientSecret });
  const tok = { access_token: g.accessToken, api_domain: g.raw.api_domain as string | undefined, scope: g.scopes };
```

and delete the now-unused `exchangeRefreshToken`, `tokens`, `inflight`, `envScopes`, `secretsFor`, `getRow`, `fromRow`, `Row`, `Secrets`, `TENANT`, `ENV_BUDGET`, `slug`, `decryptSecret`/`encryptSecret` imports.

- [ ] **Step 5: Settings for throttle, banking, COD org**

`lib/integrations/zoho-throttle.ts` lines 24–32: replace the four module constants with getters used at call time:

```ts
import { peekSetting } from "@/lib/settings";
const MIN_GAP_MS = () => peekSetting<number>("zoho.min_gap_ms");
const DAILY_BUDGET = () => peekSetting<number>("zoho.daily_budget");
const MAX_429_RETRIES = () => peekSetting<number>("zoho.max_429_retries");
const MAX_RETRY_WAIT_MS = () => peekSetting<number>("zoho.max_retry_wait_ms");
```

and change every use `MIN_GAP_MS` → `MIN_GAP_MS()` etc. (`grep -n "MIN_GAP_MS\|DAILY_BUDGET\|MAX_429_RETRIES\|MAX_RETRY_WAIT_MS" lib/integrations/zoho-throttle.ts`).

`lib/integrations/zoho-banking.ts`: replace `process.env.ZOHO_BANK_ACCOUNT_ID` → `peekSetting<string>("zoho.bank_account_id")`, `process.env.ZOHO_FEE_ACCOUNT_ID` → `peekSetting<string>("zoho.fee_account_id")`, `process.env.ZOHO_DEFAULT_INCOME_ACCOUNT_ID` → `peekSetting<string>("zoho.default_income_account_id")`. For `ZOHO_CLEARING_ACCOUNTS` / `ZOHO_EXPENSE_ACCOUNTS_BY_KIND` the code JSON-parses a raw string; replace the parse with the already-parsed object: `const parsed = peekSetting<Record<string, string>>("zoho.clearing_accounts")` and drop the `JSON.parse`/try. Read lines 140–225 before editing and keep each function's return shape identical; the configured-check at line 164 becomes `Boolean(peekSetting("zoho.bank_account_id") && peekSetting("zoho.fee_account_id") && Object.keys(peekSetting<Record<string,string>>("zoho.clearing_accounts")).length)`.

`lib/finance/delivery-entities.server.ts:21`: `return peekSetting<string>("zoho.cod_prepaid_org").trim() || ENV_CONNECTION_ID;`

`lib/integrations/zoho.ts:16-19` (the `zohoConfigured()`-style env check): replace with `Boolean(envConnection())` — `envConnection()` is populated after the first async read; boot import + `listZohoConnections()` warm it. If the function must be accurate before any read, make it `async` and use `envConnectionAsync()`; check its callers with grep and pick whichever is a smaller change.

- [ ] **Step 6: Run Zoho tests**

Run: `npx tsx --test tests/integrations/zoho-*.test.ts && npx tsc --noEmit -p .`
Expected: all PASS; no new type errors. If `zoho-multi-org.test.ts` relied on env, update its setup to seed connections like the new test (show the diff in the report).

- [ ] **Step 7: Commit**

```bash
git add lib/integrations/zoho-org.ts lib/integrations/zoho-throttle.ts lib/integrations/zoho-banking.ts lib/integrations/zoho.ts lib/finance/delivery-entities.server.ts tests/integrations
git commit -m "refactor(zoho): organisations, tokens and settings read from connections"
```

---

### Task 13: Gmail callers on the connections table

**Files:**
- Modify: `lib/integrations/gmail.ts:26-151`
- Modify: `lib/scheduler/payout-email-scheduler.ts:45-55`
- Modify: `app/api/integrations/gmail/connect/route.ts`, `app/api/integrations/gmail/callback/route.ts` (redirect to the new flow)
- Test: `tests/integrations/gmail-connections.test.ts`

**Interfaces:**
- Produces (same names as today): `gmailConfigured(): Promise<boolean>` (**now async** — update callers), `gmailMailboxes(): Promise<string[]>` (**now async**), `getAccessToken(mailbox: string): Promise<string>`; `refreshTokenFor`, `gmailConsentUrl`, `exchangeCodeForTokens` are deleted.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integrations/gmail-connections.test.ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.CONNECTIONS_KEY = randomBytes(32).toString("base64");
delete process.env.GMAIL_USER;
const { memoryConnectionStore } = await import("@/lib/connectors/store");
const rt = await import("@/lib/connectors");
const gmail = await import("@/lib/integrations/gmail");

beforeEach(async () => {
  rt.setConnectionStore(memoryConnectionStore());
  rt.setAlertSink(async () => {});
  rt._resetRuntimeCaches();
  for (const [m, tok] of [["a@x.com", "ta"], ["b@x.com", "tb"]]) {
    await rt.saveConnection({ provider: "gmail", authMode: "own_app", grantType: "authorization_code", accountRef: m, label: m, config: {}, secrets: { client_id: "c", client_secret: "s", refresh_token: "r", access_token: tok, access_token_expires_at: Date.now() + 3600_000 }, connectedBy: "t" });
  }
});

test("mailboxes and tokens come from gmail connections", async () => {
  assert.deepEqual(await gmail.gmailMailboxes(), ["a@x.com", "b@x.com"]);
  assert.equal(await gmail.gmailConfigured(), true);
  assert.equal(await gmail.getAccessToken("B@x.com"), "tb");
});

test("a mailbox needing reauth is excluded from polling", async () => {
  const [a] = await rt.listConnections("gmail");
  await rt.updateConnection(a.id, { status: "disabled" }, "t");
  assert.deepEqual(await gmail.gmailMailboxes(), ["b@x.com"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/integrations/gmail-connections.test.ts`
Expected: FAIL — `gmailMailboxes()` returns `[]` synchronously / not a promise.

- [ ] **Step 3: Implement**

Replace `lib/integrations/gmail.ts` lines 1–151 (header comment through `refreshAccessToken`) with:

```ts
// Gmail read access for payout-report ingestion. Mailboxes are `gmail`
// connections (Settings → Connections); OAuth, token refresh and re-auth
// detection live in lib/connectors. Read-only: this module never sends,
// labels, or deletes anything.

import { getAccessToken as connectionToken, listConnections } from "@/lib/connectors";

const API_BASE = "https://gmail.googleapis.com/gmail/v1";

/** Read-only scope, kept for callers that display it. */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

async function mailboxConnections() {
  return (await listConnections("gmail")).filter((c) => c.status !== "needs_reauth" && c.status !== "error");
}

export async function gmailConfigured(): Promise<boolean> {
  return (await mailboxConnections()).length > 0;
}

/** Mailboxes to poll, in connection order. */
export async function gmailMailboxes(): Promise<string[]> {
  return (await mailboxConnections()).map((c) => c.accountRef);
}

export async function getAccessToken(mailbox: string): Promise<string> {
  const conn = (await listConnections("gmail", { includeDisabled: true })).find((c) => c.accountRef === mailbox.toLowerCase());
  if (!conn) throw new Error(`No Gmail connection for ${mailbox} — connect it in Settings → Connections`);
  return connectionToken(conn);
}
```

Keep `gmailGet` and everything after it unchanged.

Update callers: `grep -rn "gmailConfigured()\|gmailMailboxes()\|refreshTokenFor\|gmailConsentUrl\|exchangeCodeForTokens" lib app`. Add `await` to each `gmailConfigured()` / `gmailMailboxes()` call (in `lib/scheduler/payout-email-scheduler.ts` the start function is sync: wrap its body after the configured check in `void (async () => { … })()` and read the interval with `(await getSetting<number | null>("sync.gmail_interval_minutes")) ?? DEFAULT_INTERVAL_MINUTES`). Change the "not configured" log text to `connect a Gmail mailbox in Settings → Connections to enable`.

Replace both legacy routes with redirects to Settings:

```ts
// app/api/integrations/gmail/connect/route.ts
import { NextResponse } from "next/server";
// Superseded by Settings → Connections → Gmail (OAuth flow in lib/connectors).
export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/settings?tab=connections&add=gmail", request.url));
}
```

```ts
// app/api/integrations/gmail/callback/route.ts
import { NextResponse } from "next/server";
// Superseded: Google now redirects to /api/connections/oauth/gmail/callback.
export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/settings?tab=connections&add=gmail", request.url));
}
```

- [ ] **Step 4: Register the Gmail "Sync now" handler**

At the end of `lib/integrations/gmail.ts` do **not** register (avoid import cycles). Instead create `lib/connectors/sync-handlers.ts`:

```ts
// lib/connectors/sync-handlers.ts — "Sync now" per provider. Imported once by
// app/api/connections/[id]/sync/route.ts.
import { registerSyncHandler } from "./flow";

registerSyncHandler("gmail", async (conn) => {
  const { ingestPayoutEmails } = await import("@/lib/scheduler/payout-email-scheduler");
  const r = await ingestPayoutEmails({ mailboxes: [conn.accountRef] });
  return { summary: `${r.ingested ?? 0} payout emails ingested` };
});
```

Run `grep -n "^export" lib/scheduler/payout-email-scheduler.ts lib/integrations/*gmail* lib/**/payout-email*` to find the real one-cycle ingest function and its options; use that exact name and parameter shape (if it has no mailbox filter, call it without one and note it in the report). Add `import "@/lib/connectors/sync-handlers";` at the top of `app/api/connections/[id]/sync/route.ts`.

- [ ] **Step 5: Run tests**

Run: `npx tsx --test tests/integrations/gmail-connections.test.ts && npx tsc --noEmit -p .`
Expected: PASS; no new type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/integrations/gmail.ts lib/scheduler/payout-email-scheduler.ts lib/connectors/sync-handlers.ts app/api/integrations/gmail app/api/connections tests/integrations/gmail-connections.test.ts
git commit -m "refactor(gmail): mailboxes and tokens from gmail connections"
```

---

### Task 14: Shopify callers async + webhook secrets from connections

**Files:**
- Modify: `lib/integrations/shopify.ts:16-25` (and line 853)
- Modify: `lib/zoho-sync.ts:62`, `lib/inventory-export.ts:46`, `lib/lookup-sku.ts:141,182`, `lib/payout-sync.ts:123`, `lib/channel-adapters/shopify.ts:74`, `lib/integrations/ads/tracking-check.ts:46`, `lib/integrations/shopify-analytics.ts:66,114`, `lib/sync/order-webhook-ingest.ts:23`, `lib/sync/order-sync.service.ts:27`, `app/api/integrations/zoho/route.ts:20`, `app/api/integrations/payouts/route.ts:19`
- Modify: `app/api/webhooks/shopify/[store]/orders-create/route.ts`, `orders-paid/route.ts`, `inventory-update/route.ts` (secret lookup)
- Modify: `lib/connectors/sync-handlers.ts` (Shopify handler)
- Test: `tests/integrations/shopify-connections.test.ts`

**Interfaces:**
- Produces: `listShopifyStores(): Promise<ShopifyStoreConfig[]>` (same element shape `{ code, url, token }`; skips connections in `needs_reauth`/`error`/`disabled` and logs them), `shopifyStore(code: string): Promise<ShopifyStoreConfig | null>`, `shopifyWebhookSecret(code: string): Promise<string | null>`, `SkippedStore` list via `shopifyStoreProblems(): Promise<{ code: string; status: string; error: string }[]>`. `getShopifyStores` is **deleted** (the compiler then finds any missed caller).

- [ ] **Step 1: Write the failing test**

```ts
// tests/integrations/shopify-connections.test.ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.CONNECTIONS_KEY = randomBytes(32).toString("base64");
delete process.env.SHOPIFY_STORE_CODES;
const { memoryConnectionStore } = await import("@/lib/connectors/store");
const rt = await import("@/lib/connectors");
const shop = await import("@/lib/integrations/shopify");

const add = (code: string, extra: Record<string, unknown> = {}) => rt.saveConnection({
  provider: "shopify", authMode: "token", grantType: "static_token", accountRef: `omnia-${code.toLowerCase()}.myshopify.com`, label: code,
  config: { store_id: code, shop: `omnia-${code.toLowerCase()}.myshopify.com` }, secrets: { access_token: `shpat_${code}`, webhook_secret: `wh_${code}` }, connectedBy: "t", ...extra,
});

beforeEach(async () => {
  rt.setConnectionStore(memoryConnectionStore());
  rt.setAlertSink(async () => {});
  rt._resetRuntimeCaches();
  await add("UAE"); await add("KSA"); await add("WA");
});

test("listShopifyStores returns the legacy shape for every active store", async () => {
  const stores = await shop.listShopifyStores();
  assert.deepEqual(stores.map((s) => s.code), ["UAE", "KSA", "WA"]);
  assert.deepEqual(stores[0], { code: "UAE", url: "https://omnia-uae.myshopify.com", token: "shpat_UAE" });
});

test("a store needing reauth is skipped and reported; the others still sync", async () => {
  const store = memoryConnectionStore();
  rt.setConnectionStore(store);
  for (const c of ["UAE", "KSA", "WA"]) await add(c);
  const row = (await store.list("omnia", "shopify")).find((r) => (r.config as any).store_id === "KSA")!;
  await store.update("omnia", row.id, { status: "needs_reauth", last_error: "revoked" });
  assert.deepEqual((await shop.listShopifyStores()).map((s) => s.code), ["UAE", "WA"]);
  assert.deepEqual(await shop.shopifyStoreProblems(), [{ code: "KSA", status: "needs_reauth", error: "revoked" }]);
});

test("webhook secret: stored webhook_secret, then own-app client secret", async () => {
  assert.equal(await shop.shopifyWebhookSecret("UAE"), "wh_UAE");
  await rt.saveConnection({ provider: "shopify", authMode: "own_app", grantType: "authorization_code", accountRef: "omnia-main.myshopify.com", label: "MAIN", config: { store_id: "MAIN", shop: "omnia-main.myshopify.com" }, secrets: { client_id: "c", client_secret: "app-secret", access_token: "shpua" }, connectedBy: "t" });
  assert.equal(await shop.shopifyWebhookSecret("MAIN"), "app-secret");
  assert.equal(await shop.shopifyWebhookSecret("NOPE"), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/integrations/shopify-connections.test.ts`
Expected: FAIL — `listShopifyStores` is not a function

- [ ] **Step 3: Implement in `lib/integrations/shopify.ts`**

Replace lines 16–25 (`getShopifyStores`) and make `API_VERSION` a getter:

```ts
import { getAccessToken, listConnections, resolveApp, ReauthRequiredError } from "@/lib/connectors";
import { peekSetting } from "@/lib/settings";

/** Every connected Shopify store that can be used right now, in the legacy
 *  { code, url, token } shape. Stores needing reauth are skipped (see
 *  shopifyStoreProblems) so one revoked token never stops the others. */
export async function listShopifyStores(): Promise<ShopifyStoreConfig[]> {
  const out: ShopifyStoreConfig[] = [];
  for (const c of await listConnections("shopify")) {
    if (c.status === "needs_reauth" || c.status === "error") continue;
    try {
      out.push({ code: String((c.config as any).store_id), url: `https://${(c.config as any).shop}`, token: await getAccessToken(c) });
    } catch (e) {
      if (!(e instanceof ReauthRequiredError)) console.error(`[shopify] ${c.label}: ${(e as Error).message}`);
    }
  }
  return out;
}

export async function shopifyStore(code: string): Promise<ShopifyStoreConfig | null> {
  return (await listShopifyStores()).find((s) => s.code === code.toUpperCase()) ?? null;
}

export async function shopifyStoreProblems(): Promise<{ code: string; status: string; error: string }[]> {
  return (await listConnections("shopify")).filter((c) => c.status === "needs_reauth" || c.status === "error")
    .map((c) => ({ code: String((c.config as any).store_id), status: c.status, error: c.lastError }));
}

/** Secret Shopify signs this store's webhooks with. */
export async function shopifyWebhookSecret(code: string): Promise<string | null> {
  const c = (await listConnections("shopify", { includeDisabled: true })).find((x) => (x.config as any).store_id === code.toUpperCase());
  if (!c) return null;
  if (c.secrets.webhook_secret) return c.secrets.webhook_secret;
  return resolveApp(c)?.clientSecret ?? null;
}

const apiVersion = () => peekSetting<string>("shopify.api_version");
```

Replace every `API_VERSION` use in the file with `apiVersion()` (`grep -n API_VERSION lib/integrations/shopify.ts`). At line ~853 replace `getShopifyStores().find((s) => s.code === storeCode)` with `await shopifyStore(storeCode)`.

- [ ] **Step 4: Update every caller**

For each file below, replace the expression and make the enclosing function `async` if it is not already (all listed sites are inside async functions except where noted — `tsc` will tell you):

| File:line | Before | After |
|---|---|---|
| `lib/zoho-sync.ts:62` | `for (const store of getShopifyStores())` | `for (const store of await listShopifyStores())` |
| `lib/inventory-export.ts:46` | `getShopifyStores()` | `await listShopifyStores()` |
| `lib/lookup-sku.ts:141,182` | `getShopifyStores().find((s) => s.code === store)` | `await shopifyStore(store)` |
| `lib/payout-sync.ts:123` | `for (const store of getShopifyStores())` | `for (const store of await listShopifyStores())` |
| `lib/channel-adapters/shopify.ts:74` | `getShopifyStores().find((s) => s.code === storeCode)` | `await shopifyStore(storeCode)` |
| `lib/integrations/ads/tracking-check.ts:46` | `getShopifyStores().map(` | `(await listShopifyStores()).map(` |
| `lib/lookup-sku.ts:6`, `lib/channel-adapters/shopify.ts:8` (own `API_VERSION` consts) | `process.env.SHOPIFY_API_VERSION \|\| "2024-04"` | `peekSetting<string>("shopify.api_version")` read at call time |
| `lib/integrations/shopify-analytics.ts:66,114` | `getShopifyStores().find((s) => s.code === code)` | `await shopifyStore(code)` |
| `lib/sync/order-webhook-ingest.ts:23` | `getShopifyStores().find((s) => s.code === storeCode)` | `await shopifyStore(storeCode)` |
| `lib/sync/order-sync.service.ts:27` | `for (const store of getShopifyStores())` | `for (const store of await listShopifyStores())` |
| `app/api/integrations/zoho/route.ts:20` | `getShopifyStores().map((s) => s.code)` | `(await listShopifyStores()).map((s) => s.code)` |
| `app/api/integrations/payouts/route.ts:19` | same | same |

Fix imports in each file (`getShopifyStores` → `listShopifyStores` / `shopifyStore`). In `lib/sync/order-sync.service.ts`, after the loop, record skipped stores in the run result so they show in `order_sync_runs.store_results`:

```ts
  for (const p of await shopifyStoreProblems()) {
    results.push({ store: p.code, ok: false, error: `${p.status}: ${p.error} — reconnect in Settings` } as any);
  }
```

Read the surrounding code first and use the existing results array/variable name and element shape (replace `results` and the object fields accordingly; drop the `as any` once the shape matches).

`shopify-analytics.ts` also reads `SHOPIFY_ANALYTICS_API_VERSION`: replace with `peekSetting<string>("shopify.analytics_api_version")`.

Run: `npx tsc --noEmit -p . 2>&1 | grep -i "getShopifyStores\|is not assignable to type 'ShopifyStoreConfig\|Promise<"`
Expected: no output.

- [ ] **Step 5: Webhook routes read the secret from the connection**

In each of the three `app/api/webhooks/shopify/[store]/*/route.ts` files delete the `STORE_SECRETS` constant and replace `const secret = STORE_SECRETS[store];` with:

```ts
  const secret = await shopifyWebhookSecret(store);
```

adding `import { shopifyWebhookSecret } from "@/lib/integrations/shopify";`. Release 1 env fallback: in `shopifyWebhookSecret`, before `return null`, add `return process.env[\`SHOPIFY_${code.toUpperCase()}_WEBHOOK_SECRET\`] ?? null;` — Task 17 removes it.

- [ ] **Step 6: Shopify "Sync now" handler**

Append to `lib/connectors/sync-handlers.ts`:

```ts
registerSyncHandler("shopify", async (conn) => {
  const { syncOrdersForStore } = await import("@/lib/sync/order-sync.service");
  const r = await syncOrdersForStore(String((conn.config as any).store_id));
  return { summary: `${r.upserted ?? 0} orders synced` };
});
```

`order-sync.service.ts` syncs all stores in one loop today. Extract the loop body into `export async function syncOrdersForStore(code: string)` returning the per-store result object the loop already builds, and make the loop call it. Keep behaviour identical for the scheduler.

- [ ] **Step 7: Run tests and the full suite**

Run: `npx tsx --test tests/integrations/shopify-connections.test.ts && npm test`
Expected: new tests PASS; full suite has no new failures versus `master` (record pre-existing failures, if any, in the report).

- [ ] **Step 8: Commit**

```bash
git add lib app/api/webhooks/shopify app/api/integrations tests/integrations/shopify-connections.test.ts
git commit -m "refactor(shopify): stores and webhook secrets from shopify connections"
```

---

### Task 15: Remaining env business settings → `getSetting`

**Files:**
- Modify: `lib/scheduler/order-sync-scheduler.ts:40`, `payout-sync-scheduler.ts:57,67`, `zoho-sync-scheduler.ts:39`, `payment-confirm-scheduler.ts:40`, `ad-sync-scheduler.ts:31`, `cfo-digest-scheduler.ts:27`, `group-summary-scheduler.ts:26`
- Modify: `lib/orders/store-payment-policy.ts:39`, `lib/sync/order-sync.service.ts:48`, `app/api/inventory/sku/[sku]/push/route.ts:28`
- Modify: readers of `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_PAYMENTS_SPREADSHEET_ID`, `TELEGRAM_CHAT_ID`, `TELEGRAM_ALERT_CHAT_ID`, `FROM_EMAIL`
- Modify: `instrumentation.ts` (settings warm already via `runBootImport`)
- Test: `tests/settings/no-legacy-env.test.ts`

**Interfaces:**
- Consumes: `getSetting`, `peekSetting`, `SETTINGS`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test** (a source scan: every registry `legacyEnv` must be read only by `lib/settings/*`)

```ts
// tests/settings/no-legacy-env.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { SETTINGS } from "@/lib/settings/registry";

test("settings-registry env vars are read only through lib/settings", () => {
  const offenders: string[] = [];
  for (const d of SETTINGS) {
    if (!d.legacyEnv) continue;
    const out = execSync(`grep -rn "process.env.${d.legacyEnv}\\b\\|process.env\\[\\"${d.legacyEnv}\\"\\]" lib app components instrumentation.ts || true`, { encoding: "utf8" });
    for (const line of out.split("\n").filter(Boolean)) if (!line.startsWith("lib/settings/") && !line.startsWith("lib/connectors/importer")) offenders.push(line);
  }
  assert.deepEqual(offenders, []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/settings/no-legacy-env.test.ts`
Expected: FAIL listing the scheduler/policy/route lines.

- [ ] **Step 3: Replace each read**

Schedulers — pattern (order-sync shown; apply the same to each, keeping each file's own default constant and floor):

```ts
// before
const minutes = Math.max(parseInt(process.env.ORDER_SYNC_INTERVAL_MINUTES || "", 10) || DEFAULT_INTERVAL_MINUTES, 1);
// after
const minutes = Math.max(peekSetting<number | null>("sync.order_interval_minutes") ?? DEFAULT_INTERVAL_MINUTES, 1);
```

Key per file: order-sync → `sync.order_interval_minutes`; payout-sync → `sync.payout_interval_minutes` and `sync.shopify_payments_interval_minutes`; zoho-sync → `sync.zoho_interval_minutes`; payment-confirm → `sync.payment_confirm_interval_minutes`; ad-sync → `sync.ad_interval_minutes` (note the existing code has `parseInt(…, 120)` — a radix bug; the replacement fixes it); cfo-digest → `sync.cfo_digest_hour`; group-summary → `sync.group_summary_hour`. `peekSetting` is safe here because `runBootImport()` (which ends with `loadSettings(true)`) runs before the schedulers start in `instrumentation.ts`.

Policies and routes:

```ts
// lib/orders/store-payment-policy.ts:39
return peekSetting<boolean>("orders.wa_count_cod_as_paid");
// lib/sync/order-sync.service.ts:48
if (wooConfigured() && peekSetting<boolean>("orders.woo_sync")) {
// app/api/inventory/sku/[sku]/push/route.ts:28 — read per request, not at module load
const writeMode = () => peekSetting<"off" | "shadow" | "live">("inventory.stock_write_mode");
```

(Replace every `WRITE_MODE` use in that route with `writeMode()`.)

Remaining keys: run `grep -rn "process.env.GOOGLE_SHEETS_SPREADSHEET_ID\|process.env.GOOGLE_SHEETS_PAYMENTS_SPREADSHEET_ID\|process.env.TELEGRAM_CHAT_ID\|process.env.TELEGRAM_ALERT_CHAT_ID\|process.env.FROM_EMAIL\|process.env.SHOPIFY_API_VERSION\|process.env.SHOPIFY_PAYMENTS_SYNC_MINUTES" lib app` and replace each with `peekSetting<string>("<key>")` using the registry key from Task 3. Where the old code did `process.env.X ?? fallback`, keep `|| fallback` after `peekSetting` because defaults are `""`.

Add `import { peekSetting } from "@/lib/settings";` to each touched file.

- [ ] **Step 4: Run tests**

Run: `npx tsx --test tests/settings/*.test.ts && npx tsc --noEmit -p .`
Expected: PASS; no new type errors.

- [ ] **Step 5: Commit**

```bash
git add lib app tests/settings/no-legacy-env.test.ts
git commit -m "refactor(settings): schedulers, policies and routes read the settings registry"
```

---

### Task 16: Settings UI (tabs, connections, drawer with Orders, settings forms, modules)

**Files:**
- Create: `lib/modules.ts`
- Create: `components/settings/settings-page.tsx`, `components/settings/connections-tab.tsx`, `components/settings/connect-dialog.tsx`, `components/settings/connection-drawer.tsx`, `components/settings/settings-group-form.tsx`, `components/settings/business-profile-tab.tsx`, `components/settings/account-picker.tsx`, `components/settings/ui.tsx`
- Modify: `components/finance/finance-workspace.tsx:75-105` (nav filtered by modules), `:771-776` (settings view)
- Test: `tests/settings/modules.test.ts`

**Interfaces:**
- Consumes: `GET /api/connections`, `POST /api/connections/oauth/[provider]/start`, `GET|POST /api/connections/pending/[id]`, `PATCH|DELETE /api/connections/[id]`, `POST /api/connections/[id]/test|sync`, `GET /api/connections/[id]/orders`, `GET|PUT /api/settings`, existing `ZohoSettingsPanel`, `ZohoOrgsPanel`, `PaymentSheetMonthsPanel`.
- Produces: `MODULES`, `enabledModules(industries: string[], overrides: Record<string, boolean>): Set<string>`, `moduleForView(view: string): string | null`, `<SettingsPage />`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/settings/modules.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { enabledModules, moduleForView, MODULES } from "@/lib/modules";

test("ecommerce preset enables every module that exists today", () => {
  const on = enabledModules(["ecommerce"], {});
  for (const m of MODULES) assert.ok(on.has(m.id), m.id);
});

test("overrides switch individual modules", () => {
  const on = enabledModules(["ecommerce"], { marketing: false });
  assert.equal(on.has("marketing"), false);
  assert.equal(on.has("orders"), true);
});

test("services-only business does not get storefront modules", () => {
  const on = enabledModules(["services"], {});
  assert.equal(on.has("storefronts"), false);
  assert.equal(on.has("dashboard"), true);
});

test("settings is always reachable", () => {
  assert.equal(moduleForView("settings"), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/settings/modules.test.ts`
Expected: FAIL — cannot find module `@/lib/modules`

- [ ] **Step 3: Implement modules**

```ts
// lib/modules.ts
/* Feature modules a workspace can switch on. Industries in the business
 * profile pick a preset; profile.modules overrides single modules. Industry
 * packs (wholesale, construction, logistics) add their modules here in their
 * own specs. A nav view with no module (settings) is always visible. */

export type Industry = "ecommerce" | "wholesale" | "construction" | "logistics" | "services";
export type ModuleDef = { id: string; label: string; views: string[]; presetFor: Industry[] };

const ALL: Industry[] = ["ecommerce", "wholesale", "construction", "logistics", "services"];

export const MODULES: ModuleDef[] = [
  { id: "dashboard", label: "Dashboard", views: ["dashboard"], presetFor: ALL },
  { id: "orders", label: "Orders", views: ["orders"], presetFor: ["ecommerce", "wholesale"] },
  { id: "reconciliation", label: "Reconciliation", views: ["reconciliation"], presetFor: ALL },
  { id: "payouts", label: "Gateway payouts", views: ["payouts"], presetFor: ["ecommerce"] },
  { id: "bank", label: "Bank actuals", views: ["documents"], presetFor: ALL },
  { id: "dispatch", label: "Dispatch", views: ["dispatch"], presetFor: ["ecommerce", "wholesale", "logistics"] },
  { id: "returns", label: "Returns", views: ["returns"], presetFor: ["ecommerce", "wholesale"] },
  { id: "marketing", label: "Marketing", views: ["marketing"], presetFor: ["ecommerce"] },
  { id: "storefronts", label: "Storefronts", views: ["storefronts"], presetFor: ["ecommerce"] },
  { id: "inventory", label: "Inventory", views: ["inventory"], presetFor: ["ecommerce", "wholesale"] },
  { id: "customers", label: "Customers", views: ["customers"], presetFor: ALL },
  { id: "leads", label: "Leads", views: ["leads"], presetFor: ALL },
];

export function enabledModules(industries: string[], overrides: Record<string, boolean>): Set<string> {
  const on = new Set(MODULES.filter((m) => m.presetFor.some((i) => industries.includes(i))).map((m) => m.id));
  for (const [id, v] of Object.entries(overrides)) {
    if (!MODULES.some((m) => m.id === id)) continue;
    if (v) on.add(id); else on.delete(id);
  }
  return on;
}

export function moduleForView(view: string): string | null {
  return MODULES.find((m) => m.views.includes(view))?.id ?? null;
}
```

Run: `npx tsx --test tests/settings/modules.test.ts` → PASS (4 tests).

- [ ] **Step 4: Build the UI components**

Shared primitives (match the Zoho orgs panel look — read `components/finance/zoho/zoho-orgs-panel.tsx` first and reuse its exact hex values and radius/shadow classes):

```tsx
// components/settings/ui.tsx
"use client";
import type { ReactNode } from "react";

export const api = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new Error(`Server returned ${r.status} (not JSON) — your session may have expired`);
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { body: j, status: r.status });
  return j;
};

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#D8E1F1] bg-white p-5 shadow-[0_1px_2px_rgba(15,27,61,0.04)]">
      {(title || actions) && <header className="mb-4 flex items-center justify-between gap-3"><h3 className="text-[14px] font-semibold text-[#0F1B3D]">{title}</h3>{actions}</header>}
      {children}
    </section>
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-[#E7F6EE] text-[#17734A]" },
  needs_reauth: { label: "Reconnect", cls: "bg-[#FDF0E1] text-[#9A5A0B]" },
  error: { label: "Error", cls: "bg-[#FDECEC] text-[#A12B2B]" },
  disabled: { label: "Disabled", cls: "bg-[#EEF1F6] text-[#5B6478]" },
};
export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.error;
  return <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${s.cls}`}>{s.label}</span>;
}

const SOURCE: Record<string, string> = { database: "bg-[#E7F0FE] text-[#1F4FB8]", env: "bg-[#FDF0E1] text-[#9A5A0B]", default: "bg-[#EEF1F6] text-[#5B6478]" };
export function SourceBadge({ source }: { source: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide ${SOURCE[source]}`}>{source === "env" ? ".env fallback" : source}</span>;
}

export function Button({ children, tone = "primary", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "ghost" | "danger" }) {
  const cls = tone === "primary" ? "bg-[#0F1B3D] text-white hover:bg-[#1B2B5C]" : tone === "danger" ? "text-[#A12B2B] hover:bg-[#FDECEC]" : "text-[#0F1B3D] hover:bg-[#EEF3FB]";
  return <button {...p} className={`h-8 rounded-full px-3.5 text-[12.5px] font-medium disabled:opacity-50 ${cls} ${p.className ?? ""}`}>{children}</button>;
}

export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-AE", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" }) : "—");
```

Page shell with tabs (tab in `?tab=`):

```tsx
// components/settings/settings-page.tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { ConnectionsTab } from "./connections-tab";
import { SettingsGroupForm } from "./settings-group-form";
import { BusinessProfileTab } from "./business-profile-tab";
import { Card } from "./ui";
import { ZohoOrgsPanel } from "@/components/finance/zoho/zoho-orgs-panel";
import { ZohoSettingsPanel } from "@/components/finance/reconciliation/zoho-settings-panel";
import { PaymentSheetMonthsPanel } from "@/components/finance/payment-sheet-months-panel";

const TABS = [
  { id: "profile", label: "Business profile" },
  { id: "connections", label: "Connections" },
  { id: "accounting", label: "Accounting" },
  { id: "sync", label: "Sync & schedules" },
  { id: "team", label: "Team & roles" },
  { id: "advanced", label: "Advanced" },
] as const;

export function SettingsPage({ isAdmin }: { isAdmin: boolean }) {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = isAdmin ? (sp.get("tab") ?? "connections") : "connections";
  const go = (id: string) => router.replace(`/settings?tab=${id}`);
  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-1.5" aria-label="Settings sections">
        {(isAdmin ? TABS : TABS.filter((t) => t.id === "connections")).map((t) => (
          <button key={t.id} onClick={() => go(t.id)}
            className={`h-9 rounded-full px-4 text-[13px] ${tab === t.id ? "bg-[#0F1B3D] text-white" : "bg-white text-[#0F1B3D] border border-[#D8E1F1]"}`}>{t.label}</button>
        ))}
      </nav>
      {tab === "profile" && <BusinessProfileTab />}
      {tab === "connections" && <ConnectionsTab readOnly={!isAdmin} />}
      {tab === "accounting" && <div className="space-y-6"><ZohoOrgsPanel /><ZohoSettingsPanel /><SettingsGroupForm group="accounting" /></div>}
      {tab === "sync" && <SettingsGroupForm group="sync" />}
      {tab === "team" && <Card title="Team & roles"><p className="text-[13px] text-[#5B6478]">Individual user accounts replace the shared role passwords in a follow-up release.</p></Card>}
      {tab === "advanced" && <div className="space-y-6"><PaymentSheetMonthsPanel /><SettingsGroupForm group="advanced" /></div>}
    </div>
  );
}
```

Confirm the three panel import paths with `grep -rn "export function ZohoOrgsPanel\|export function ZohoSettingsPanel\|export function PaymentSheetMonthsPanel" components` and use the real paths/export styles (default vs named).

Generic settings form (one per group):

```tsx
// components/settings/settings-group-form.tsx
"use client";
import { useEffect, useState } from "react";
import { api, Button, Card, SourceBadge } from "./ui";

type S = { key: string; group: string; label: string; help?: string; kind: string; options?: string[]; value: unknown; source: string; legacyEnv?: string };
const TITLES: Record<string, string> = { profile: "Business profile", accounting: "Accounting defaults", sync: "Sync & schedules", advanced: "Advanced" };

export function SettingsGroupForm({ group, keys }: { group: string; keys?: string[] }) {
  const [rows, setRows] = useState<S[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [msg, setMsg] = useState<string>("");
  const load = () => api("/api/settings").then((j) => setRows((j.settings as S[]).filter((s) => s.group === group && (!keys || keys.includes(s.key))))).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, [group]);

  const save = async () => {
    setMsg("");
    try { await api("/api/settings", { method: "PUT", body: JSON.stringify({ values: draft }) }); setDraft({}); await load(); setMsg("Saved"); }
    catch (e) { setMsg((e as Error).message); }
  };
  const val = (s: S) => (s.key in draft ? draft[s.key] : s.value);
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <Card title={TITLES[group] ?? group} actions={<Button disabled={!Object.keys(draft).length} onClick={save}>Save</Button>}>
      <div className="divide-y divide-[#EEF1F6]">
        {rows.map((s) => (
          <label key={s.key} className="grid grid-cols-1 gap-2 py-3 md:grid-cols-[1fr_320px] md:items-center">
            <span>
              <span className="flex items-center gap-2 text-[13px] text-[#0F1B3D]">{s.label} <SourceBadge source={s.source} /></span>
              {s.help && <span className="block text-[11.5px] text-[#8A93A6]">{s.help}</span>}
              {s.source === "env" && s.legacyEnv && <span className="block text-[11.5px] text-[#9A5A0B]">From {s.legacyEnv} — save to move it into Settings</span>}
            </span>
            {s.kind === "toggle" ? (
              <input type="checkbox" checked={Boolean(val(s))} onChange={(e) => set(s.key, e.target.checked)} className="h-4 w-4" />
            ) : s.kind === "select" ? (
              <select value={String(val(s) ?? "")} onChange={(e) => set(s.key, e.target.value)} className="h-9 rounded-lg border border-[#D8E1F1] px-2 text-[13px]">
                {s.options?.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : s.kind === "number" ? (
              <input type="number" value={val(s) === null ? "" : String(val(s))} placeholder="default"
                onChange={(e) => set(s.key, e.target.value === "" ? null : Number(e.target.value))} className="h-9 rounded-lg border border-[#D8E1F1] px-2 text-[13px]" />
            ) : s.kind === "json" || s.kind === "tags" ? (
              <textarea rows={2} defaultValue={JSON.stringify(val(s))} onBlur={(e) => { try { set(s.key, JSON.parse(e.target.value)); } catch { setMsg(`${s.label}: not valid JSON`); } }}
                className="rounded-lg border border-[#D8E1F1] px-2 py-1 font-mono text-[12px]" />
            ) : (
              <input value={String(val(s) ?? "")} onChange={(e) => set(s.key, e.target.value)} className="h-9 rounded-lg border border-[#D8E1F1] px-2 text-[13px]" />
            )}
          </label>
        ))}
      </div>
      {msg && <p className="mt-3 text-[12.5px] text-[#5B6478]" role="status">{msg}</p>}
    </Card>
  );
}
```

Business profile (industries + module toggles + profile keys):

```tsx
// components/settings/business-profile-tab.tsx
"use client";
import { useEffect, useState } from "react";
import { MODULES, enabledModules } from "@/lib/modules";
import { api, Button, Card } from "./ui";
import { SettingsGroupForm } from "./settings-group-form";

const INDUSTRIES = [
  { id: "ecommerce", label: "E-commerce" }, { id: "wholesale", label: "Wholesale / distribution" },
  { id: "construction", label: "Construction / contracting" }, { id: "logistics", label: "Logistics / freight" }, { id: "services", label: "Services" },
];

export function BusinessProfileTab() {
  const [industries, setIndustries] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api("/api/settings").then((j) => {
      const get = (k: string) => j.settings.find((s: any) => s.key === k)?.value;
      setIndustries(get("profile.industries") ?? ["ecommerce"]);
      setOverrides(get("profile.modules") ?? {});
    });
  }, []);
  const on = enabledModules(industries, overrides);
  const preset = enabledModules(industries, {});
  const save = async () => {
    try { await api("/api/settings", { method: "PUT", body: JSON.stringify({ values: { "profile.industries": industries, "profile.modules": overrides } }) }); setMsg("Saved — reload to update the navigation"); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="space-y-6">
      <SettingsGroupForm group="profile" keys={["profile.legal_name", "profile.trn", "profile.base_currency", "profile.fiscal_year_end", "profile.timezone", "app.public_url"]} />
      <Card title="Industries & modules" actions={<Button onClick={save} disabled={!industries.length}>Save</Button>}>
        <div className="mb-4 flex flex-wrap gap-2">
          {INDUSTRIES.map((i) => (
            <label key={i.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-[12.5px] ${industries.includes(i.id) ? "border-[#0F1B3D] bg-[#0F1B3D] text-white" : "border-[#D8E1F1] text-[#0F1B3D]"}`}>
              <input type="checkbox" className="sr-only" checked={industries.includes(i.id)}
                onChange={(e) => setIndustries((cur) => (e.target.checked ? [...cur, i.id] : cur.filter((x) => x !== i.id)))} />
              {i.label}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <label key={m.id} className="flex items-center justify-between rounded-lg border border-[#EEF1F6] px-3 py-2 text-[13px]">
              <span>{m.label}{overrides[m.id] !== undefined && overrides[m.id] !== preset.has(m.id) && <span className="ml-2 text-[11px] text-[#8A93A6]">custom</span>}</span>
              <input type="checkbox" checked={on.has(m.id)} onChange={(e) => setOverrides((o) => ({ ...o, [m.id]: e.target.checked }))} />
            </label>
          ))}
        </div>
        {msg && <p className="mt-3 text-[12.5px] text-[#5B6478]" role="status">{msg}</p>}
      </Card>
    </div>
  );
}
```

Connections tab (cards grouped by category, catalogue, callback banners, account picker):

```tsx
// components/settings/connections-tab.tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, Button, Card, StatusPill, fmtDate } from "./ui";
import { ConnectDialog, type CatalogueEntry } from "./connect-dialog";
import { ConnectionDrawer } from "./connection-drawer";
import { AccountPicker } from "./account-picker";

export type PublicConn = {
  id: string; provider: string; providerLabel: string; category: string; authMode: string; grantType: string; accountRef: string; label: string;
  config: Record<string, unknown>; scopes: string; status: string; lastCheckedAt: string | null; lastSyncedAt: string | null; lastError: string; connectedBy: string; updatedAt: string; hasSecrets: boolean;
};

const CATEGORY_LABEL: Record<string, string> = { accounting: "Accounting", store: "Stores & marketplaces", marketplace: "Stores & marketplaces", email: "Email", gateway: "Payment gateways", ads: "Ads", courier: "Couriers" };
const COMING_SOON = [
  { label: "Amazon", category: "marketplace" }, { label: "TikTok Shop", category: "marketplace" }, { label: "noon", category: "marketplace" },
  { label: "Stripe, Telr, Tabby, Tamara, Checkout", category: "gateway" },
];
const ERRORS: Record<string, string> = {
  state_used: "That connect link was already used.", state_expired: "The connect link expired.", denied: "Access was not granted.",
  bad_hmac: "Shopify's signature didn't verify.", bad_host: "The provider redirected to an unexpected host.", not_admin: "Only an admin can finish a connection.",
};

export function ConnectionsTab({ readOnly }: { readOnly: boolean }) {
  const sp = useSearchParams();
  const [conns, setConns] = useState<PublicConn[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [adding, setAdding] = useState<string | null>(sp.get("add"));
  const [open, setOpen] = useState<string | null>(null);
  const [banner, setBanner] = useState<string>("");
  const load = useCallback(() => api("/api/connections").then((j) => { setConns(j.connections); setCatalogue(j.catalogue); }).catch((e) => setBanner(e.message)), []);
  useEffect(() => {
    load();
    if (sp.get("connected")) setBanner("Connected ✓");
    if (sp.get("error")) setBanner(`${ERRORS[sp.get("error")!] ?? "Connection failed."} ${sp.get("message") ?? ""}`);
  }, [load, sp]);

  const groups = [...new Set([...conns.map((c) => CATEGORY_LABEL[c.category]), ...catalogue.map((c) => CATEGORY_LABEL[c.category])])];
  return (
    <div className="space-y-6">
      {banner && <div className="rounded-xl border border-[#D8E1F1] bg-white px-4 py-3 text-[13px] text-[#0F1B3D]" role="status">{banner}</div>}
      {sp.get("pick") && <AccountPicker pendingId={sp.get("pick")!} onDone={() => { setBanner("Connected ✓"); load(); }} />}
      {conns.some((c) => c.status === "needs_reauth") && (
        <div className="rounded-xl bg-[#FDF0E1] px-4 py-3 text-[13px] text-[#9A5A0B]">
          {conns.filter((c) => c.status === "needs_reauth").map((c) => c.label).join(", ")} need to be reconnected — their data stops updating until then.
        </div>
      )}
      {!readOnly && <div className="flex justify-end"><Button onClick={() => setAdding("")}>Add connection</Button></div>}
      {groups.map((g) => (
        <Card key={g} title={g}>
          <ul className="divide-y divide-[#EEF1F6]">
            {conns.filter((c) => CATEGORY_LABEL[c.category] === g).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <button className="text-left" onClick={() => !readOnly && setOpen(c.id)} disabled={readOnly}>
                  <div className="text-[13.5px] font-medium text-[#0F1B3D]">{c.label} <span className="text-[12px] font-normal text-[#8A93A6]">· {c.providerLabel} · {c.accountRef}</span></div>
                  <div className="text-[11.5px] text-[#8A93A6]">{c.authMode === "platform" ? "Connected with RAMZA" : c.authMode === "own_app" ? "Your own app" : "Access token"} · checked {fmtDate(c.lastCheckedAt)} · synced {fmtDate(c.lastSyncedAt)}</div>
                  {c.lastError && <div className="text-[11.5px] text-[#A12B2B]">{c.lastError}</div>}
                </button>
                <div className="flex items-center gap-2">
                  <StatusPill status={c.status} />
                  {!readOnly && c.status === "needs_reauth" && <Button tone="ghost" onClick={() => setAdding(c.provider)}>Reconnect</Button>}
                </div>
              </li>
            ))}
            {COMING_SOON.filter((s) => CATEGORY_LABEL[s.category] === g).map((s) => (
              <li key={s.label} className="flex items-center justify-between py-3 text-[13px] text-[#8A93A6]"><span>{s.label}</span><span className="text-[11.5px]">Coming soon</span></li>
            ))}
          </ul>
        </Card>
      ))}
      {adding !== null && <ConnectDialog catalogue={catalogue} initialProvider={adding} onClose={() => setAdding(null)} onConnected={() => { setAdding(null); setBanner("Connected ✓"); load(); }} />}
      {open && <ConnectionDrawer id={open} onClose={() => { setOpen(null); load(); }} />}
    </div>
  );
}
```

Make the "Coming soon" groups render even with no connection: `groups` must also include `CATEGORY_LABEL[s.category]` for each `COMING_SOON` entry — add `...COMING_SOON.map((s) => CATEGORY_LABEL[s.category])` to the `Set`.

Connect dialog (provider → mode → grant → fields; shows the exact redirect URI for own apps):

```tsx
// components/settings/connect-dialog.tsx
"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, Button } from "./ui";

export type CatalogueEntry = {
  provider: string; label: string; category: string; authModes: string[]; grantTypes: Record<string, string[]>;
  startParams: { key: string; label: string; pattern?: string; options?: string[] }[]; platformAvailable: boolean;
};

const GRANT_LABEL: Record<string, string> = {
  authorization_code: "Sign in (OAuth)", client_credentials: "Client credentials (same-organisation Dev Dashboard app)",
  static_token: "Paste access token", static_refresh: "Paste refresh token (Zoho self-client)",
};
const HELP: Record<string, string> = {
  gmail: "Google Cloud → Credentials → OAuth client (Web). Set the OAuth consent screen to “In production” — in “Testing” Google expires the connection after 7 days. “Internal” works for Google Workspace without verification.",
  shopify: "Shopify Dev Dashboard → your app → Settings for the client ID/secret. Legacy custom apps (created before 2026) can use “Paste access token” plus the app's API secret key for webhooks.",
  zoho: "api-console.zoho.com → Server-based application, or a Self Client for “Paste refresh token”.",
};

export function ConnectDialog({ catalogue, initialProvider, onClose, onConnected }: { catalogue: CatalogueEntry[]; initialProvider: string; onClose: () => void; onConnected: () => void }) {
  const [provider, setProvider] = useState(initialProvider || catalogue[0]?.provider || "");
  const entry = catalogue.find((c) => c.provider === provider);
  const modes = entry ? entry.authModes.filter((m) => m !== "platform" || entry.platformAvailable) : [];
  const [mode, setMode] = useState("");
  const [grant, setGrant] = useState("");
  const [f, setF] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => { setMode(modes[0] ?? ""); }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setGrant(entry?.grantTypes[mode]?.[0] ?? ""); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api("/api/settings").then((j) => setOrigin(j.settings.find((s: any) => s.key === "app.public_url")?.value ?? "")).catch(() => setOrigin(window.location.origin)); }, []);

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const params = Object.fromEntries((entry?.startParams ?? []).map((p) => [p.key, (f[p.key] ?? "").trim()]));
      const body = {
        authMode: mode, grantType: grant, params,
        ...(mode === "own_app" ? { ownApp: { clientId: f.clientId ?? "", clientSecret: f.clientSecret ?? "" } } : {}),
        ...(grant === "static_token" ? { token: f.token } : {}), ...(grant === "static_refresh" ? { refreshToken: f.refreshToken } : {}),
        ...(f.webhookSecret ? { webhookSecret: f.webhookSecret } : {}),
      };
      const j = await api(`/api/connections/oauth/${provider}/start`, { method: "POST", body: JSON.stringify(body) });
      if (j.redirect) window.location.href = j.redirect;
      else onConnected();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const input = (key: string, label: string, opts: { type?: string; placeholder?: string } = {}) => (
    <label className="block"><span className="text-[12px] text-[#5B6478]">{label}</span>
      <input type={opts.type ?? "text"} placeholder={opts.placeholder} value={f[key] ?? ""} onChange={(e) => setF((x) => ({ ...x, [key]: e.target.value }))}
        className="mt-1 h-9 w-full rounded-lg border border-[#D8E1F1] px-2 text-[13px]" autoComplete="off" /></label>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F1B3D]/40 p-4" role="dialog" aria-modal="true" aria-label="Add connection">
      <div className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6">
        <h2 className="text-[16px] font-semibold text-[#0F1B3D]">Add connection</h2>
        <label className="block"><span className="text-[12px] text-[#5B6478]">Service</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#D8E1F1] px-2 text-[13px]">
            {catalogue.map((c) => <option key={c.provider} value={c.provider}>{c.label}</option>)}
          </select></label>
        <div className="flex flex-wrap gap-2">
          {modes.map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`rounded-full border px-3 py-1.5 text-[12.5px] ${mode === m ? "border-[#0F1B3D] bg-[#0F1B3D] text-white" : "border-[#D8E1F1]"}`}>
              {m === "platform" ? "Connect with RAMZA" : m === "own_app" ? "Use your own app credentials" : "Access token"}
            </button>
          ))}
        </div>
        {(entry?.grantTypes[mode]?.length ?? 0) > 1 && (
          <select value={grant} onChange={(e) => setGrant(e.target.value)} className="h-9 w-full rounded-lg border border-[#D8E1F1] px-2 text-[13px]">
            {entry!.grantTypes[mode].map((g) => <option key={g} value={g}>{GRANT_LABEL[g]}</option>)}
          </select>
        )}
        {entry?.startParams.map((p) => p.options ? (
          <label key={p.key} className="block"><span className="text-[12px] text-[#5B6478]">{p.label}</span>
            <select value={f[p.key] ?? p.options[0]} onChange={(e) => setF((x) => ({ ...x, [p.key]: e.target.value }))} className="mt-1 h-9 w-full rounded-lg border border-[#D8E1F1] px-2 text-[13px]">
              {p.options.map((o) => <option key={o}>{o}</option>)}</select></label>
        ) : <div key={p.key}>{input(p.key, p.label)}</div>)}
        {mode === "own_app" && (<>
          {input("clientId", "Client ID")}{input("clientSecret", "Client secret", { type: "password" })}
          {grant === "authorization_code" && <p className="rounded-lg bg-[#F5F8FD] p-2 text-[11.5px] text-[#5B6478]">Add this redirect URI to your app: <code className="break-all">{origin.replace(/\/+$/, "")}/api/connections/oauth/{provider}/callback</code></p>}
        </>)}
        {grant === "static_token" && input("token", "Access token", { type: "password" })}
        {grant === "static_refresh" && input("refreshToken", "Refresh token", { type: "password" })}
        {provider === "shopify" && mode === "token" && input("webhookSecret", "App API secret key (verifies webhooks)", { type: "password" })}
        {HELP[provider] && <p className="text-[11.5px] leading-relaxed text-[#8A93A6]">{HELP[provider]}</p>}
        {err && <p className="text-[12.5px] text-[#A12B2B]" role="alert">{err}</p>}
        <div className="flex justify-end gap-2"><Button tone="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={busy || !mode}>{busy ? "Connecting…" : "Connect"}</Button></div>
      </div>
    </div>,
    document.body,
  );
}
```

Account picker (multi-org Zoho):

```tsx
// components/settings/account-picker.tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Button, Card } from "./ui";

export function AccountPicker({ pendingId, onDone }: { pendingId: string; onDone: () => void }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<{ accountRef: string; label: string }[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => { api(`/api/connections/pending/${pendingId}`).then((j) => setAccounts(j.accounts)).catch((e) => setErr(e.message)); }, [pendingId]);
  const save = async () => {
    try { await api(`/api/connections/pending/${pendingId}`, { method: "POST", body: JSON.stringify({ accountRefs: chosen }) }); router.replace("/settings?tab=connections"); onDone(); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <Card title="Choose which accounts to connect" actions={<Button onClick={save} disabled={!chosen.length}>Connect {chosen.length || ""}</Button>}>
      {err && <p className="text-[12.5px] text-[#A12B2B]">{err}</p>}
      {accounts.map((a) => (
        <label key={a.accountRef} className="flex items-center gap-2 py-1.5 text-[13px]">
          <input type="checkbox" checked={chosen.includes(a.accountRef)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, a.accountRef] : c.filter((x) => x !== a.accountRef)))} />
          {a.label} <span className="text-[#8A93A6]">({a.accountRef})</span>
        </label>
      ))}
    </Card>
  );
}
```

Connection drawer (settings form from `configFields`, secrets as "•••• set", Test / Sync now / Disable / Remove, and the per-category tab):

```tsx
// components/settings/connection-drawer.tsx
"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, Button, StatusPill, fmtDate } from "./ui";
import type { PublicConn } from "./connections-tab";

type LiveOrder = { id: string; order_number?: string; created_at?: string; order_date?: string; total?: number; currency?: string; financial_status?: string; inOurDb: boolean };

export function ConnectionDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [c, setC] = useState<PublicConn | null>(null);
  const [catalogueFields, setFields] = useState<{ key: string; label: string; kind: string; help?: string }[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState("");
  const [orders, setOrders] = useState<{ orders: LiveOrder[]; totalInDb: number } | null>(null);
  const [ordersErr, setOrdersErr] = useState("");
  const [busy, setBusy] = useState("");

  const load = async () => {
    const j = await api("/api/connections");
    const conn = (j.connections as PublicConn[]).find((x) => x.id === id) ?? null;
    setC(conn); setLabel(conn?.label ?? "");
    setFields(j.catalogue.find((x: any) => x.provider === conn?.provider)?.configFields ?? []);
  };
  useEffect(() => { load().catch((e) => setMsg(e.message)); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (c?.category !== "store" && c?.category !== "marketplace") return;
    api(`/api/connections/${id}/orders?limit=50`).then(setOrders).catch((e) => setOrdersErr(e.message));
  }, [c?.category, id]);

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name); setMsg("");
    try { const r: any = await fn(); setMsg(r?.summary ?? r?.error ?? (r?.ok === false ? r.error : "Done")); await load(); }
    catch (e: any) { setMsg(e.message); } finally { setBusy(""); }
  };
  if (!c) return null;
  const save = () => act("save", () => api(`/api/connections/${id}`, { method: "PATCH", body: JSON.stringify({ label, config: draft }) }));
  const test = () => act("test", () => api(`/api/connections/${id}/test`, { method: "POST" }));
  const sync = () => act("sync", () => api(`/api/connections/${id}/sync`, { method: "POST" }));
  const toggle = () => act("toggle", () => api(`/api/connections/${id}`, { method: "PATCH", body: JSON.stringify({ status: c.status === "disabled" ? "active" : "disabled" }) }));
  const remove = () => act("remove", async () => { await api(`/api/connections/${id}`, { method: "DELETE" }); onClose(); });

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-[#0F1B3D]/30" onClick={onClose}>
      <aside className="h-full w-full max-w-2xl overflow-y-auto bg-white p-6" onClick={(e) => e.stopPropagation()} aria-label={`${c.label} connection`}>
        <header className="mb-5 flex items-start justify-between gap-3">
          <div><h2 className="text-[17px] font-semibold text-[#0F1B3D]">{c.label}</h2><p className="text-[12px] text-[#8A93A6]">{c.providerLabel} · {c.accountRef}</p></div>
          <StatusPill status={c.status} />
        </header>
        {c.lastError && <p className="mb-4 rounded-lg bg-[#FDECEC] p-2 text-[12.5px] text-[#A12B2B]">{c.lastError}</p>}
        <div className="mb-5 flex flex-wrap gap-2">
          <Button onClick={test} disabled={!!busy}>{busy === "test" ? "Testing…" : "Test"}</Button>
          <Button tone="ghost" onClick={sync} disabled={!!busy}>{busy === "sync" ? "Syncing…" : "Sync now"}</Button>
          <Button tone="ghost" onClick={toggle} disabled={!!busy}>{c.status === "disabled" ? "Enable" : "Disable"}</Button>
          <Button tone="danger" onClick={remove} disabled={!!busy}>Remove</Button>
        </div>
        {msg && <p className="mb-4 text-[12.5px] text-[#5B6478]" role="status">{msg}</p>}

        <section className="mb-6 space-y-3">
          <h3 className="text-[13px] font-semibold text-[#0F1B3D]">Settings</h3>
          <label className="block"><span className="text-[12px] text-[#5B6478]">Name</span><input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#D8E1F1] px-2 text-[13px]" /></label>
          {catalogueFields.map((fd) => (
            <label key={fd.key} className="block"><span className="text-[12px] text-[#5B6478]">{fd.label}</span>
              {fd.kind === "json" ? (
                <textarea rows={2} defaultValue={JSON.stringify(c.config[fd.key] ?? null)} onBlur={(e) => { try { setDraft((d) => ({ ...d, [fd.key]: JSON.parse(e.target.value) })); } catch { setMsg(`${fd.label}: not valid JSON`); } }} className="mt-1 w-full rounded-lg border border-[#D8E1F1] px-2 py-1 font-mono text-[12px]" />
              ) : (
                <input type={fd.kind === "number" ? "number" : "text"} defaultValue={String(c.config[fd.key] ?? "")}
                  onChange={(e) => setDraft((d) => ({ ...d, [fd.key]: fd.kind === "number" ? Number(e.target.value) : e.target.value }))} className="mt-1 h-9 w-full rounded-lg border border-[#D8E1F1] px-2 text-[13px]" />
              )}
              {fd.help && <span className="text-[11px] text-[#8A93A6]">{fd.help}</span>}
            </label>
          ))}
          <p className="text-[12px] text-[#5B6478]">Credentials: {c.hasSecrets ? `•••• set ${fmtDate(c.updatedAt)} by ${c.connectedBy || "—"}` : "none"} — use Reconnect to replace them.</p>
          <p className="text-[12px] text-[#5B6478]">Scopes: {c.scopes || "unknown"}</p>
          <Button onClick={save} disabled={!!busy}>Save</Button>
        </section>

        {(c.category === "store" || c.category === "marketplace") && (
          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-[#0F1B3D]">Orders — live from {c.providerLabel}</h3>
            {ordersErr && <p className="text-[12.5px] text-[#A12B2B]">{ordersErr}</p>}
            {!orders && !ordersErr && <p className="text-[12.5px] text-[#8A93A6]">Loading…</p>}
            {orders && (<>
              <p className="mb-2 text-[12px] text-[#5B6478]">{orders.totalInDb.toLocaleString()} orders from this store in our database · {orders.orders.filter((o) => !o.inOurDb).length} of the latest {orders.orders.length} not yet synced</p>
              <table className="w-full text-[12.5px]"><thead><tr className="text-left text-[#8A93A6]"><th className="py-1">Order</th><th>Date</th><th className="text-right">Total</th><th>Status</th><th>In our DB</th></tr></thead>
                <tbody>{orders.orders.map((o) => (
                  <tr key={o.id} className="border-t border-[#EEF1F6]"><td className="py-1.5">{o.order_number ?? o.id}</td><td>{fmtDate(o.order_date ?? o.created_at ?? null)}</td>
                    <td className="text-right tabular-nums">{o.total?.toLocaleString(undefined, { maximumFractionDigits: 2 })} {o.currency}</td><td>{o.financial_status}</td>
                    <td>{o.inOurDb ? "✓" : <span className="text-[#9A5A0B]">not synced</span>}</td></tr>))}</tbody></table>
            </>)}
          </section>
        )}
      </aside>
    </div>,
    document.body,
  );
}
```

Before finalising the orders table, open `lib/normalize/order.ts:14-60` and replace `order_number`, `order_date`, `total`, `currency`, `financial_status` with the real `OrderRow` field names (and update `LiveOrder`). Memory "order_date timezone trap": `order_date` is offset-less UTC — format it with the existing `dubaiDayKey`/`utcMs` helpers (`grep -rn "export function utcMs\|export function dubaiDayKey" lib`) instead of `new Date()`.

The Zoho drawer extras (API usage vs budget, account mapping) stay where they already live — the Accounting tab's `ZohoOrgsPanel` / `ZohoSettingsPanel` — and the Gmail extras (recent ingests) are deferred: add one line under the drawer's Settings section for Gmail connections, `<a href="/payouts">Recent payout emails are listed on Payouts</a>`. Note this scope trim in the task report.

- [ ] **Step 5: Wire into the workspace**

In `components/finance/finance-workspace.tsx`:

1. Replace the settings branch (lines ~771–776):

```tsx
          ) : view === "settings" ? (
            <SettingsPage isAdmin={isFounder} />
```

with `import { SettingsPage } from "@/components/settings/settings-page";` and remove now-unused imports of `ZohoOrgsPanel`/`ZohoSettingsPanel`/`PaymentSheetMonthsPanel` **only if** nothing else in the file uses them. `isFounder` is the existing admin flag in this component — confirm with `grep -n "isFounder" components/finance/finance-workspace.tsx` that it means role admin.

2. Filter the nav by modules. Add state loaded once:

```tsx
  const [enabled, setEnabled] = useState<Set<string> | null>(null);
  useEffect(() => {
    fetch("/api/settings").then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!j) return; // non-admin: settings API is admin-only → show everything
      const get = (k: string) => j.settings.find((s: any) => s.key === k)?.value;
      setEnabled(enabledModules(get("profile.industries") ?? ["ecommerce"], get("profile.modules") ?? {}));
    }).catch(() => {});
  }, []);
  const visibleNav = NAV.filter((item) => { const m = moduleForView(item.view); return !m || !enabled || enabled.has(m); });
```

and change `{NAV.map((item) => {` to `{visibleNav.map((item) => {`. Import `enabledModules, moduleForView` from `@/lib/modules`.

Non-admin roles get a 403 from `/api/settings`, so they see the full nav — acceptable for release 1 (role-based nav is the Team & roles spec). Note it in the report.

- [ ] **Step 6: Verify in the running app**

Run: `npm run dev` then, signed in as admin, visit `/settings`.
Expected:
- Connections tab lists `env` (Zoho), `house-of-omnia`, four Shopify stores, Gmail mailbox(es) — imported in Task 11 — each with a status pill; "Coming soon" rows for Amazon / TikTok Shop / noon / gateways.
- Opening a Shopify store shows live orders with "In our DB ✓" on synced ones; Test reports missing scopes for UAE/KSA (`read_shopify_payments_payouts`, `read_reports`).
- Sync & schedules shows `.env fallback` badges on any value not yet saved; saving one flips it to `database`.
- Business profile: unticking Marketing and saving hides it from the nav after reload.
Use the `run` skill or Claude-in-Chrome to capture screenshots for the report.

- [ ] **Step 7: Commit**

```bash
git add lib/modules.ts components/settings components/finance/finance-workspace.tsx tests/settings/modules.test.ts
git commit -m "feat(settings): Settings UI — connections, drawer with live orders, settings forms, modules"
```

---

### Task 17: Release-1 verification on live data (no Zoho writes)

**Files:** none created; this task produces a verification report in the PR description.

- [ ] **Step 1: Run the importer for real**

Run: `npx tsx db/import-connections.ts`
Expected: same IDs as the Task 11 dry run, now `created`.

- [ ] **Step 2: Verify DB matches env**

Run: `npx tsx db/verify-connections.ts`
Expected: `✓ DB matches env for N connections`. Any `setting … still from env` line: open Settings → the group → Save (moves it to the DB), rerun.

- [ ] **Step 3: Exercise each path through the DB**

- Order sync: `curl -s -X POST localhost:3000/api/connections/shopify-uae/sync -H "cookie: <admin session>"` → a non-zero `orders synced` summary; `order_sync_runs` latest row has no store errors.
- Gmail: Settings → Gmail connection → Test → `ok`; Sync now → summary returned.
- Zoho: Settings → `env` connection → Test → `ok` with the org name; open Reconciliation and run any existing **dry-run** close (omnia-books-closing skill rules: no posting) and confirm it reads the same org.

- [ ] **Step 4: One real OAuth connect per provider (manual, founder present)**

- Zoho: Add connection → Zoho → own app (server-based client from api-console.zoho.com, redirect URI shown in the dialog) → pick orgs → both appear `active`.
- Gmail: own app → sign in as the payout mailbox → `active`; Test passes.
- Shopify: own app (Dev Dashboard) for one store **or** keep token mode — connect and confirm the Orders tab.

Record results (pass/fail + screenshots) in the PR description. Do not proceed to Task 18 until every line passes and the founder has signed off.

---

### Task 18: Release 2 — remove env fallbacks, drop `zoho_connections`, lock env reads

**Files:**
- Modify: `lib/settings/index.ts` (`ENV_FALLBACK = false`)
- Modify: `lib/integrations/shopify.ts` (`shopifyWebhookSecret` env line)
- Modify: `lib/integrations/zoho-context.ts:31` (`process.env.ZOHO_ORGANIZATION_ID` fallback)
- Create: `lib/env-allowlist.ts`
- Modify: ESLint config (find it: `ls -a | grep -i eslint`; the repo uses `eslint .`)
- Modify: `db/schema.sql` (drop table), `db/bootstrap.sql` (remove `zoho_connections`)
- Modify: `db/provision-client.mjs` (seed settings)
- Modify: `lib/connectors/importer.ts` (keep for future clients; `readLegacyZohoRows` already tolerates the dropped table)
- Test: `tests/settings/env-allowlist.test.ts`

**Interfaces:**
- Produces: `ENV_ALLOWLIST: readonly string[]`, `PENDING_CONNECTOR_ENV: readonly string[]`, `env(name: AllowedEnv): string | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/settings/env-allowlist.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { ENV_ALLOWLIST, PENDING_CONNECTOR_ENV } from "@/lib/env-allowlist";

test("process.env is read only for allowlisted names", () => {
  const out = execSync(`grep -rhoE "process\\.env\\.[A-Z0-9_]+" lib app components instrumentation.ts middleware.ts || true`, { encoding: "utf8" });
  const used = [...new Set(out.split("\n").filter(Boolean).map((s) => s.replace("process.env.", "")))];
  const allowed = new Set([...ENV_ALLOWLIST, ...PENDING_CONNECTOR_ENV]);
  assert.deepEqual(used.filter((n) => !allowed.has(n)).sort(), []);
});

test("settings no longer fall back to env", async () => {
  const { ENV_FALLBACK } = await import("@/lib/settings");
  assert.equal(ENV_FALLBACK, false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test tests/settings/env-allowlist.test.ts`
Expected: FAIL listing names such as `ZOHO_ORGANIZATION_ID`, `SHOPIFY_STORE_CODES`, `GMAIL_USER`.

- [ ] **Step 3: Implement**

```ts
// lib/env-allowlist.ts
/* The only environment variables application code may read. Everything
 * business-specific lives in Settings (workspace_settings / connections).
 * Enforced by tests/settings/env-allowlist.test.ts. */
export const ENV_ALLOWLIST = [
  "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
  "CONNECTIONS_KEY", "ZOHO_CREDENTIALS_KEY", "OMNIA_SESSION_SECRET", "ANTHROPIC_API_KEY", "DEFAULT_TENANT_ID",
  "NODE_ENV", "NEXT_RUNTIME",
  "PLATFORM_ZOHO_CLIENT_ID", "PLATFORM_ZOHO_CLIENT_SECRET", "PLATFORM_GOOGLE_CLIENT_ID", "PLATFORM_GOOGLE_CLIENT_SECRET",
  "PLATFORM_SHOPIFY_CLIENT_ID", "PLATFORM_SHOPIFY_CLIENT_SECRET", "PLATFORM_GMAIL_CLIENT_ID", "PLATFORM_GMAIL_CLIENT_SECRET",
  "NEXT_PUBLIC_META_PIXEL_ID", "NEXT_PUBLIC_TIKTOK_PIXEL_ID", "NEXT_PUBLIC_GTM_ID", "NEXT_PUBLIC_GOOGLE_ADS_ID", "NEXT_PUBLIC_GOOGLE_ADS_LEAD_LABEL",
  "NEXT_PUBLIC_WHATSAPP_NUMBER", "NEXT_PUBLIC_RAMZA_ORIGIN", "NEXT_PUBLIC_RAMZA_EMAIL", "NEXT_PUBLIC_CAL_LINK",
  "NEXT_PUBLIC_BRAND_PRODUCT", "NEXT_PUBLIC_BRAND_NAME", "NEXT_PUBLIC_BRAND_DESCRIPTION", "LEGAL_LINE",
  "HMAC_DEBUG", "CLOBBER_DEBUG", "RECON_TIMING", "RECON_SNAPSHOT_STALE_MS", "DEV_WEBHOOK_TOKEN",
] as const;

/** Still env-configured until their connector spec ships (P3 gateways, ads, couriers, team & roles). */
export const PENDING_CONNECTOR_ENV = [
  "TELR_STORE_ID", "TELR_AUTHENTICATION_KEY", "TELR_API_USERNAME", "TELR_API_PASSWORD", "STRIPE_SECRET_KEY",
  "WOO_URL", "WOO_CONSUMER_KEY", "WOO_CONSUMER_SECRET", "WOOCOMMERCE_WEBHOOK_SECRET",
  "META_MAIN_ACCESS_TOKEN", "META_KSA_ACCESS_TOKEN", "META_MAIN_AD_ACCOUNT_IDS", "META_KSA_AD_ACCOUNT_ID", "META_CAPI_ACCESS_TOKEN",
  "TIKTOK_ACCESS_TOKEN", "TIKTOK_ADVERTISER_ID", "SNAP_ACCESS_TOKEN", "SNAP_AD_ACCOUNT_ID",
  "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CUSTOMER_ID",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "SMSA_API_KEY",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_CFO_BOT_TOKEN", "SENDGRID_API_KEY", "ZOHO_WEBHOOK_SECRET", "PAYMENT_CONFIRM_WEBHOOK_SECRET",
  "OMNIA_PW_ADMIN", "OMNIA_PW_FINANCE", "OMNIA_PW_MARKETING", "OMNIA_PW_SHIPMENT", "OMNIA_PW_PACKAGING", "OMNIA_PW_SUPPLIER", "OMNIA_PW_SUPPORT",
  "ZOHO_BOOKS_BASE", "ZOHO_REFERENCE_TTL_MS", "ZOHO_WATERMARK_OVERLAP_MINUTES", "ZOHO_FULL_SYNC_MAX_AGE_HOURS",
] as const;
```

Note: `resolveApp` builds `PLATFORM_${provider}_CLIENT_ID` dynamically — `GMAIL` is the provider id, so Gmail's platform app is `PLATFORM_GMAIL_*` (listed). Drop the `PLATFORM_GOOGLE_*` names from the list if nothing reads them.

Then remove every remaining non-allowlisted read the test reports:
- `lib/settings/index.ts`: `export const ENV_FALLBACK = false;`
- `lib/integrations/shopify.ts`: delete the `SHOPIFY_${code}_WEBHOOK_SECRET` fallback line.
- `lib/integrations/zoho-context.ts:31`: `return als.getStore()?.orgId ?? "";` and make the no-scope path impossible: `withZohoOrg` is the only entry, and `getScopedAccessToken` defaults to `zoho.default_connection_id`. Callers that call Zoho without a scope: add a default-scope wrapper — in `zohoOrgId()` when there is no store, read `lastDefault?.orgId` exported from `zoho-org.ts` via a setter (`setDefaultZohoOrg(orgId)` in `zoho-context.ts`, called from `listZohoConnections`/`getZohoConnection` when they resolve the default). Implement:

```ts
// lib/integrations/zoho-context.ts
let defaultOrgId = "";
export function setDefaultZohoOrg(orgId: string) { defaultOrgId = orgId; }
export function zohoOrgId(): string {
  return als.getStore()?.orgId ?? defaultOrgId;
}
```

and call `setDefaultZohoOrg(z.orgId)` wherever `lastDefault` is assigned in `zoho-org.ts`; `runBootImport` already triggers a `listZohoConnections()` — add that call at the end of `runBootImport` so the default org id is warm before schedulers run.
- `lib/integrations/zoho.ts` configured check, `lib/integrations/gmail.ts` leftovers, `SHOPIFY_STORE_CODES` in importer (importer is exempt only via `lib/connectors/importer` — move its env reads behind its `env` parameter, which they already use, so no `process.env` literal remains there except in `runBootImport`; add `lib/connectors/importer.ts` to the grep exclusion in the test with a comment "importer reads legacy env by design").

ESLint rule — add to the config's rules:

```js
"no-restricted-properties": ["error", { object: "process", property: "env", message: "Read settings via getSetting()/peekSetting() or connections via @/lib/connectors. Only lib/env-allowlist.ts names are allowed — add an eslint-disable-next-line with a reason." }],
```

This rule flags every `process.env` access, so add `// eslint-disable-next-line no-restricted-properties -- allowlisted: <NAME>` above each remaining allowlisted read, or (simpler, preferred) route them through a helper:

```ts
// lib/env-allowlist.ts (append)
type AllowedEnv = (typeof ENV_ALLOWLIST)[number] | (typeof PENDING_CONNECTOR_ENV)[number];
// eslint-disable-next-line no-restricted-properties -- the one sanctioned reader
export const env = (name: AllowedEnv): string | undefined => process.env[name];
```

Migrating every allowlisted read to `env("NAME")` is mechanical but touches many files; do it only for files this plan already touched, and add per-line disables elsewhere. Record the count in the report.

Drop the legacy table — append to `db/schema.sql`:

```sql
-- Release 2 (settings & connections): zoho_connections rows live in connections.
drop table if exists zoho_connections;
```

and delete the `CREATE TABLE public.zoho_connections` block (plus its constraints/indexes) from `db/bootstrap.sql`. Also remove the original `create table if not exists zoho_connections` block from `db/schema.sql` so a fresh apply doesn't recreate then drop it.

`db/provision-client.mjs` — after applying SQL, seed settings from flags:

```js
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const publicUrl = arg("public-url");
const tenant = arg("tenant") || "omnia";
if (publicUrl) {
  await client.query(
    "insert into workspace_settings (tenant_id, key, value, updated_by) values ($1, 'app.public_url', to_jsonb($2::text), 'provision') on conflict (tenant_id, key) do update set value = excluded.value",
    [tenant, publicUrl],
  );
}
console.log(`Next: set SUPABASE_*, CONNECTIONS_KEY, OMNIA_SESSION_SECRET${tenant !== "omnia" ? `, DEFAULT_TENANT_ID=${tenant}` : ""}; then open ${publicUrl ?? "<app>"}/settings to connect Zoho, Gmail and Shopify.`);
```

(placed inside the existing `try` after the two `client.query(readFileSync…)` calls; replace the old "Next:" log line).

- [ ] **Step 4: Run everything**

Run: `npx tsx --test tests/settings/env-allowlist.test.ts && npm test && npm run lint && npx tsc --noEmit -p .`
Expected: allowlist tests PASS; full suite, lint and tsc clean (or only pre-existing issues, listed).

- [ ] **Step 5: Apply the drop and re-verify**

Run: `node db/apply-schema.mjs && npx tsx db/verify-connections.ts`
Expected: `✓ DB matches env …` is no longer meaningful for removed env names — the script still checks connection health; expect no `error`/`needs_reauth` lines. Restart the dev server and repeat Task 17 Step 3.

- [ ] **Step 6: Commit**

```bash
git add -A lib app components db tests middleware.ts instrumentation.ts .eslintrc* eslint.config.* 2>/dev/null
git commit -m "refactor(config): release 2 — env fallbacks removed, zoho_connections dropped, env allowlist enforced"
```

---

## Self-Review Notes (done while writing)

- **Spec coverage:** §4.1–4.4 → Task 1; §4.5 → Tasks 9 (stores), 12 (Zoho ids, `''`/`env`), 18 (drop); §5 → Tasks 4–5, 7–9; §5.2 → Tasks 12–15; §6 → Tasks 6, 10; §6.1 → Tasks 7–9; §7 → Task 16 (Zoho per-org usage and Gmail ingest list are served by the existing Accounting panels / Payouts page — trimmed and noted); §8 → Tasks 11, 17, 18; §9 → Task 18; §10 → Tasks 5 (reauth, parse errors), 6 (state/HMAC), 10 (409 on delete), 14 (scheduler skip); §11 → tests in every task; §12 risks → Task 12 (shared grant via `grant_id`), Task 14 (async callers), Task 17 (manual OAuth).
- **Fixed during review:** Zoho host regex in the spec accepts `accounts.zoho.com.evil.io` → strict allowlist (Task 6); spec route paths collide in Next.js → `/oauth/[provider]` (global deviation 1); `provision-client.mjs` never wrote env → seeds settings instead (deviation 2); importer "don't overwrite edits" simplified to insert-only; audit writes skipped for in-memory stores so tests stay offline.
- **Type names used across tasks:** `Connection`, `PublicConnection`, `ConnectorDef`, `SaveInput`, `ConnectionStore`, `ConnectionRow`, `OAuthFlowError(code)`, `ReauthRequiredError`, `GrantRevokedError`, `getAccessToken`, `listConnections(provider, { includeDisabled })`, `listShopifyStores`, `shopifyStore`, `shopifyWebhookSecret`, `shopifyStoreProblems`, `peekSetting`, `getSetting`, `setSetting`, `describeSettings`, `currentTenant`, `writeAudit` — checked consistent.
