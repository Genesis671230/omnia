import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { setSettingsBackend, memorySettingsBackend, getSetting, describeSettings, setSetting } from "@/lib/settings";
import { memoryConnectionStore } from "@/lib/connectors/store";
import * as rt from "@/lib/connectors";
import { importFromEnv, type LegacyZohoRow } from "@/lib/connectors/importer";
import { encryptSecret } from "@/lib/crypto/secret-box";

process.env.CONNECTIONS_KEY = randomBytes(32).toString("base64");

const ENV = {
  SHOPIFY_STORE_CODES: "WA,UAE,KSA,MAIN",
  SHOPIFY_WA_URL: "https://whatsapp-omnia.myshopify.com/", SHOPIFY_WA_TOKEN: "shpat_wa-XYZ", SHOPIFY_WA_WEBHOOK_SECRET: "wh-wa-XYZ",
  SHOPIFY_UAE_URL: "https://stzcx3-ee.myshopify.com", SHOPIFY_UAE_TOKEN: "shpat_uae-XYZ",
  SHOPIFY_KSA_URL: "https://houseofomnia-dev.myshopify.com", SHOPIFY_KSA_TOKEN: "shpat_ksa-XYZ",
  SHOPIFY_MAIN_URL: "https://omnia-store-main.myshopify.com", SHOPIFY_MAIN_TOKEN: "shpat_main-XYZ",
  GMAIL_USER: "MarketingOmniaStore@gmail.com, ops@omnia.com", GMAIL_CLIENT_ID: "gcid", GMAIL_CLIENT_SECRET: "gsec-XYZ",
  GMAIL_REFRESH_TOKEN: "grt-XYZ", GMAIL_REFRESH_TOKEN_OPS: "grt-ops-XYZ",
  ZOHO_ORGANIZATION_ID: "721369942", ZOHO_ORGANIZATION_LABEL: "Omniastores LLC", ZOHO_CLIENT_ID: "zcid", ZOHO_CLIENT_SECRET: "zsec-XYZ", ZOHO_REFRESH_TOKEN: "zrt-XYZ",
  ZOHO_DAILY_BUDGET: "6000",
  ORDER_SYNC_INTERVAL_MINUTES: "2", ZOHO_CLEARING_ACCOUNTS: '{"Stripe":"9"}', WOO_ORDER_SYNC: "off",
} as NodeJS.ProcessEnv;

const legacy = (over: Partial<LegacyZohoRow> = {}): LegacyZohoRow[] => [{
  id: "house-of-omnia", label: "House of Omnia", org_id: "799179049", org_name: "House of Omnia", accounts_url: "https://accounts.zoho.com",
  api_domain: "https://www.zohoapis.com", client_id: "hcid", client_secret_enc: encryptSecret("hsec-XYZ"), refresh_token_enc: encryptSecret("hrt-XYZ"),
  login_email: "account@omniastores.com", daily_budget: 4500, status: "active", scopes: "ZohoBooks.invoices.ALL", default_for_providers: ["COD"], created_by: "settings",
  ...over,
}];

beforeEach(() => {
  setSettingsBackend(memorySettingsBackend());
  rt.setConnectionStore(memoryConnectionStore());
  rt.setAlertSink(async () => {});
});

test("imports every source with the ids existing data depends on", async () => {
  const r = await importFromEnv(ENV, legacy());
  const all = await rt.listConnections(undefined, { includeDisabled: true });
  assert.deepEqual(all.map((c) => c.id).sort(), ["env", "gmail-marketingomniastore", "gmail-ops", "house-of-omnia", "shopify-ksa", "shopify-main", "shopify-uae", "shopify-wa"]);
  assert.deepEqual([...r.created].sort(), all.map((c) => c.id).sort());
  assert.ok(all.every((c) => c.status === "active"), "imported rows are active");
});

test("Zoho: env org keeps id 'env' with its own budget; legacy rows keep id, secrets, routing, scopes", async () => {
  await importFromEnv(ENV, legacy());
  const env = (await rt.getConnection("env"))!;
  assert.equal(env.provider, "zoho");
  assert.equal(env.accountRef, "721369942");
  assert.equal(env.label, "Omniastores LLC");
  assert.equal(env.grantType, "static_refresh");
  assert.equal(env.secrets.refresh_token, "zrt-XYZ");
  assert.equal(env.secrets.client_secret, "zsec-XYZ");
  assert.equal((env.config as any).daily_budget, 6000);
  const hoo = (await rt.getConnection("house-of-omnia"))!;
  assert.equal(hoo.accountRef, "799179049");
  assert.equal(hoo.secrets.client_id, "hcid");
  assert.equal(hoo.secrets.client_secret, "hsec-XYZ");
  assert.equal(hoo.secrets.refresh_token, "hrt-XYZ");
  assert.deepEqual((hoo.config as any).default_for_providers, ["COD"]);
  assert.equal((hoo.config as any).login_email, "account@omniastores.com");
  assert.equal(hoo.scopes, "ZohoBooks.invoices.ALL");
  assert.notEqual(env.secrets.grant_id, hoo.secrets.grant_id, "different logins, different grants");
});

test("a disabled legacy Zoho org stays disabled", async () => {
  await importFromEnv(ENV, legacy({ status: "disabled" }));
  assert.equal((await rt.getConnection("house-of-omnia"))!.status, "disabled");
});

