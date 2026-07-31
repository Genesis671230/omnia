/**
 * One-off probe: hits Zoho's real endpoints against YOUR org and prints
 * what actually comes back, so we build the warehouse-stock sync against
 * reality — not against my assumption of Zoho's docs.
 *
 * Run:  npx tsx scripts/probe-zoho-warehouses.ts
 *
 * Reads env vars the same way lib/integrations/zoho.ts does — no new
 * config needed. Prints nothing to a DB, writes nothing anywhere. Safe
 * to run repeatedly.
 *
 * What we're trying to answer, in order:
 *   1. Does the org actually have >1 warehouse configured in Zoho?
 *      (If it's single-warehouse, the whole per-warehouse split is moot
 *      and the numbers your friend quoted come from somewhere else.)
 *   2. Does the BULK /items list endpoint include a per-warehouse
 *      breakdown per row?  (Ideal case — one paginated fetch, done.)
 *   3. If not, does the /items/{id} DETAIL endpoint include it?
 *      (Fallback — means N+1 fetches, needs a smarter sync strategy.)
 *   4. Are there any other fields on the item that carry warehouse
 *      info under a name we didn't guess? (Print the raw keys to find out.)
 */

require("dotenv").config({ path: ".env" }); 
const ACCOUNTS_BASE = "https://accounts.zoho.com";
const API_BASE = "https://www.zohoapis.com/inventory/v1";

async function getAccessToken(): Promise<string> {
  const res = await fetch(`${ACCOUNTS_BASE}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.ZOHO_CLIENT_ID!,
      client_secret: process.env.ZOHO_CLIENT_SECRET!,
      refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
    }),
  });
  if (!res.ok) throw new Error(`OAuth HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.access_token) throw new Error(`OAuth: no access_token — ${JSON.stringify(json)}`);
  return json.access_token as string;
}

