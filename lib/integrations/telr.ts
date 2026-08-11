// Telr Payouts API — https://docs.telr.com/reference. Basic Auth credential
// is "storeId:authenticationKey" (Telr calls these Store ID / Authentication
// Key in the merchant dashboard; docs.telr.com/reference/authentication
// calls the same pair Merchant ID / API key — same thing). The store ID also
// IS the {accountId} path parameter on every payouts endpoint.
// Only active when TELR_STORE_ID + TELR_AUTHENTICATION_KEY are set;
// otherwise the workspace relies on manually uploaded payout files.
// Response field names aren't documented publicly, so normalizeTelrPayout()
// probes the common variants defensively, same spirit as the generic CSV parser.
//
// KNOWN BLOCKED (2026-08-08): this /api/v1 surface returns 403 for this
// account — confirmed external account/access issue on Telr's side (API
// access not enabled and/or IP not allowlisted for this merchant), not a
// credentials or code bug. The separate /tools/api/xml transaction-lookup
// surface below (a different, older Telr API family) was probed the same
// day with all 3 plausible Basic-auth credential pairs (username:password,
// storeId:authKey, accountId:password) and got the identical signature: a
// blank-body 403 straight from Telr's origin (via Cloudflare, not a
// Cloudflare challenge page) — the same class of block, not a wrong-auth
// 401. Telr access needs to be granted before either surface works; the
// code below is ready to go the moment that happens, same as this file's
// existing payouts client.

const BASE = "https://secure.telr.com/api/v1";
const TOOLS_BASE = "https://secure.telr.com/tools/api/xml";

export function telrConfigured(): boolean {
  return Boolean(process.env.TELR_STORE_ID && process.env.TELR_AUTHENTICATION_KEY);
}

function authHeader(): string {
  const token = Buffer.from(`${process.env.TELR_STORE_ID}:${process.env.TELR_AUTHENTICATION_KEY}`).toString("base64");
  return `Basic ${token}`;
}

async function telrGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: authHeader(), Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telr API HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export async function getPendingAccount() {
  const accountId = process.env.TELR_STORE_ID;
  return telrGet(`/accounts/${accountId}/pendings`);
}

export async function getPayoutsByAccountIdAndDate(fromDate?: string, toDate?: string) {
  const accountId = process.env.TELR_STORE_ID;
  const qs = new URLSearchParams();
  if (fromDate) qs.set("from_date", fromDate);
  if (toDate) qs.set("to_date", toDate);
  const suffix = qs.toString() ? `?${qs}` : "";
  return telrGet(`/accounts/${accountId}/payouts${suffix}`);
}

export async function getTransactionsByPayout(payoutId: string, offset = 0, limit = 5000) {
  const accountId = process.env.TELR_STORE_ID;
  return telrGet(`/accounts/${accountId}/payouts/${payoutId}/transactions?offset=${offset}&limit=${limit}`);
}

// ── best-effort normalization: API → the same ParsedPayout shape the file
// parsers produce, so it flows through the existing upsert + reconciler. ──
export type TelrApiPayout = { id: string; net: number; orderRefs: string[]; date: string | null };

function asArray(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  if (v && typeof v === "object") {
    for (const key of ["data", "payouts", "items", "results"]) {
      const inner = (v as Record<string, unknown>)[key];
      if (Array.isArray(inner)) return inner as Record<string, unknown>[];
    }
  }
  return [];
}

const pick = (row: Record<string, unknown>, ...keys: string[]) =>
  keys.map((k) => row[k]).find((v) => v !== undefined && v !== null);

export function normalizeTelrPayouts(raw: unknown): TelrApiPayout[] {
  return asArray(raw).map((row) => ({
    id: String(pick(row, "id", "payout_id", "payoutId") ?? ""),
    net: parseFloat(String(pick(row, "net", "net_amount", "amount", "total") ?? "0")) || 0,
    orderRefs: [],
    date: (pick(row, "date", "payout_date", "created_at") as string) ?? null,
  }));
}

