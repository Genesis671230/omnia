import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getSetting, peekSetting, setSetting, describeSettings, loadSettings,
  setSettingsBackend, memorySettingsBackend, SettingError,
} from "@/lib/settings";
import { SETTINGS } from "@/lib/settings/registry";

const ENV_KEYS = ["ORDER_SYNC_INTERVAL_MINUTES", "ZOHO_CLEARING_ACCOUNTS", "ORDERS_WA_COUNT_COD_AS_PAID", "WOO_ORDER_SYNC"];

beforeEach(async () => {
  for (const k of ENV_KEYS) delete process.env[k];
  setSettingsBackend(memorySettingsBackend());
  await loadSettings(true);
});

test("default when neither DB nor env has a value", async () => {
  assert.equal(await getSetting("sync.order_interval_minutes"), null);
  assert.equal(await getSetting("profile.base_currency"), "AED");
  assert.equal(await getSetting("shopify.api_version"), "2024-04");
});

test("env fallback is parsed with the registry's parser", async () => {
  process.env.ORDER_SYNC_INTERVAL_MINUTES = "7";
  process.env.ZOHO_CLEARING_ACCOUNTS = '{"Stripe":"9"}';
  process.env.ORDERS_WA_COUNT_COD_AS_PAID = "TRUE";
  process.env.WOO_ORDER_SYNC = "off";
  await loadSettings(true);
  assert.equal(await getSetting("sync.order_interval_minutes"), 7);
  assert.deepEqual(await getSetting("zoho.clearing_accounts"), { Stripe: "9" });
  assert.equal(await getSetting("orders.wa_count_cod_as_paid"), true);
  assert.equal(await getSetting("orders.woo_sync"), false);
  const d = (await describeSettings()).find((s) => s.key === "sync.order_interval_minutes")!;
  assert.equal(d.source, "env");
  assert.equal(d.legacyEnv, "ORDER_SYNC_INTERVAL_MINUTES");
});

test("malformed env falls back to the default instead of throwing", async () => {
  process.env.ZOHO_CLEARING_ACCOUNTS = "{not json";
  process.env.ORDER_SYNC_INTERVAL_MINUTES = "soon";
  await loadSettings(true);
  assert.deepEqual(await getSetting("zoho.clearing_accounts"), {});
  assert.equal(await getSetting("sync.order_interval_minutes"), null);
});

test("database beats env, and peekSetting sees the write immediately", async () => {
  process.env.ORDER_SYNC_INTERVAL_MINUTES = "7";
  await setSetting("sync.order_interval_minutes", 3, "test");
  assert.equal(await getSetting("sync.order_interval_minutes"), 3);
  assert.equal(peekSetting("sync.order_interval_minutes"), 3);
  const d = (await describeSettings()).find((s) => s.key === "sync.order_interval_minutes")!;
  assert.equal(d.source, "database");
});

test("a nullable setting can be cleared back to the scheduler default", async () => {
  await setSetting("sync.order_interval_minutes", 3, "test");
  await setSetting("sync.order_interval_minutes", null, "test");
  assert.equal(await getSetting("sync.order_interval_minutes"), null);
});

test("unknown key and invalid values are rejected", async () => {
  await assert.rejects(setSetting("nope.key", 1, "t"), SettingError);
  await assert.rejects(setSetting("sync.order_interval_minutes", -5, "t"), SettingError);
  await assert.rejects(setSetting("profile.base_currency", "dirhams", "t"), SettingError);
  await assert.rejects(setSetting("profile.trn", "12345", "t"), SettingError);
  await assert.rejects(setSetting("profile.industries", [], "t"), SettingError);
  await assert.rejects(getSetting("nope.key"), SettingError);
});

test("a bad value stored in the DB is ignored, not served", async () => {
  const backend = memorySettingsBackend();
  await backend.set("omnia", "profile.base_currency", "dirhams", "someone");
  setSettingsBackend(backend);
  await loadSettings(true);
  assert.equal(await getSetting("profile.base_currency"), "AED");
});

test("peekSetting works before any load (env/default only)", () => {
  setSettingsBackend(memorySettingsBackend()); // clears the snapshot
  assert.equal(peekSetting("profile.timezone"), "Asia/Dubai");
});

test("registry: unique keys, every default passes its own schema", () => {
  const keys = SETTINGS.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const s of SETTINGS) assert.ok(s.schema.safeParse(s.default).success, `default of ${s.key} fails its schema`);
});
