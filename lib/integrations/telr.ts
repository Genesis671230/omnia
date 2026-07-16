// Telr Payouts API — https://docs.telr.com/reference. Basic Auth credential
// is "storeId:authenticationKey" (Telr calls these Store ID / Authentication
// Key in the merchant dashboard; docs.telr.com/reference/authentication
// calls the same pair Merchant ID / API key — same thing). The store ID also
// IS the {accountId} path parameter on every payouts endpoint.
// Only active when TELR_STORE_ID + TELR_AUTHENTICATION_KEY are set;
// otherwise the workspace relies on manually uploaded payout files.
// Response field names aren't documented publicly, so normalizeTelrPayout()
// probes the common variants defensively, same spirit as the generic CSV parser.

const BASE = "https://secure.telr.com/api/v1";

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