export function normalizeTelrTransactions(raw: unknown): string[] {
  const refs: string[] = [];
  for (const row of asArray(raw)) {
    const ref = pick(row, "cart_id", "cartid", "order_id", "orderId", "reference");
    if (ref) {
      const s = String(ref).split("_")[0];
      if (!refs.includes(s)) refs.push(s);
    }
  }
  return refs;
}

// ── Transaction "tools" API — https://docs.telr.com/reference, the older
// XML-based lookup surface (separate from the /api/v1 payouts JSON API
// above; different Basic-auth credential pair, TELR_API_USERNAME +
// TELR_API_PASSWORD, not TELR_STORE_ID/TELR_AUTHENTICATION_KEY). Used for
// per-order payment confirmation (lib/sync/telr-payment-confirm.ts) —
// looking a single order's already-captured reference up directly, rather
// than bulk-listing (the bulk "recent transactions" endpoint only covers
// the last 48h / 30 rows, too narrow for a useful confirmation window). ──

export function telrToolsConfigured(): boolean {
  return Boolean(process.env.TELR_API_USERNAME && process.env.TELR_API_PASSWORD);
}

function toolsAuthHeader(): string {
  const token = Buffer.from(`${process.env.TELR_API_USERNAME}:${process.env.TELR_API_PASSWORD}`).toString("base64");
  return `Basic ${token}`;
}

async function toolsGet(path: string): Promise<string> {
  const res = await fetch(`${TOOLS_BASE}${path}`, {
    headers: { Authorization: toolsAuthHeader() },
    cache: "no-store",
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Telr tools API HTTP ${res.status}: ${body.slice(0, 300)}`);
  return body;
}

export type TelrToolsTransaction = {
  id: string;
  amount: number;
  currency: string;
  cartId: string;
  authorised: boolean; // <auth><status> === "A"
  date: string; // GMT, Telr's own format
};

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// Lazily constructed — fast-xml-parser's constructor does real work, and
// most processes never call into the tools API (telrToolsConfigured() gates
// every caller), so there's no reason to pay for it at module load.
let xmlParser: import("fast-xml-parser").XMLParser | null = null;
async function parseTelrXml(xml: string): Promise<Record<string, any>> {
  if (!xmlParser) {
    const { XMLParser } = await import("fast-xml-parser");
    xmlParser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });
  }
  return xmlParser.parse(xml);
}

function parseTelrToolsTransaction(row: Record<string, unknown>): TelrToolsTransaction {
  const auth = (row.auth ?? {}) as Record<string, unknown>;
  return {
    id: String(row.id ?? ""),
    amount: parseFloat(String(row.amount ?? "0")) || 0,
    currency: String(row.currency ?? "").toUpperCase(),
    cartId: String(row.cartid ?? ""),
    authorised: String(auth.status ?? "").toUpperCase() === "A",
    date: String(row.date ?? ""),
  };
}

// Direct lookup by the reference already captured on the order at sync time
// (telr_tranref, from the store's Telr plugin order metadata — see
// telrRefsFromMeta above) — the authoritative match, no fuzzy parsing.
export async function getTelrTransactionByRef(tranref: string): Promise<TelrToolsTransaction | null> {
  const xml = await toolsGet(`/transaction/${encodeURIComponent(tranref)}`);
  const parsed = await parseTelrXml(xml);
  const row = parsed?.transaction as Record<string, unknown> | undefined;
  if (!row || !row.id) return null;
  return parseTelrToolsTransaction(row);
}

// Fallback for orders that only have a cart ID captured (no tranref) —
// returns every transaction event tied to that cart (sale, capture, refund,
// ...); caller picks the one it cares about (e.g. the authorised sale).
export async function getTelrTransactionsByCartId(cartId: string): Promise<TelrToolsTransaction[]> {
  const xml = await toolsGet(`/transaction/${encodeURIComponent(cartId)}/cart`);
  const parsed = await parseTelrXml(xml);
  const rows = toArray(parsed?.transactions?.transaction as Record<string, unknown> | Record<string, unknown>[] | undefined);
  return rows.map(parseTelrToolsTransaction);
}
