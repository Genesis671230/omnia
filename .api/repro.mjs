import { readFileSync } from "fs";
import { parseBankStatement } from "../lib/parsers/bank.ts";
const text = readFileSync(".api/pdf-text.txt", "utf8");
const { credits, debits, format } = parseBankStatement(text, "Transaction history_16_07_2026.pdf");
console.log("format:", format, "credits:", credits.length, "debits:", debits.length);
for (const l of [...credits, ...debits]) {
  if (l.amount <= 10) console.log(l.direction, l.date, "AED", l.amount, "ref:", l.reference, "|", l.narration.slice(-80));
}