test("Shopify: token mode, domain from the URL, store code, webhook secret where set", async () => {
  await importFromEnv(ENV, []);
  const wa = (await rt.getConnection("shopify-wa"))!;
  assert.equal(wa.authMode, "token");
  assert.equal(wa.grantType, "static_token");
  assert.equal(wa.accountRef, "whatsapp-omnia.myshopify.com");
  assert.equal((wa.config as any).store_id, "WA");
  assert.equal((wa.config as any).shop, "whatsapp-omnia.myshopify.com");
  assert.equal(wa.secrets.access_token, "shpat_wa-XYZ");
  assert.equal(wa.secrets.webhook_secret, "wh-wa-XYZ");
  assert.equal((await rt.getConnection("shopify-uae"))!.secrets.webhook_secret, undefined);
  assert.equal(await rt.getAccessToken("shopify-main"), "shpat_main-XYZ");
});

test("Gmail: one own-app connection per mailbox, lower-cased, per-mailbox refresh token wins", async () => {
  await importFromEnv(ENV, []);
  const m = (await rt.getConnection("gmail-marketingomniastore"))!;
  assert.equal(m.accountRef, "marketingomniastore@gmail.com");
  assert.equal(m.secrets.refresh_token, "grt-XYZ");
  assert.equal(m.secrets.client_secret, "gsec-XYZ");
  assert.equal((await rt.getConnection("gmail-ops"))!.secrets.refresh_token, "grt-ops-XYZ");
});

test("settings: env values land in the DB with their parsed types", async () => {
  const r = await importFromEnv(ENV, []);
  assert.equal(await getSetting("sync.order_interval_minutes"), 2);
  assert.deepEqual(await getSetting("zoho.clearing_accounts"), { Stripe: "9" });
  assert.equal(await getSetting("orders.woo_sync"), false);
  assert.equal(await getSetting("zoho.daily_budget"), 6000);
  const src = Object.fromEntries((await describeSettings()).map((d) => [d.key, d.source]));
  for (const k of ["sync.order_interval_minutes", "zoho.clearing_accounts", "orders.woo_sync", "zoho.daily_budget"]) assert.equal(src[k], "database", k);
  assert.ok(r.settings.includes("sync.order_interval_minutes"));
});

test("idempotent: a second run creates nothing and never overwrites edits made in Settings", async () => {
  await importFromEnv(ENV, legacy());
  await rt.updateConnection("shopify-uae", { label: "UAE (edited)" }, "admin");
  await setSetting("sync.order_interval_minutes", 5, "admin");
  const second = await importFromEnv({ ...ENV, SHOPIFY_UAE_TOKEN: "shpat_changed-XYZ" }, legacy());
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.settings, []);
  const uae = (await rt.getConnection("shopify-uae"))!;
  assert.equal(uae.label, "UAE (edited)");
  assert.equal(uae.secrets.access_token, "shpat_uae-XYZ", "importer never updates an existing row");
  assert.equal(await getSetting("sync.order_interval_minutes"), 5);
});

test("an account already connected under another id is not imported twice", async () => {
  await rt.saveConnection({ id: "my-uae", provider: "shopify", authMode: "own_app", grantType: "authorization_code", accountRef: "stzcx3-ee.myshopify.com", label: "UAE via OAuth", config: { store_id: "UAE", shop: "stzcx3-ee.myshopify.com" }, secrets: { client_id: "c", client_secret: "s", access_token: "x" }, connectedBy: "admin" });
  const r = await importFromEnv(ENV, []);
  assert.ok(!r.created.includes("shopify-uae"));
  assert.equal((await rt.listConnections("shopify")).filter((c) => (c.config as any).store_id === "UAE").length, 1);
});

test("incomplete sources are skipped and reported, never half-imported", async () => {
  const r = await importFromEnv({ ...ENV, SHOPIFY_KSA_TOKEN: "", ZOHO_CLIENT_SECRET: "", GMAIL_CLIENT_SECRET: "" }, []);
  assert.equal(await rt.getConnection("shopify-ksa"), null);
  assert.equal(await rt.getConnection("env"), null);
  assert.equal(await rt.getConnection("gmail-ops"), null);
  assert.ok(r.skipped.some((s) => s.includes("KSA")));
  assert.ok(r.skipped.some((s) => s.includes("zoho")));
  assert.ok(r.skipped.some((s) => s.includes("gmail")));
});

test("malformed env values are reported and skipped, not imported", async () => {
  const r = await importFromEnv({ ...ENV, ZOHO_CLEARING_ACCOUNTS: "{broken", SHOPIFY_UAE_URL: "not a url" }, []);
  assert.ok(r.skipped.some((s) => s.includes("zoho.clearing_accounts")));
  assert.ok(r.skipped.some((s) => s.includes("UAE")));
  assert.equal(await rt.getConnection("shopify-uae"), null);
  assert.deepEqual(await getSetting("zoho.clearing_accounts"), {});
});

test("a store code with an invalid format in SHOPIFY_STORE_CODES is ignored", async () => {
  const r = await importFromEnv({ ...ENV, SHOPIFY_STORE_CODES: "WA, ua-e ,MAIN" }, []);
  assert.deepEqual((await rt.listConnections("shopify")).map((c) => (c.config as any).store_id).sort(), ["MAIN", "WA"]);
  void r;
});

test("dry run reports everything and writes nothing", async () => {
  const r = await importFromEnv(ENV, legacy(), { dryRun: true });
  assert.equal(r.created.length, 8);
  assert.ok(r.settings.length >= 4);
  assert.equal((await rt.listConnections(undefined, { includeDisabled: true })).length, 0);
  assert.equal((await describeSettings()).filter((d) => d.source === "database").length, 0);
});
