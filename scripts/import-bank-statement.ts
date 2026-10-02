// Same path as POST /api/upload/bank, for a file on disk: detect the account, parse, merge.
// Usage: npx tsx --env-file=.env --env-file=.env.local scripts/import-bank-statement.ts <file.csv>
import "dotenv/config"; import { config } from "dotenv"; config({ path: ".env.local" });
import fs from "fs";
async function main() {
  const { parseBankStatement } = await import("../lib/parsers/bank");
  const { detectStatementAccount, listStatementAccounts } = await import("../lib/finance/statement-accounts");
  const { BankRepository } = await import("../lib/repositories/bank.repository");
  const text = fs.readFileSync(process.argv[2], "utf8");
  const acct = detectStatementAccount(text, await listStatementAccounts());
  console.log("detected:", acct?.id, acct?.label);
  if (!acct) return;
  const p = parseBankStatement(text, "x.csv");
  const lines = [...p.credits, ...p.debits].map((l) => ({ ...l, account: acct.id }));
  const r = await BankRepository.insertLines(lines, `BANK-${acct.id}-2026-10-01-RAK-last50.csv`);
  console.log("parsed", lines.length, "→", r);
  const rows = await BankRepository.listAll({ account: acct.id });
  console.log("rows in", acct.id, rows.length, "| in SIB:", (await BankRepository.listAll({ account: "sib-omniastores" })).length);
}
main();
