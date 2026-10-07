import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const TABLES = ["connections", "workspace_settings", "oauth_states", "pending_grants"];

for (const file of ["db/schema.sql", "db/bootstrap.sql"]) {
  test(`${file} creates the connection tables`, () => {
    const sql = readFileSync(file, "utf8");
    for (const t of TABLES) assert.match(sql, new RegExp(`create table if not exists ${t} \\(`), `${t} missing in ${file}`);
    assert.match(sql, /unique \(tenant_id, provider, account_ref\)/);
  });
}
