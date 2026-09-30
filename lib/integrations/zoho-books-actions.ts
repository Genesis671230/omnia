/* Generic Zoho Books actions — the equivalent of Nango's Zoho Books templates
 * (list / get / create / update / delete per entity, plus invoice void,
 * mark-sent and email, plus incremental syncs), driven by one registry
 * instead of ~85 files.
 *
 * Everything runs in the Zoho organisation in scope (withZohoOrg /
 * zohoOrgScoped), uses that org's token, data centre and daily quota, and
 * goes through the shared throttle. Writes are recorded in zoho_action_log.
 *
 * This is the raw layer. The reconciliation booking flow (payments + fee
 * expense + FX journal, idempotent by reference) stays in its own modules —
 * it encodes accounting rules this layer deliberately does not. */

import { supabase } from "@/lib/supabase";
import { getScopedAccessToken } from "./zoho-org";
import { ZohoQuotaExceededError, zohoThrottledFetch } from "./zoho-throttle";
import { toZohoTimestamp } from "./zoho";
import { zohoBooksBase, zohoConnectionId, zohoOrgId } from "./zoho-context";

export type EntityDef = {
  /** Books API path under /books/v3. */
  path: string;
  /** Key of the array in a list response. */
  listKey: string;
  /** Key of the object in a get / create / update response. */
  itemKey: string;
  idField: string;
  label: string;
  write: boolean;
  del: boolean;
  /** Honours last_modified_time — can sync incrementally. */
  incremental: boolean;
  /** OAuth scope family the token needs (ZohoBooks.<scope>.*). */
  scope: string;
};

export const ENTITIES = {
  invoices:        { path: "/invoices",        listKey: "invoices",        itemKey: "invoice",          idField: "invoice_id",       label: "Invoices",          write: true,  del: true,  incremental: true, scope: "invoices" },
  contacts:        { path: "/contacts",        listKey: "contacts",        itemKey: "contact",          idField: "contact_id",       label: "Contacts",          write: true,  del: true,  incremental: true, scope: "contacts" },
  bills:           { path: "/bills",           listKey: "bills",           itemKey: "bill",             idField: "bill_id",          label: "Bills",             write: true,  del: true,  incremental: true, scope: "bills" },
  expenses:        { path: "/expenses",        listKey: "expenses",        itemKey: "expense",          idField: "expense_id",       label: "Expenses",          write: true,  del: true,  incremental: true, scope: "expenses" },
  journals:        { path: "/journals",        listKey: "journals",        itemKey: "journal",          idField: "journal_id",       label: "Manual journals",   write: true,  del: true,  incremental: true, scope: "accountants" },
  payments:        { path: "/customerpayments", listKey: "customerpayments", itemKey: "payment",        idField: "payment_id",       label: "Customer payments", write: true,  del: true,  incremental: true, scope: "customerpayments" },
  vendorpayments:  { path: "/vendorpayments",  listKey: "vendorpayments",  itemKey: "vendorpayment",    idField: "payment_id",       label: "Vendor payments",   write: true,  del: true,  incremental: true, scope: "vendorpayments" },
  creditnotes:     { path: "/creditnotes",     listKey: "creditnotes",     itemKey: "creditnote",       idField: "creditnote_id",    label: "Credit notes",      write: true,  del: true,  incremental: true, scope: "creditnotes" },
  items:           { path: "/items",           listKey: "items",           itemKey: "item",             idField: "item_id",          label: "Items",             write: true,  del: true,  incremental: true, scope: "settings" },
  estimates:       { path: "/estimates",       listKey: "estimates",       itemKey: "estimate",         idField: "estimate_id",      label: "Estimates",         write: true,  del: true,  incremental: true, scope: "estimates" },
  purchaseorders:  { path: "/purchaseorders",  listKey: "purchaseorders",  itemKey: "purchaseorder",    idField: "purchaseorder_id", label: "Purchase orders",   write: true,  del: true,  incremental: true, scope: "purchaseorders" },
  chartofaccounts: { path: "/chartofaccounts", listKey: "chartofaccounts", itemKey: "chart_of_account", idField: "account_id",       label: "Chart of accounts", write: true,  del: true,  incremental: false, scope: "accountants" },
  bankaccounts:    { path: "/bankaccounts",    listKey: "bankaccounts",    itemKey: "bankaccount",      idField: "account_id",       label: "Bank accounts",     write: true,  del: true,  incremental: false, scope: "banking" },
  taxes:           { path: "/settings/taxes",  listKey: "taxes",           itemKey: "tax",              idField: "tax_id",           label: "Taxes",             write: false, del: false, incremental: false, scope: "settings" },
  currencies:      { path: "/settings/currencies", listKey: "currencies",  itemKey: "currency",         idField: "currency_id",      label: "Currencies",        write: false, del: false, incremental: false, scope: "settings" },
} satisfies Record<string, EntityDef>;

