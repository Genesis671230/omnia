/**
 * One-off backfill: pulls every Zoho item's per-warehouse stock into
 * supabase. RUNS LOCALLY — do NOT invoke this from an HTTP route.
 *
 *   npx tsx scripts/backfill-zoho-warehouse-stock.ts
 *
 * Expected runtime: ~30 minutes for ~11K items at concurrency=5. Safe to
 * kill and re-run: the delta cursor will pick up where the last save
 * landed (last_modified_time-based, not row-position-based, so items you
 * already saved won't be re-fetched).
 *
 * Prints progress every SAVE_BATCH items so you can watch it work.
 */
require("dotenv").config({ path: ".env" }); 

import { syncZohoWarehouses, fullBackfillItemWarehouseStock } from "@/lib/zoho-warehouse-sync";

async function main() {
  for (const v of ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ORGANIZATION_ID"]) {
    if (!process.env[v]) {
      console.error(`Missing env var: ${v}`);
      process.exit(1);
    }
  }

  console.log("→ syncing warehouse metadata…");
  const wh = await syncZohoWarehouses();
  console.log(`✓ warehouses: fetched ${wh.fetched}, saved ${wh.saved}`);

  console.log("\n→ backfilling per-item warehouse stock (this takes ~30 min)…");
  const started = Date.now();
  const result = await fullBackfillItemWarehouseStock({
    onProgress: ({ done, total, savedRows, lastSku }) => {
      const pct = ((done / total) * 100).toFixed(1);
      const rate = (done / ((Date.now() - started) / 1000)).toFixed(2);
      console.log(`  ${done}/${total} items (${pct}%) — ${savedRows} rows saved — ${rate} items/sec — last: ${lastSku}`);
    },
  });

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\n✓ done in ${mins} min — ${result.totalItems} items, ${result.totalRows} warehouse-stock rows`);
}

main().catch((e) => {
  console.error("BACKFILL FAILED:", e);
  process.exit(1);
});