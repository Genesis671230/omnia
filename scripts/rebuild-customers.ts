// Manual trigger for CustomersRepository.rebuildAll() — normally this runs
// automatically at the end of syncAllStores() and the backfill script, but
// having it callable standalone is useful (e.g. right after a schema change,
// before scripts/stamp-customer-ids.ts, without re-running a full sync).
//
// Run: npx tsx scripts/rebuild-customers.ts
import "dotenv/config";
import { CustomersRepository } from "@/lib/repositories/customers.repository";

CustomersRepository.rebuildAll()
  .then(({ customerCount, unidentifiedCount }) => {
    console.log(`Rebuilt customers table: ${customerCount} customers (${unidentifiedCount} orders with no email/phone identity).`);
  })
  .catch((e) => {
    console.error("rebuild-customers crashed:", e);
    process.exit(1);
  });