export type EntityName = keyof typeof ENTITIES;

/** Status actions Zoho exposes per entity. */
export const RECORD_ACTIONS = {
  invoices: {
    void:      { method: "POST", suffix: "/status/void",  label: "Void" },
    mark_sent: { method: "POST", suffix: "/status/sent",  label: "Mark as sent" },
    email:     { method: "POST", suffix: "/email",        label: "Email to customer" },
  },
} as const satisfies Partial<Record<EntityName, Record<string, { method: string; suffix: string; label: string }>>>;

/** Is `entity` reachable with this space-separated scope list? Unknown ('') = assume yes. */
export function scopeAllows(scopes: string, entity: EntityName): boolean {
  if (!scopes.trim()) return true;
  const fam = ENTITIES[entity].scope.toLowerCase();
  return scopes.toLowerCase().split(/[\s,]+/).some((sc) => sc === "zohobooks.fullaccess.all" || sc.startsWith(`zohobooks.${fam}.`));
}

export function entityDef(name: string): EntityDef | null {
  return (ENTITIES as Record<string, EntityDef>)[name] ?? null;
}

export class ZohoActionError extends Error {
  constructor(message: string, readonly status: number, readonly zohoCode?: number) {
    super(message);
    this.name = "ZohoActionError";
  }
}

