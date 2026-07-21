// One-time, DB-only backfill: derives customer_id for any existing order
// rows where it's still null, using the customer_email/customer_phone
// already stored on that row — no store API calls, no rate-limit exposure.
//
// orders.customer_id carries a FK to customers(id), so
// CustomersRepository.rebuildAll() must run first (it populates the
// customers table using a live email/phone fallback even when
// orders.customer_id is still null) — otherwise this script's UPDATEs
// would violate that constraint. scripts/backfill-orders.ts already calls
// rebuildAll() at the end of every run.
//
// Writes go through a direct Postgres connection (same pattern as
// db/apply-schema.mjs) using a bulk `UPDATE ... FROM (VALUES ...)` per
// chunk, instead of one round trip per row.
//
// Uses OrdersRepository.listAll() (paginated by order_date, a stable sort
// unaffected by these updates) rather than repeatedly re-querying
// `customer_id is null` — avoids the classic offset-pagination-under-
// mutation hazard where rows shift position as earlier ones get updated.
//
// Run: npx tsx scripts/stamp-customer-ids.ts
import "dotenv/config";
import pg from "pg";
import { OrdersRepository } from "@/lib/repositories/orders.repository";
import { customerIdentityKey } from "@/lib/customer-identity";

const CHUNK = 500;

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("No DIRECT_URL / DATABASE_URL in environment — required for the bulk UPDATE.");
    process.exit(1);
  }

  const orders = await OrdersRepository.listAll();
  const pairs: { uid: string; customerId: string }[] = [];
  let alreadySet = 0;
  let noIdentity = 0;

  for (const row of orders) {
    if (row.customer_id) {
      alreadySet++;
      continue;
    }
    const identity = customerIdentityKey(row.customer_email, row.customer_phone);
    if (!identity) {
      noIdentity++;
      continue;
    }
    pairs.push({ uid: row.uid, customerId: identity.id });
  }

  console.log(`${orders.length} orders total: ${alreadySet} already had customer_id, ${pairs.length} to update, ${noIdentity} have no email/phone.`);

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (let i = 0; i < pairs.length; i += CHUNK) {
      const batch = pairs.slice(i, i + CHUNK);
      const values = batch.map((_, idx) => `($${idx * 2 + 1}::text, $${idx * 2 + 2}::text)`).join(", ");
      const params = batch.flatMap((p) => [p.uid, p.customerId]);
      await client.query(
        `update orders set customer_id = v.customer_id from (values ${values}) as v(uid, customer_id) where orders.uid = v.uid`,
        params,
      );
      console.log(`  updated ${Math.min(i + CHUNK, pairs.length)}/${pairs.length}`);
    }
  } finally {
    await client.end();
  }

  console.log(`\nDone. Updated ${pairs.length} rows.`);
}

main().catch((e) => {
  console.error("stamp-customer-ids crashed:", e);
  process.exit(1);
});
