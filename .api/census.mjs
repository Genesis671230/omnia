import pg from "pg";
import "dotenv/config";
const c = new pg.Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
// all rows from the two affected batches
const b = await c.query(`
  select direction, count(*) n, count(*) filter (where amount <= 10) small,
         count(*) filter (where status <> 'imported') touched,
         count(*) filter (where matched_payout_id is not null) matched
  from bank_lines where batch_id like 'BANK-2026-07-%' group by direction`);
console.log("batch census:", b.rows);
// corrupt candidates: small amounts, all batches
const r = await c.query(`
  select id, statement_date, direction, amount, reference, status, matched_payout_id, left(description, 60) d
  from bank_lines where amount <= 10 order by statement_date desc`);
console.log("\nsmall-amount rows:", r.rows.length);
for (const row of r.rows) console.log(row.statement_date?.toISOString?.().slice(0,10), row.direction, "AED", row.amount, row.status, row.matched_payout_id ? "MATCHED" : "", "|", row.d);
// recon_lines referencing bank lines?
const t = await c.query(`select column_name from information_schema.columns where table_name='recon_lines' order by ordinal_position`);
console.log("\nrecon_lines cols:", t.rows.map(x => x.column_name).join(", "));
const f = await c.query(`select id, kind, filename, uploaded_at, parse_summary from uploaded_files where kind='bank' order by uploaded_at desc limit 10`);
console.log("\narchived bank files:");
for (const row of f.rows) console.log(row.id, row.filename, row.uploaded_at?.toISOString?.(), "|", row.parse_summary);
await c.end();
