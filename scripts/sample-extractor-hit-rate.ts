// scripts/sample-extractor-hit-rate.ts
import { getAccessToken, listZohoInvoicesAll } from "@/lib/integrations/zoho";
import { extractOrderNumber } from "@/lib/finance/extract-order-number";

async function main(){

const orgId = process.env.ZOHO_ORGANIZATION_ID!;
const token = await getAccessToken();

// Pull ~200 real invoices across a broader window
const invoices = await listZohoInvoicesAll(
  { status: "overdue", dateStart: "2026-07-01", dateEnd: "2026-08-17", perPage: 200 },
  token,
  orgId,
  1, // one page = 200 invoices, enough to eyeball
);

const misses: string[] = [];
let hits = 0;
for (const inv of invoices) {
  const extracted = extractOrderNumber(inv.customer_name);
  if (extracted) hits++;
  else misses.push(inv.customer_name);
}

console.log(`Hit rate: ${hits}/${invoices.length} = ${((hits/invoices.length)*100).toFixed(1)}%`);
console.log(`\nMisses (${misses.length}):`);
for (const m of misses) console.log(`  "${m}"`);

}

main()