async function zohoGet(path: string, accessToken: string, extraQuery: Record<string, string> = {}): Promise<any> {
  const qs = new URLSearchParams({ organization_id: process.env.ZOHO_ORGANIZATION_ID!, ...extraQuery });
  const url = `${API_BASE}${path}?${qs.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
  const body = await res.text();
  if (!res.ok) throw new Error(`GET ${path} HTTP ${res.status}: ${body.slice(0, 500)}`);
  return JSON.parse(body);
}

// Small helper — dump an object's top-level keys with a value-shape hint so
// we can see at a glance whether a field is a scalar, an array, an object.
function summarizeKeys(obj: any, label: string) {
  console.log(`\n── ${label} — top-level keys ──`);
  if (!obj || typeof obj !== "object") {
    console.log("  (not an object)", obj);
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    let shape: string;
    if (v === null) shape = "null";
    else if (Array.isArray(v)) shape = `array[${v.length}]`;
    else if (typeof v === "object") shape = `object{${Object.keys(v).length} keys}`;
    else shape = `${typeof v}: ${String(v).slice(0, 60)}`;
    console.log(`  ${k}: ${shape}`);
  }
}

async function main() {
  for (const v of ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ORGANIZATION_ID"]) {
    if (!process.env[v]) {
      console.error(`Missing env var: ${v}`);
      process.exit(1);
    }
  }

  console.log("→ fetching access token…");
  const token = await getAccessToken();
  console.log("✓ token acquired");

  /* ── STEP 1: does the org have warehouses configured, and how many? ─── */
  console.log("\n════════ STEP 1: warehouses endpoint ════════");
  // Zoho's docs name this endpoint /settings/warehouses on some accounts and
  // just /warehouses on others — try the settings path first, fall back.
  let warehousesJson: any = null;
  for (const path of ["/settings/warehouses", "/warehouses"]) {
    try {
      warehousesJson = await zohoGet(path, token);
      console.log(`✓ ${path} responded — code ${warehousesJson.code}`);
      break;
    } catch (e) {
      console.log(`✗ ${path} — ${(e as Error).message.slice(0, 200)}`);
    }
  }
  if (warehousesJson) {
    const list = warehousesJson.warehouses ?? [];
    console.log(`\nWarehouses configured: ${list.length}`);
    for (const w of list) {
      console.log(`  - ${w.warehouse_id}  "${w.warehouse_name}"  ${w.is_primary ? "(primary)" : ""}`);
    }
    if (list[0]) summarizeKeys(list[0], "first warehouse row");
  } else {
    console.log("Could not fetch warehouses — check whether your token's scope includes settings read.");
  }

  /* ── STEP 2: does /items (bulk) carry per-warehouse breakdown? ───────── */
  console.log("\n════════ STEP 2: /items bulk endpoint ════════");
  const itemsJson = await zohoGet("/items", token, { per_page: "3", page: "1" });
  const bulkItems = itemsJson.items ?? [];
  console.log(`Bulk fetched ${bulkItems.length} items (per_page=3)`);
  if (bulkItems[0]) {
    summarizeKeys(bulkItems[0], "first item (bulk /items row)");
    // The interesting question: does this row already carry per-warehouse
    // stock, or only aggregate stock_on_hand?
    const warehouseKeys = Object.keys(bulkItems[0]).filter((k) =>
      k.toLowerCase().includes("warehouse") || k.toLowerCase().includes("locations") || k === "stock_by_warehouse",
    );
    console.log(`\nWarehouse-shaped keys on bulk row: ${warehouseKeys.length ? warehouseKeys.join(", ") : "NONE"}`);
    console.log("→ if NONE above, bulk endpoint gives only aggregate; per-warehouse needs the detail endpoint (step 3).");
  }

  /* ── STEP 3: does /items/{id} carry per-warehouse breakdown? ─────────── */
  if (bulkItems[0]) {
    console.log("\n════════ STEP 3: /items/{id} detail endpoint ════════");
    const itemId = bulkItems[0].item_id;
    console.log(`Fetching detail for item_id=${itemId}  sku=${bulkItems[0].sku}`);
    const detailJson = await zohoGet(`/items/${itemId}`, token);
    const detail = detailJson.item ?? detailJson;
    summarizeKeys(detail, "item detail");

    // Look for warehouse breakdown under any plausible name.
    const candidates = ["warehouses", "locations", "stock_by_warehouse", "warehouse_stocks", "warehouse_details"];
    for (const key of candidates) {
      if (detail[key] !== undefined) {
        console.log(`\n✓ found "${key}" on detail row — this is very likely the per-warehouse breakdown`);
        const val = detail[key];
        if (Array.isArray(val) && val[0]) {
          summarizeKeys(val[0], `first ${key}[] entry`);
          console.log(`\nRaw first entry:\n${JSON.stringify(val[0], null, 2)}`);
        } else {
          console.log(JSON.stringify(val, null, 2).slice(0, 1000));
        }
      }
    }

    // If we couldn't find any of the guessed names, dump every array-typed
    // field on the detail row — the warehouse data is almost certainly
    // hiding under one of them.
    const arrayFields = Object.entries(detail)
      .filter(([, v]) => Array.isArray(v) && (v as unknown[]).length > 0)
      .map(([k]) => k);
    console.log(`\nAll array-typed fields on detail row: ${arrayFields.join(", ") || "none"}`);
  }

  /* ── STEP 4: check whether /items supports a warehouse expansion param ─ */
  console.log("\n════════ STEP 4: does bulk /items respect &show_stock_by_warehouse=true? ════════");
  try {
    const expanded = await zohoGet("/items", token, {
      per_page: "1",
      page: "1",
      show_stock_by_warehouse: "true",
    });
    const first = expanded.items?.[0];
    if (first) {
      const warehouseKeys = Object.keys(first).filter((k) => k.toLowerCase().includes("warehouse"));
      console.log(`With &show_stock_by_warehouse=true, warehouse-shaped keys on bulk row: ${warehouseKeys.join(", ") || "STILL NONE"}`);
      if (warehouseKeys.length) {
        console.log(JSON.stringify(first[warehouseKeys[0]], null, 2).slice(0, 800));
      }
    }
  } catch (e) {
    console.log(`Query param not accepted — ${(e as Error).message.slice(0, 200)}`);
  }

  console.log("\n✓ probe complete.  Paste the output back and I'll write the real sync against whatever's actually there.");
}

main().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});