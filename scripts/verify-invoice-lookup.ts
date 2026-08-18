// scripts/verify-invoice-lookup.ts
import { getAccessToken, findZohoInvoice } from "@/lib/integrations/zoho";


async function main(): Promise<void> {

const orgId = process.env.ZOHO_ORGANIZATION_ID!;
const token = await getAccessToken();

for (const orderRef of ["802914", "SA3802", "802893"]) {
  try {
    const invoice = await findZohoInvoice(orderRef, token, orgId);
    console.log(`✓ ${orderRef} → ${invoice.invoice_number} (${invoice.customer_name}, bal ${invoice.balance})`);
  } catch (e) {
    console.log(`✗ ${orderRef} → ${(e as Error).message}`);
  }
}
}

main();