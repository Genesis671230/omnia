import pg from "pg";
import "dotenv/config";

const client = new pg.Client({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const tables = await client.query(
  `select table_name from information_schema.tables where table_schema='public' order by 1`,
);
console.log("PUBLIC TABLES:", tables.rows.map((r) => r.table_name).join(", "));
for (const t of ["orders", "bank_transactions", "gateway_payouts", "reconciliation_results", "stores"]) {
  const cols = await client.query(
    `select column_name, data_type from information_schema.columns
     where table_schema='public' and table_name=$1 order by ordinal_position`,
    [t],
  );
  if (cols.rows.length) {
    const count = await client.query(`select count(*) c from "${t}"`);
    console.log(`\n${t} (${count.rows[0].c} rows):`);
    for (const c of cols.rows) console.log(`  ${c.column_name} :: ${c.data_type}`);
  }
}
await client.end();
