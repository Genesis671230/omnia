// One-time historical backfill: pulls the last N days (default 730 = 2
// years) of orders from all configured Shopify stores + WooCommerce into
// Supabase. Standalone script, not an HTTP route — a 2-year pull across 4
// stores isn't bound by any request timeout here, and progress prints
// straight to the terminal.
//
// Every upsert is ON CONFLICT (uid) DO UPDATE, so this script is safe to
// re-run in full at any point (e.g. after a crash) — already-saved orders
// are simply refreshed, not duplicated, and courier/tracking fields for
// orders already shipped through this app's own SMSA pipeline are left
// untouched (see OrdersRepository.upsertMany).
//
// Run: npx tsx scripts/backfill-orders.ts [--days=730] [--all] [--only=KSA] [--skip-rate-check]
import "dotenv/config";
import { fetchShopifyOrders, getShopifyStores, type ShopifyStoreConfig } from "@/lib/integrations/shopify";
import { fetchWooOrders, wooConfigured, testWooRateLimit } from "@/lib/integrations/woo";
import { normalizeShopifyOrder, normalizeWooOrder } from "@/lib/normalize/order";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { CustomersRepository } from "@/lib/repositories/customers.repository";

// Fixed epoch for --all — well before any of these stores could have
// existed, so it's a stand-in for "no lower bound" without special-casing
// the date-filter logic in fetchShopifyOrders/fetchWooOrders.
const ALL_TIME_SINCE = "2000-01-01";

type Args = { days: number; all: boolean; only: string | null; skipRateCheck: boolean };

function parseArgs(argv: string[]): Args {
  let days = 730;
  let all = false;
  let only: string | null = null;
  let skipRateCheck = false;
  for (const arg of argv) {
    if (arg.startsWith("--days=")) days = Number(arg.slice("--days=".length)) || 730;
    else if (arg === "--all") all = true;
    else if (arg.startsWith("--only=")) only = arg.slice("--only=".length).toUpperCase();
    else if (arg === "--skip-rate-check") skipRateCheck = true;
  }
  return { days, all, only, skipRateCheck };
}

type StoreResult = { store: string; pages: number; fetched: number; upserted: number; error?: string };

async function backfillShopify(store: ShopifyStoreConfig, sinceIso: string): Promise<StoreResult> {
  let pages = 0;
  let upserted = 0;
  try {
    const raw = await fetchShopifyOrders(store, sinceIso, async (pageOrders) => {
      pages += 1;
      const rows = pageOrders.map((o) => normalizeShopifyOrder(o, store.code));
      upserted += await OrdersRepository.upsertMany(rows);
      console.log(`  [${store.code}] page ${pages}: +${rows.length} orders (running total upserted: ${upserted})`);
    });
    return { store: store.code, pages, fetched: raw.length, upserted };
  } catch (e) {
    return { store: store.code, pages, fetched: 0, upserted, error: (e as Error).message };
  }
}

async function backfillWoo(sinceIso: string): Promise<StoreResult> {
  let pages = 0;
  let upserted = 0;
  try {
    const raw = await fetchWooOrders(sinceIso, async (pageOrders) => {
      pages += 1;
      const rows = pageOrders.map(normalizeWooOrder);
      upserted += await OrdersRepository.upsertMany(rows);
      console.log(`  [WOO] page ${pages}: +${rows.length} orders (running total upserted: ${upserted})`);
    });
    return { store: "WOO", pages, fetched: raw.length, upserted };
  } catch (e) {
    return { store: "WOO", pages, fetched: 0, upserted, error: (e as Error).message };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sinceIso = args.all
    ? ALL_TIME_SINCE
    : new Date(Date.now() - args.days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  console.log(`Backfilling orders since ${sinceIso}${args.all ? " (all-time)" : ` (${args.days} days)`}${args.only ? ` — store filter: ${args.only}` : ""}\n`);

  const wantsWoo = wooConfigured() && (!args.only || args.only === "WOO");
  if (wantsWoo && !args.skipRateCheck) {
    console.log("Running Woo rate-limit pre-flight check...");
    const check = await testWooRateLimit(50);
    console.log(`  ${check.ok}/${check.n} OK, ${check.durationMs}ms total\n`);
    if (check.failed > 0) {
      console.error("Woo rate-limit pre-flight FAILED — refusing to start the Woo pull. Investigate before retrying (or pass --skip-rate-check if you've confirmed this was a one-off blip).");
      process.exit(1);
    }
  }

  const stores = getShopifyStores().filter((s) => !args.only || args.only === s.code);
  const results: StoreResult[] = [];

  for (const store of stores) {
    console.log(`Fetching Shopify ${store.code}...`);
    results.push(await backfillShopify(store, sinceIso));
  }

  if (wantsWoo) {
    console.log("Fetching WooCommerce...");
    results.push(await backfillWoo(`${sinceIso}T00:00:00`));
  }

  console.log("\n=== Backfill summary ===");
  for (const r of results) {
    const status = r.error ? `ERROR: ${r.error}` : "ok";
    console.log(`${r.store.padEnd(6)} pages=${r.pages} fetched=${r.fetched} upserted=${r.upserted} ${status}`);
  }

  console.log("\nRebuilding customers table from the full order book...");
  try {
    const { customerCount, unidentifiedCount } = await CustomersRepository.rebuildAll();
    console.log(`  ${customerCount} customers (${unidentifiedCount} orders with no email/phone identity)`);
  } catch (e) {
    console.error("  customers rebuild failed (orders themselves are unaffected):", (e as Error).message);
  }

  const hadError = results.some((r) => r.error);
  process.exit(hadError ? 1 : 0);
}

main().catch((e) => {
  console.error("Backfill crashed:", e);
  process.exit(1);
});
