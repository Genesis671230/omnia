// Warehouse-aware Zoho fetchers. Extends lib/integrations/zoho.ts — reuses
// its getAccessToken() and API_BASE conventions, doesn't re-implement OAuth.
// Kept in a separate file because the detail-endpoint path is the ONLY way
// to get per-warehouse stock (probe confirmed bulk /items and even
// ?show_stock_by_warehouse=true both return aggregate only), and its N+1
// nature has a very different rate-limit/timing profile from anything else
// in the file — worth isolating so it doesn't get called by accident.

import { getAccessToken } from "@/lib/integrations/zoho";

const API_BASE = "https://www.zohoapis.com/inventory/v1";

/* ── warehouse list (/settings/warehouses) ─────────────────────────────── */

export type ZohoWarehouse = {
  warehouse_id: string;
  warehouse_name: string;
  status: string;
  is_primary: boolean;
  is_org_level_primary: boolean;
  is_fba_warehouse: boolean;
  address: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  state_code: string;
  country: string;
  country_code: string;
  zip: string;
  phone: string;
  email: string;
  attention: string;
};

export async function fetchZohoWarehouses(accessToken?: string): Promise<ZohoWarehouse[]> {
  const token = accessToken ?? (await getAccessToken());
  const orgId = process.env.ZOHO_ORGANIZATION_ID!;
  const res = await fetch(`${API_BASE}/settings/warehouses?organization_id=${orgId}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Zoho warehouses HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`Zoho warehouses error ${json.code}: ${json.message}`);
  return (json.warehouses ?? []) as ZohoWarehouse[];
}

/* ── item detail (/items/{item_id}) — the ONLY per-warehouse source ────── */

export type ZohoItemWarehouseEntry = {
  warehouse_id: string;
  warehouse_name: string;
  status: string;
  is_primary: boolean;
  is_item_mapped: boolean;
  warehouse_stock_on_hand: number;
  warehouse_available_stock: number;
  warehouse_available_for_sale_stock: number;
  warehouse_committed_stock: number;
  warehouse_actual_available_stock: number;
  warehouse_actual_committed_stock: number;
  warehouse_actual_available_for_sale_stock: number;
  warehouse_quantity_in_transit: number;
  is_fba_warehouse: boolean;
};

export type ZohoItemDetail = {
  item_id: string;
  sku: string;
  name: string;
  status: string;
  last_modified_time: string;
  stock_on_hand: number;
  available_stock: number;
  warehouses: ZohoItemWarehouseEntry[];
};

// One item's detail. Callers must pass an accessToken they've already
// fetched — do NOT refresh the token per call, or you'll burn 11K OAuth
// calls on a backfill. Retries on Zoho's documented 429 (rate limit) up to
// 4 times with exponential backoff — a real backfill WILL trip this.
export async function fetchZohoItemDetail(itemId: string, accessToken: string): Promise<ZohoItemDetail> {
  const orgId = process.env.ZOHO_ORGANIZATION_ID!;
  const url = `${API_BASE}/items/${itemId}?organization_id=${orgId}`;

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      cache: "no-store",
    });

    if (res.status === 429) {
      const wait = Math.min(2 ** attempt, 30) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`Zoho item ${itemId} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    if (json.code !== 0) throw new Error(`Zoho item ${itemId} error ${json.code}: ${json.message}`);
    return json.item as ZohoItemDetail;
  }
  throw new Error(`Zoho item ${itemId}: exhausted retries on 429`);
}

/* ── bulk /items with last_modified_time filter (drives delta sync) ────── */

// The bulk list still doesn't give per-warehouse stock, but its
// last_modified_time filter DOES let us cheaply discover which items have
// changed since a given cursor — meaning the ongoing sync only needs to
// detail-fetch those, not the full 11K. Returns just item_id + sku +
// last_modified_time; caller decides which ones actually need refresh.
export type ZohoItemChangeRow = {
  item_id: string;
  sku: string;
  last_modified_time: string;
};

export async function fetchZohoItemChangesSince(sinceIso: string | null, accessToken?: string): Promise<ZohoItemChangeRow[]> {
  const token = accessToken ?? (await getAccessToken());
  const orgId = process.env.ZOHO_ORGANIZATION_ID!;
  const rows: ZohoItemChangeRow[] = [];
  let page = 1;

  for (;;) {
    const qs = new URLSearchParams({ organization_id: orgId, per_page: "200", page: String(page) });
    // last_modified_time param: Zoho accepts ISO-8601. Omit on first-ever
    // sync (returns whole catalog).
    if (sinceIso) qs.set("last_modified_time", sinceIso);

    const res = await fetch(`${API_BASE}/items?${qs.toString()}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Zoho /items HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    if (json.code !== 0) throw new Error(`Zoho /items error ${json.code}: ${json.message}`);

    for (const it of json.items ?? []) {
      rows.push({
        item_id: it.item_id,
        sku: it.sku ?? "",
        last_modified_time: it.last_modified_time,
      });
    }

    if (!json.page_context?.has_more_page) break;
    page += 1;
  }
  return rows;
}