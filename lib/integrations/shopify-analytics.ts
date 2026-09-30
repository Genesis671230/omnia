// A Shopify store's own session funnel — every visit, not just ad clicks:
// sessions → added to cart → reached checkout → completed checkout, per day
// and by where the visit came from. Read with ShopifyQL (Admin GraphQL
// `shopifyqlQuery`, API 2025-10+), which needs the token's `read_reports`
// scope; a store without it reports "missing_scope" instead of zeros, so the
// page can say exactly what to grant.

import { getShopifyStores } from "./shopify";

const API_VERSION = process.env.SHOPIFY_ANALYTICS_API_VERSION || "2025-10";
const CACHE_MS = 10 * 60 * 1000;

export type FunnelTotals = { sessions: number; addedToCart: number; reachedCheckout: number; completed: number };
export type StoreFunnel =
  | {
      status: "ok";
      totals: FunnelTotals;
      daily: ({ day: string } & FunnelTotals)[];
      sources: { source: string; sessions: number; completed: number }[];
    }
  | { status: "missing_scope" | "no_credentials" | "error"; message: string };

type Table = { columns: { name: string }[]; rows: Record<string, string>[] };

class ShopifyQlError extends Error {
  constructor(message: string, readonly scope: boolean) {
    super(message);
  }
}

async function shopifyql(url: string, token: string, query: string): Promise<Table> {
  const res = await fetch(`${url}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "query($q:String!){ shopifyqlQuery(query:$q){ tableData { columns { name } rows } parseErrors } }",
      variables: { q: query },
    }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as {
    data?: { shopifyqlQuery?: { tableData: Table | null; parseErrors: string[] } };
    errors?: { message: string; extensions?: { code?: string } }[];
  } | null;
  if (!json) throw new ShopifyQlError(`Shopify HTTP ${res.status}`, false);
  const denied = json.errors?.find((e) => e.extensions?.code === "ACCESS_DENIED");
  if (denied) throw new ShopifyQlError(denied.message, true);
  if (json.errors?.length) throw new ShopifyQlError(json.errors[0].message, false);
  const out = json.data?.shopifyqlQuery;
  if (out?.parseErrors?.length) throw new ShopifyQlError(`ShopifyQL: ${out.parseErrors.join("; ")}`, false);
  return out?.tableData ?? { columns: [], rows: [] };
}

const n = (v: string | undefined) => Number(v ?? 0) || 0;
const totalsOf = (r: Record<string, string>): FunnelTotals => ({
  sessions: n(r.sessions),
  addedToCart: n(r.sessions_with_cart_additions),
  reachedCheckout: n(r.sessions_that_reached_checkout),
  completed: n(r.sessions_that_completed_checkout),
});

const cache = new Map<string, { at: number; value: StoreFunnel }>();

/** fromDay / toDay are inclusive store-local days (YYYY-MM-DD). */
export async function fetchStoreFunnel(code: string, fromDay: string, toDay: string): Promise<StoreFunnel> {
  const store = getShopifyStores().find((s) => s.code === code);
  if (!store) return { status: "no_credentials", message: `No SHOPIFY_${code}_URL / SHOPIFY_${code}_TOKEN configured.` };

  const key = `${code}|${fromDay}|${toDay}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const url = store.url.startsWith("http") ? store.url : `https://${store.url}`;
  const range = `SINCE ${fromDay} UNTIL ${toDay}`;
  const metrics = "sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout";
  let value: StoreFunnel;
  try {
    const [total, daily, sources] = await Promise.all([
      shopifyql(url, store.token, `FROM sessions SHOW ${metrics} ${range}`),
      shopifyql(url, store.token, `FROM sessions SHOW ${metrics} GROUP BY day ${range}`),
      shopifyql(url, store.token, `FROM sessions SHOW sessions, sessions_that_completed_checkout GROUP BY referrer_source ${range} ORDER BY sessions DESC LIMIT 8`),
    ]);
    value = {
      status: "ok",
      totals: total.rows[0] ? totalsOf(total.rows[0]) : { sessions: 0, addedToCart: 0, reachedCheckout: 0, completed: 0 },
      daily: daily.rows.map((r) => ({ day: String(r.day).slice(0, 10), ...totalsOf(r) })),
      sources: sources.rows.map((r) => ({ source: r.referrer_source || "unknown", sessions: n(r.sessions), completed: n(r.sessions_that_completed_checkout) })),
    };
  } catch (e) {
    value = e instanceof ShopifyQlError && e.scope
      ? { status: "missing_scope", message: "This store's Shopify token lacks the read_reports scope. Add it in the store's custom app (Admin API scopes → read_reports) and reinstall to get a new token." }
      : { status: "error", message: (e as Error).message };
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

export type LeakDetail =
  | {
      status: "ok";
      landingPages: { path: string; type: string; sessions: number; addedToCart: number; reachedCheckout: number; completed: number }[];
      devices: { device: string; sessions: number; addedToCart: number; completed: number }[];
    }
  | { status: "missing_scope" | "no_credentials" | "error"; message: string };

const leakCache = new Map<string, { at: number; value: LeakDetail }>();

/**
 * Where inside the site visitors leave: the funnel by landing page (product
 * pages are what the leak table ranks) and by device. Same read_reports
 * scope and cache as fetchStoreFunnel.
 */
export async function fetchStoreLeakDetail(code: string, fromDay: string, toDay: string): Promise<LeakDetail> {
  const store = getShopifyStores().find((s) => s.code === code);
  if (!store) return { status: "no_credentials", message: `No SHOPIFY_${code}_URL / SHOPIFY_${code}_TOKEN configured.` };
  const key = `${code}|${fromDay}|${toDay}`;
  const hit = leakCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const url = store.url.startsWith("http") ? store.url : `https://${store.url}`;
  const range = `SINCE ${fromDay} UNTIL ${toDay}`;
  const metrics = "sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout";
  let value: LeakDetail;
  try {
    const [pages, devices] = await Promise.all([
      shopifyql(url, store.token, `FROM sessions SHOW ${metrics} GROUP BY landing_page_path, landing_page_type ${range} ORDER BY sessions DESC LIMIT 250`),
      shopifyql(url, store.token, `FROM sessions SHOW ${metrics} GROUP BY session_device_type ${range} ORDER BY sessions DESC`),
    ]);
    value = {
      status: "ok",
      landingPages: pages.rows.map((r) => ({ path: r.landing_page_path || "/", type: r.landing_page_type || "", ...totalsOf(r) })),
      devices: devices.rows.map((r) => ({ device: r.session_device_type || "unknown", sessions: n(r.sessions), addedToCart: n(r.sessions_with_cart_additions), completed: n(r.sessions_that_completed_checkout) })),
    };
  } catch (e) {
    value = e instanceof ShopifyQlError && e.scope
      ? { status: "missing_scope", message: "This store's Shopify token lacks the read_reports scope. Add it in the store's custom app (Admin API scopes → read_reports) and reinstall to get a new token." }
      : { status: "error", message: (e as Error).message };
  }
  leakCache.set(key, { at: Date.now(), value });
  return value;
}