async function call(method: string, path: string, query: Record<string, string> = {}, body?: unknown, scope?: string) {
  const qs = new URLSearchParams({ organization_id: zohoOrgId(), ...query });
  const res = await zohoThrottledFetch(`${zohoBooksBase()}${path}?${qs}`, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${await getScopedAccessToken()}`,
      "X-com-zoho-books-organizationid": zohoOrgId(),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (typeof json.code === "number" && json.code !== 0)) {
    // 57 = the token lacks the scope. Say which, and how to fix it.
    if (json.code === 57 && scope) {
      throw new ZohoActionError(
        `This Zoho connection was not granted the ZohoBooks.${scope} scope. Regenerate its refresh token with ZohoBooks.fullaccess.all (Settings → Zoho organisations).`,
        403, 57,
      );
    }
    throw new ZohoActionError(json.message || `Zoho HTTP ${res.status}`, res.ok ? 422 : res.status, json.code);
  }
  return json as Record<string, unknown>;
}

async function audit(actor: string, entity: string, action: string, recordId: string, request: unknown, outcome: { ok: boolean; status?: number; code?: number; message: string }) {
  const { error } = await supabase.from("zoho_action_log").insert({
    actor, connection_id: zohoConnectionId(), org_id: zohoOrgId(), entity, action, record_id: recordId,
    request: request ?? null, ok: outcome.ok, http_status: outcome.status ?? null, zoho_code: outcome.code ?? null, message: outcome.message.slice(0, 500),
  });
  if (error) console.error("[zoho-actions] audit write failed:", error.message);
}

/** Error → JSON response, for the /api/zoho/books routes. */
export function zohoError(e: unknown): Response {
  if (e instanceof ZohoQuotaExceededError) return Response.json({ error: e.message }, { status: 429 });
  if (e instanceof ZohoActionError) return Response.json({ error: e.message, zohoCode: e.zohoCode }, { status: e.status >= 400 ? e.status : 422 });
  return Response.json({ error: (e as Error).message }, { status: 500 });
}

/* ── reads ─────────────────────────────────────────────────────────────── */

export type ListOptions = { page?: number; perPage?: number; search?: string; filters?: Record<string, string> };

export async function listRecords(name: EntityName, opts: ListOptions = {}) {
  const def = ENTITIES[name];
  const q: Record<string, string> = { page: String(opts.page ?? 1), per_page: String(Math.min(Math.max(opts.perPage ?? 50, 1), 200)) };
  if (opts.search) q.search_text = opts.search;
  for (const [k, v] of Object.entries(opts.filters ?? {})) if (/^[a-z_]+$/.test(k) && v) q[k] = v;
  const json = await call("GET", def.path, q, undefined, def.scope);
  const page = json.page_context as { page?: number; has_more_page?: boolean } | undefined;
  return { records: (json[def.listKey] ?? []) as Record<string, unknown>[], page: page?.page ?? opts.page ?? 1, hasMore: Boolean(page?.has_more_page) };
}

export async function getRecord(name: EntityName, id: string) {
  const def = ENTITIES[name];
  const json = await call("GET", `${def.path}/${encodeURIComponent(id)}`, {}, undefined, def.scope);
  return json[def.itemKey] as Record<string, unknown>;
}

/* ── writes (audited) ──────────────────────────────────────────────────── */

async function audited<T>(actor: string, name: string, action: string, id: string, request: unknown, fn: () => Promise<T>): Promise<T> {
  try {
    const out = await fn();
    await audit(actor, name, action, id, request, { ok: true, status: 200, message: "ok" });
    return out;
  } catch (e) {
    const err = e as ZohoActionError;
    await audit(actor, name, action, id, request, { ok: false, status: err.status, code: err.zohoCode, message: err.message });
    throw e;
  }
}

export async function createRecord(name: EntityName, body: Record<string, unknown>, actor: string) {
  const def = ENTITIES[name];
  if (!def.write) throw new ZohoActionError(`${def.label} are read-only here`, 405);
  return audited(actor, name, "create", "", body, async () => {
    const json = await call("POST", def.path, {}, body, def.scope);
    return json[def.itemKey] as Record<string, unknown>;
  });
}

export async function updateRecord(name: EntityName, id: string, body: Record<string, unknown>, actor: string) {
  const def = ENTITIES[name];
  if (!def.write) throw new ZohoActionError(`${def.label} are read-only here`, 405);
  return audited(actor, name, "update", id, body, async () => {
    const json = await call("PUT", `${def.path}/${encodeURIComponent(id)}`, {}, body, def.scope);
    return json[def.itemKey] as Record<string, unknown>;
  });
}

export async function deleteRecord(name: EntityName, id: string, actor: string) {
  const def = ENTITIES[name];
  if (!def.del) throw new ZohoActionError(`${def.label} can't be deleted here`, 405);
  return audited(actor, name, "delete", id, null, async () => {
    const json = await call("DELETE", `${def.path}/${encodeURIComponent(id)}`, {}, undefined, def.scope);
    return { message: String(json.message ?? "Deleted") };
  });
}

export async function runRecordAction(name: EntityName, id: string, action: string, body: Record<string, unknown> | undefined, actor: string) {
  const def = ENTITIES[name];
  const spec = (RECORD_ACTIONS as Record<string, Record<string, { method: string; suffix: string }>>)[name]?.[action];
  if (!spec) throw new ZohoActionError(`No "${action}" action for ${def.label}`, 404);
  return audited(actor, name, action, id, body ?? null, async () => {
    const json = await call(spec.method, `${def.path}/${encodeURIComponent(id)}${spec.suffix}`, {}, body, def.scope);
    return { message: String(json.message ?? "Done") };
  });
}

/* ── syncs (incremental, opt-in) ───────────────────────────────────────── */

const MAX_PAGES_PER_RUN = 25; // ≤ 25 requests per run: a sync can never drain the day's budget

/** Pull records modified since the last cursor into zoho_records. Bounded per
 *  run; run again to continue. Returns how many rows were written. */
export async function syncEntity(name: EntityName): Promise<{ written: number; done: boolean; cursor: string | null }> {
  const def = ENTITIES[name];
  const conn = zohoConnectionId();
  const { data: cur } = await supabase.from("zoho_sync_cursors").select("cursor").eq("connection_id", conn).eq("entity", name).maybeSingle();
  const since = def.incremental ? ((cur?.cursor as string | null) ?? null) : null;
  let written = 0, maxModified: string | null = since, done = false;
  try {
    for (let page = 1; page <= MAX_PAGES_PER_RUN; page++) {
      const q: Record<string, string> = { page: String(page), per_page: "200", sort_column: "last_modified_time", sort_order: "A" };
      if (since) q.last_modified_time = toZohoTimestamp(since);
      const json = await call("GET", def.path, q, undefined, def.scope);
      const rows = (json[def.listKey] ?? []) as Record<string, unknown>[];
      if (rows.length) {
        const up = rows.map((r) => {
          const mod = (r.last_modified_time as string | undefined) ?? null;
          if (mod && (!maxModified || Date.parse(mod) > Date.parse(maxModified))) maxModified = new Date(Date.parse(mod)).toISOString();
          return { connection_id: conn, entity: name, record_id: String(r[def.idField]), data: r, modified_at: mod ? new Date(Date.parse(mod)).toISOString() : null, synced_at: new Date().toISOString() };
        });
        const { error } = await supabase.from("zoho_records").upsert(up, { onConflict: "connection_id,entity,record_id" });
        if (error) throw new Error(`zoho_records upsert: ${error.message}`);
        written += up.length;
      }
      if (!(json.page_context as { has_more_page?: boolean } | undefined)?.has_more_page) { done = true; break; }
    }
    await supabase.from("zoho_sync_cursors").upsert({ connection_id: conn, entity: name, cursor: maxModified, last_run_at: new Date().toISOString(), last_count: written, last_error: "" }, { onConflict: "connection_id,entity" });
    return { written, done, cursor: maxModified };
  } catch (e) {
    await supabase.from("zoho_sync_cursors").upsert({ connection_id: conn, entity: name, cursor: since, last_run_at: new Date().toISOString(), last_count: written, last_error: (e as Error).message.slice(0, 500) }, { onConflict: "connection_id,entity" });
    throw e;
  }
}
