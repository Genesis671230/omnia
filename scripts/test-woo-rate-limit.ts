// Live pre-flight check for the WooCommerce rate limiter — fires a burst of
// real, cheap GET requests through the exact same wooLimiter/wooFetch code
// path the real sync/backfill uses, so a PASS here is evidence the actual
// store tolerates backfill-level load, not a re-implemented stand-in for it.
//
// Run: npx tsx scripts/test-woo-rate-limit.ts [n]
import "dotenv/config";
import { testWooRateLimit, wooConfigured } from "@/lib/integrations/woo";

async function main() {
  if (!wooConfigured()) {
    console.error("WooCommerce is not configured (WOO_URL / WOO_CONSUMER_KEY / WOO_CONSUMER_SECRET) — nothing to test.");
    process.exit(1);
  }

  const n = Number(process.argv[2]) || 50;
  console.log(`Firing ${n} requests through the Woo rate limiter...`);

  const result = await testWooRateLimit(n);

  console.log(`\nStatuses: ${result.statuses.join(", ")}`);
  console.log(`Duration: ${result.durationMs}ms (${(result.durationMs / result.n).toFixed(0)}ms/req avg)`);
  console.log(`OK: ${result.ok}/${result.n}   Failed: ${result.failed}/${result.n}`);

  if (result.failed > 0) {
    console.error("\nFAIL — the store returned non-2xx responses under this load. Do not run the full backfill yet.");
    process.exit(1);
  }
  console.log("\nPASS — safe to proceed with the backfill.");
}

main().catch((e) => {
  console.error("Rate-limit test crashed:", e);
  process.exit(1);
});
