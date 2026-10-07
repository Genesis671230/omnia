import { supabase } from "@/lib/supabase";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { SETTINGS } from "@/lib/settings/registry";
import { describeSettings, loadSettings, setSetting } from "@/lib/settings";
import { listConnections, saveConnection, type SaveInput } from "./index";

/* One-way, insert-only copy of the configuration that still lives in .env and
 * the legacy zoho_connections table into `connections` + `workspace_settings`.
 *
 * Insert-only on purpose: a row that already exists — by id or by account —
 * is never touched, so anything edited or reconnected in Settings always
 * wins over .env. Ids are the ones existing data already stores: the env Zoho
 * org is "env", legacy Zoho rows keep theirs, Shopify stores are
 * shopify-<code>, mailboxes gmail-<local-part>. */

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
    if (/does not exist|schema cache/i.test(error.message)) return []; // dropped in release 2
    throw new Error(`zoho_connections read failed: ${error.message}`);
  }
  return (data ?? []) as LegacyZohoRow[];
}

export async function importFromEnv(env: NodeJS.ProcessEnv, legacyZohoRows: LegacyZohoRow[], opts: { dryRun?: boolean } = {}): Promise<ImportReport> {
  const report: ImportReport = { created: [], skipped: [], settings: [] };
  const existing = await listConnections(undefined, { includeDisabled: true });
  const taken = (provider: string, id: string, accountRef: string) =>
    existing.some((c) => c.id === id || (c.provider === provider && c.accountRef === accountRef)) ||
    report.created.includes(id);

  const add = async (input: SaveInput & { id: string }) => {
    if (taken(input.provider, input.id, input.accountRef)) return;
    if (!opts.dryRun) await saveConnection(input);
    report.created.push(input.id);
  };

  // ── Zoho ──────────────────────────────────────────────────────────────
  if (env.ZOHO_ORGANIZATION_ID && env.ZOHO_REFRESH_TOKEN && env.ZOHO_CLIENT_ID && env.ZOHO_CLIENT_SECRET) {
    const budget = parseInt(env.ZOHO_DAILY_BUDGET ?? "", 10);
    await add({
      id: "env", provider: "zoho", authMode: "own_app", grantType: "static_refresh", accountRef: env.ZOHO_ORGANIZATION_ID,
      label: env.ZOHO_ORGANIZATION_LABEL || "Main organisation",
      config: {
        accounts_url: env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com", api_domain: "https://www.zohoapis.com",
        org_name: env.ZOHO_ORGANIZATION_LABEL || "", daily_budget: Number.isFinite(budget) && budget > 0 ? budget : 7000,
      },
      secrets: { client_id: env.ZOHO_CLIENT_ID, client_secret: env.ZOHO_CLIENT_SECRET, refresh_token: env.ZOHO_REFRESH_TOKEN },
      connectedBy: "import:env",
    });
  } else {
    report.skipped.push("zoho main org (ZOHO_ORGANIZATION_ID / CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN incomplete)");
  }

  for (const r of legacyZohoRows) {
    try {
      await add({
        id: r.id, provider: "zoho", authMode: "own_app", grantType: "static_refresh", accountRef: r.org_id, label: r.label,
        config: {
          accounts_url: r.accounts_url, api_domain: r.api_domain, org_name: r.org_name, daily_budget: r.daily_budget,
          default_for_providers: r.default_for_providers ?? [], login_email: r.login_email ?? "",
        },
        secrets: { client_id: r.client_id, client_secret: decryptSecret(r.client_secret_enc), refresh_token: decryptSecret(r.refresh_token_enc) },
        scopes: r.scopes ?? "", status: r.status === "disabled" ? "disabled" : "active",
        connectedBy: `import:${r.created_by || "zoho_connections"}`,
      });
    } catch (e) {
      report.skipped.push(`zoho ${r.id} (${(e as Error).message})`);
    }
  }

  // ── Shopify: one token-mode connection per store code ─────────────────
  const codes = (env.SHOPIFY_STORE_CODES || "WA,UAE,KSA,MAIN").split(",").map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z0-9_]+$/.test(c));
  for (const code of codes) {
    const url = env[`SHOPIFY_${code}_URL`];
    const token = env[`SHOPIFY_${code}_TOKEN`];
    if (!url || !token) { report.skipped.push(`shopify ${code} (URL or TOKEN missing)`); continue; }
    let shop: string;
    try { shop = new URL(url).hostname.toLowerCase(); } catch { report.skipped.push(`shopify ${code} (URL "${url}" is not a URL)`); continue; }
    const webhook = env[`SHOPIFY_${code}_WEBHOOK_SECRET`];
    try {
      await add({
        id: `shopify-${code.toLowerCase()}`, provider: "shopify", authMode: "token", grantType: "static_token", accountRef: shop, label: code,
        config: { store_id: code, shop },
        secrets: { access_token: token, ...(webhook ? { webhook_secret: webhook } : {}) },
        connectedBy: "import:env",
      });
    } catch (e) {
      report.skipped.push(`shopify ${code} (${(e as Error).message})`);
    }
  }

  // ── Gmail: one own-app connection per mailbox ─────────────────────────
  const mailboxes = String(env.GMAIL_USER || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const mailbox of mailboxes) {
    const slug = mailboxSlug(mailbox);
    const refresh = env[`GMAIL_REFRESH_TOKEN_${slug.toUpperCase()}`] || env.GMAIL_REFRESH_TOKEN;
    if (!refresh || !env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET) { report.skipped.push(`gmail ${mailbox} (client or refresh token missing)`); continue; }
    await add({
      id: `gmail-${slug}`, provider: "gmail", authMode: "own_app", grantType: "authorization_code", accountRef: mailbox.toLowerCase(), label: mailbox.toLowerCase(),
      config: {}, secrets: { client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET, refresh_token: refresh },
      connectedBy: "import:env",
    });
  }

  // ── Settings: only keys the database does not have yet ────────────────
  await loadSettings(true);
  const inDb = new Set((await describeSettings()).filter((d) => d.source === "database").map((d) => d.key));
  for (const d of SETTINGS) {
    if (!d.legacyEnv || inDb.has(d.key)) continue;
    const raw = env[d.legacyEnv];
    if (raw === undefined || raw === "") continue;
    let value: unknown;
    try { value = d.parseEnv ? d.parseEnv(raw) : raw; } catch { report.skipped.push(`setting ${d.key} (${d.legacyEnv} is not valid)`); continue; }
    if (!d.schema.safeParse(value).success) { report.skipped.push(`setting ${d.key} (${d.legacyEnv} is not valid)`); continue; }
    if (!opts.dryRun) await setSetting(d.key, value, "import:env");
    report.settings.push(d.key);
  }
  return report;
}

/** Called once at server boot (instrumentation.ts). Never throws: a failed
 *  import must not stop the schedulers, which still have the release-1 env
 *  fallback. */
export async function runBootImport(): Promise<void> {
  try {
    const r = await importFromEnv(process.env, await readLegacyZohoRows());
    if (r.created.length || r.settings.length) {
      console.log(`[connections] imported ${r.created.length} connection(s) [${r.created.join(", ")}] and ${r.settings.length} setting(s)`);
    }
    if (r.skipped.length) console.log(`[connections] import skipped: ${r.skipped.join("; ")}`);
  } catch (e) {
    console.error(`[connections] boot import failed: ${(e as Error).message}`);
  }
  try {
    await loadSettings(true);
    const { purgeExpiredOAuthRows } = await import("./oauth");
    await purgeExpiredOAuthRows();
  } catch (e) {
    console.error(`[connections] boot housekeeping failed: ${(e as Error).message}`);
  }
}
