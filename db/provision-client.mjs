// Build a NEW client's database from scratch: db/bootstrap.sql (full
// structure) then db/schema.sql (idempotent migrations).
//
//   DATABASE_URL=postgres://…new-client… node db/provision-client.mjs
//
// Refuses to run against a database that already has tables in `public`, so
// it can never be pointed at Omnia's (or any live) database by mistake.
// Pass --force-empty-check-off only if you know exactly why.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL (or DIRECT_URL) to the NEW client's database"); process.exit(1); }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const { rows } = await client.query("select count(*)::int n from information_schema.tables where table_schema = 'public'");
  if (rows[0].n > 0 && !process.argv.includes("--force-empty-check-off")) {
    console.error(`Refusing: this database already has ${rows[0].n} tables in public. Provision only an EMPTY database.`);
    process.exit(2);
  }
  await client.query(readFileSync(join(here, "bootstrap.sql"), "utf8"));
  await client.query(readFileSync(join(here, "schema.sql"), "utf8"));
  const after = await client.query("select count(*)::int n from information_schema.tables where table_schema = 'public'");
  console.log(`Provisioned: ${after.rows[0].n} tables. Next: set the app's env and open Settings → Zoho organisations.`);
} finally {
  await client.end();
}
