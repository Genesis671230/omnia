// One-off: apply db/schema.sql to the Supabase Postgres via DATABASE_URL.
//   node db/apply-schema.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import "dotenv/config";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "schema.sql"), "utf8");

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("No DIRECT_URL / DATABASE_URL in environment");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  const { rows } = await client.query(
    `select table_name from information_schema.tables
     where table_schema='public'
       and table_name in ('orders','bank_transactions','gateway_payouts','reconciliation_results')
     order by table_name`,
  );
  console.log("tables:", rows.map((r) => r.table_name).join(", "));
} finally {
  await client.end();
}
