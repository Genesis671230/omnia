import pg from "pg";
import "dotenv/config";
const client = new pg.Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const tables = await client.query(`select table_name from information_schema.tables where table_schema='public' order by 1`);
console.log("TABLES:", tables.rows.map(r => r.table_name).join(", "));
// find bank line table
for (const t of tables.rows.map(r => r.table_name)) {
  const cols = await client.query(`select column_name from information_schema.columns where table_schema='public' and table_name=$1`, [t]);
  const names = cols.rows.map(c => c.column_name);
  if (names.includes("narration") || names.includes("description")) {
    console.log(`\n-- ${t}: ${names.join(", ")}`);
  }
}
await client.end();
