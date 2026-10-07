import { currentTenant } from "@/lib/tenant";
import { SETTINGS, SETTINGS_BY_KEY, type SettingDef } from "./registry";
import { supabaseSettingsBackend, memorySettingsBackend, type SettingsBackend } from "./backend";

/* Workspace settings: database first, then (release 1 only) the .env variable
 * the setting replaces, then the registry default.
 *
 *   await getSetting("sync.order_interval_minutes")   // async, refreshes ≤30 s
 *   peekSetting("zoho.min_gap_ms")                     // sync, last snapshot
 */

export { memorySettingsBackend, type SettingsBackend };
export type SettingSource = "database" | "env" | "default";

/** Release 1: env vars still answer when the database has no value. */
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
  loading = null;
}

export async function loadSettings(force = false): Promise<void> {
  if (!force && snapshot && Date.now() - loadedAt < TTL_MS) return;
  if (loading && !force) return loading;
  const b = backend;
  const p = b.all(currentTenant()).then((all) => {
    if (b === backend) { snapshot = all; loadedAt = Date.now(); }
  });
  loading = p.finally(() => { if (loading === p) loading = null; });
  return p;
}

function def(key: string): SettingDef {
  const d = SETTINGS_BY_KEY.get(key);
  if (!d) throw new SettingError(`Unknown setting "${key}"`);
  return d;
}

function fromEnv(d: SettingDef): { ok: true; value: unknown } | { ok: false } {
  if (!ENV_FALLBACK || !d.legacyEnv) return { ok: false };
  const raw = process.env[d.legacyEnv];
  if (raw === undefined || raw === "") return { ok: false };
  try {
    const parsed = d.schema.safeParse(d.parseEnv ? d.parseEnv(raw) : raw);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
  } catch {
    return { ok: false }; // malformed env JSON falls through to the default
  }
}

function resolve(d: SettingDef): { value: unknown; source: SettingSource } {
  if (snapshot && d.key in snapshot) {
    const parsed = d.schema.safeParse(snapshot[d.key]);
    if (parsed.success) return { value: parsed.data, source: "database" };
    console.error(`[settings] stored ${d.key} is invalid, ignoring: ${parsed.error.issues[0]?.message}`);
  }
  const env = fromEnv(d);
  if (env.ok) return { value: env.value, source: "env" };
  return { value: d.default, source: "default" };
}

export async function getSetting<T = unknown>(key: string): Promise<T> {
  const d = def(key);
  await loadSettings();
  return resolve(d).value as T;
}

/** Synchronous read for hot paths and module-level values: uses the last
 *  loaded snapshot (warmed at boot), else env/default. */
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
