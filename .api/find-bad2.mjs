import pg from "pg";
import "dotenv/config";
const c = new pg.Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`
  select statement_date, amount, direction, reference, batch_id, description
  from bank_lines
  where (amount <= 10 and direction = 'credit') or reference in ('FT26202HNZB1','FT26201C02Q9')
  order by statement_date desc limit 30`);
for (const row of r.rows) {
  console.log("---", row.statement_date?.toISOString?.().slice(0,10), row.direction, "AED", row.amount, "ref:", row.reference, "batch:", row.batch_id);
  console.log(JSON.stringify(row.description));
}
await c.end();
